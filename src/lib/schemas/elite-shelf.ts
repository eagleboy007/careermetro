import { z } from "zod";
import { LIBRARY_KINDS } from "./constants";

/*
 * The Elite shelf (Library's Elite tab, handoff 12l, docs/plans/elite-plan.md section 5 item 5). Until licensing deals
 * exist it holds free sources from the reviewed catalog (by URL, never copied), playbooks and drills Development wrote
 * itself, and paid-course slots marked "Coming soon" with no maker, price or link. Curated like resources: no ads, no
 * affiliate links, nothing written by the model. No billing anywhere.
 */

const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const shelfId = z.string().min(3).max(60).regex(slug);
const text = (max: number) => z.string().min(3).max(max);
const studyGroup = z.enum(["playbook", "drill"]);

/** A free source of the catalog (src/content/resources.json), named by its URL; title, maker and length come from there. */
export const shelfFreeEntry = z.strictObject({
  type: z.literal("free"),
  id: shelfId,
  group: studyGroup,
  url: z.url({ protocol: /^https$/ }),
  /** One line on why it is on the shelf. */
  why: text(200),
});

/** One step of a playbook, or one drill with its answer explained. */
export const shelfPart = z.strictObject({ text: text(400), answer: text(500).optional() });

/**
 * A playbook or drill set written by CareerMetro. `reviewed` is true once someone who works in the role has checked it;
 * production shows only reviewed ones, as with the timed test's questions.
 */
export const shelfOwnEntry = z.strictObject({
  type: z.literal("own"),
  id: shelfId,
  group: studyGroup,
  title: text(120),
  minutes: z.number().int().positive().max(600),
  skillIds: z.array(z.string().regex(slug)).min(1).max(6),
  summary: text(240),
  parts: z.array(shelfPart).min(2).max(12),
  reviewed: z.boolean(),
});

/** A paid-course slot: what kind of course will go there, "Coming soon". No maker, price or link until a deal exists. */
export const shelfSlotEntry = z.strictObject({ type: z.literal("slot"), id: shelfId, group: z.literal("course"), label: text(60), summary: text(240) });

export const shelfEntry = z.discriminatedUnion("type", [shelfFreeEntry, shelfOwnEntry, shelfSlotEntry]).superRefine((e, ctx) => {
  if (e.type !== "own") return;
  // A playbook's steps are read; every drill has its answer.
  const answered = e.parts.filter((p) => p.answer !== undefined).length;
  if (e.group === "drill" && answered !== e.parts.length) ctx.addIssue({ code: "custom", path: ["parts"], message: "every drill has its answer" });
  if (e.group === "playbook" && answered > 0) ctx.addIssue({ code: "custom", path: ["parts"], message: "a playbook's steps have no answers" });
});
export type ShelfEntry = z.infer<typeof shelfEntry>;

/** src/content/elite-shelf.json: a note on where the content came from, and the entries with unique ids. */
export const eliteShelfFile = z
  .strictObject({ note: z.string().min(1).max(1000), entries: z.array(shelfEntry).min(1).max(200) })
  .refine((f) => new Set(f.entries.map((e) => e.id)).size === f.entries.length, { message: "entry ids are unique" })
  .refine((f) => new Set(f.entries.flatMap((e) => (e.type === "free" ? [e.url] : []))).size === f.entries.filter((e) => e.type === "free").length, {
    message: "a free source is listed once",
  });

/** The person's open goal a shelf card is for, by name; null when it is for none of them. */
const goalName = z.string().min(1).max(80).nullable();

/** A card as the screen gets it. Locked (Elite off): no link and no steps are sent, only what the card says. */
export const eliteShelfCard = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("free"),
    id: shelfId,
    group: studyGroup,
    title: z.string().min(1).max(160),
    provider: z.string().min(1).max(60),
    kind: z.enum(LIBRARY_KINDS),
    minutes: z.number().int().positive().max(6000),
    why: text(200),
    goal: goalName,
    url: z.url({ protocol: /^https$/ }).nullable(),
  }),
  z.strictObject({
    type: z.literal("own"),
    id: shelfId,
    group: studyGroup,
    title: text(120),
    minutes: z.number().int().positive().max(600),
    summary: text(240),
    count: z.number().int().min(2).max(12),
    reviewed: z.boolean(),
    goal: goalName,
    parts: z.array(shelfPart).min(2).max(12).nullable(),
  }),
  z.strictObject({ type: z.literal("slot"), id: shelfId, group: z.literal("course"), label: text(60), summary: text(240) }),
]);
export type EliteShelfCard = z.infer<typeof eliteShelfCard>;

export const eliteShelfView = z
  .strictObject({ elite: z.boolean(), cards: z.array(eliteShelfCard).max(200) })
  .superRefine((v, ctx) => {
    const locked = v.cards.some((c) => (c.type === "free" && c.url === null) || (c.type === "own" && c.parts === null));
    const open = v.cards.some((c) => (c.type === "free" && c.url !== null) || (c.type === "own" && c.parts !== null));
    if (v.elite && locked) ctx.addIssue({ code: "custom", path: ["cards"], message: "with Elite on every card opens" });
    if (!v.elite && open) ctx.addIssue({ code: "custom", path: ["cards"], message: "with Elite off no link or step is sent" });
  });
export type EliteShelfView = z.infer<typeof eliteShelfView>;
