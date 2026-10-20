import { z } from "zod";
import { LIBRARY_KINDS, LIBRARY_LANGUAGES } from "./constants";
import { MAX_GAPS } from "./gap";
export { LIBRARY_KINDS, LIBRARY_LANGUAGES, LIBRARY_LENGTHS, LIBRARY_TABS } from "./constants";

/**
 * The Library (FR-51, handoff 12a): the reviewed free catalog (FR-17), grouped by the person's open goals in map
 * order. Read only: it links to the source site and never hosts, sells or tracks anything there. The server fills it
 * from the goals, the path and the person's own ride ticks; the design page and the preview use a synthetic example.
 */
export const libraryItem = z.object({
  /** The catalog row's id (a database uuid); a short made-up id in example data. */
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(160),
  provider: z.string().min(1).max(60),
  kind: z.enum(LIBRARY_KINDS),
  minutes: z.number().int().positive().max(6000),
  /** The source site. Opened in a new tab with no referrer; never an affiliate or tracking link (catalog rule). */
  url: z.url({ protocol: /^https$/ }),
  language: z.enum(LIBRARY_LANGUAGES),
  /** Names of the skills it teaches, for search and the details panel. */
  skills: z.array(z.string().min(1).max(80)).min(1).max(12),
});

export const libraryGoal = z.object({
  /** The person's goal. Null in example data, where nothing links to a real goal. */
  goalId: z.string().min(1).max(60).nullable(),
  skillId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  status: z.enum(["missing", "weak", "outdated"]),
  /** The learn pitstop, numbered as on the Map. Null when the goal starts at proof: the card says "Brush up". */
  learnPitstop: z.number().int().min(1).nullable(),
  provePitstop: z.number().int().min(1),
  /** Today's ride is on this goal. */
  now: z.boolean(),
  /** The learn pitstop was ticked done on the Path, or every course of today's ride for it. It never fills the gap. */
  learnDone: z.boolean(),
  /** Its resources, best first: the path's courses for it, then more from the catalog for the same skill. */
  resourceIds: z.array(z.string().min(1).max(60)).max(8),
  /** Certificates on our list that fill this goal (dev/proof-plan.md). Empty when none does. */
  certificates: z.array(z.object({ name: z.string().min(1).max(120), issuer: z.string().min(1).max(80) })).max(40),
});

export const libraryView = z
  .object({
    /** The role the picks are for. Null with no resume: the goals tab asks for one, and search still works. */
    role: z.string().min(1).max(120).nullable(),
    /** The person's Path page, where a learn pitstop is ticked done. Null before there is a current analysis. */
    pathHref: z
      .string()
      .max(200)
      .regex(/^\/(?![\/\\])/, "a path inside the app")
      .nullable(),
    /** One card per open goal (not proved, not skipped), in map order. */
    goals: z.array(libraryGoal).max(MAX_GAPS),
    /** The whole healthy catalog, for search and for the goals' resources. */
    items: z.array(libraryItem).max(3000),
    /** The courses on today's ride ("On your ride"). */
    onRide: z.array(z.string().min(1).max(60)).max(3),
    /** The person's own ticks: ride tasks ticked and learn pitstops marked done. We can't see progress on other sites. */
    finished: z.array(z.string().min(1).max(60)).max(3000),
  })
  .superRefine((v, ctx) => {
    const ids = new Set(v.items.map((i) => i.id));
    if (ids.size !== v.items.length) ctx.addIssue({ code: "custom", message: "an item is listed twice", path: ["items"] });
    const missing = [...v.goals.flatMap((g) => g.resourceIds), ...v.onRide, ...v.finished].filter((id) => !ids.has(id));
    if (missing.length) ctx.addIssue({ code: "custom", message: "points to an item that isn't in the list", path: ["items"] });
  });

export type LibraryItem = z.infer<typeof libraryItem>;
export type LibraryGoal = z.infer<typeof libraryGoal>;
export type LibraryView = z.infer<typeof libraryView>;
export type LibraryKind = LibraryItem["kind"];
export type LibraryLanguage = LibraryItem["language"];
