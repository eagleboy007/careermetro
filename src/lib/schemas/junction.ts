import { z } from "zod";
import { hasContactDetails } from "@/lib/account/username";
import { cleanSuggestedUrl } from "@/lib/library/links";
import { hasLink, oneLine, storyText } from "@/lib/me/text";
import {
  APPEAL_STATUSES,
  INTAKE_SOURCES,
  INTEREST_MAX,
  JUNCTION_APPEAL_NOTE_MAX,
  JUNCTION_BODY_MAX,
  JUNCTION_COMMENT_MAX,
  JUNCTION_COMMENT_STATUSES,
  JUNCTION_FEEDS,
  JUNCTION_FROM_LABEL_MAX,
  JUNCTION_ORDER_REF_MAX,
  JUNCTION_PINS_MAX,
  JUNCTION_POST_KINDS,
  JUNCTION_REPORT_REASONS,
  JUNCTION_STATUSES,
  JUNCTION_TAGS_MAX,
  JUNCTION_TITLE_MAX,
  JUNCTION_TITLE_MIN,
  REMOVAL_REASON_MAX,
  REPORT_NOTE_MAX_CHARS,
} from "./constants";
import { REPORT_REASONS, REPORT_TARGETS } from "./inbox";

/*
 * Junction, the community board (docs/plans/junction-plan.md section 3, FR-61). What every Junction action takes from
 * the browser, and what a read sends back. Every input is strict, so an extra field (a user id, a status, a count) is
 * refused rather than ignored: the user id always comes from the session. Text others read refuses email addresses and
 * phone numbers, and links written into a title, body or comment (a scheme or "www."): the one link a post may carry
 * goes in its own field, through the Library's link rules. Bare domains stay as words, never turned into links. Post
 * and comment text never goes into logs.
 */

export const JUNCTION_TEXT = {
  contact: "Leave out phone numbers and email addresses. Everyone signed in can read this.",
  link: "Put the link in the link box, not in the text.",
  noLinksInComments: "Comments can't carry links.",
  title: `Write a title of ${JUNCTION_TITLE_MIN} to ${JUNCTION_TITLE_MAX} characters.`,
  body: `Keep it to ${JUNCTION_BODY_MAX.toLocaleString("en-IN")} characters.`,
  comment: `Write a comment of 1 to ${JUNCTION_COMMENT_MAX.toLocaleString("en-IN")} characters.`,
  badLink: "Use a full https link to the page itself: no link shorteners, IP addresses or ports.",
  audience: "Pick My route or at least one interest, so the post has readers.",
  resourceLink: "A Resource post needs its link.",
  tags: `Pick at most ${JUNCTION_TAGS_MAX} interests.`,
  interest: `An interest is 1 to ${INTEREST_MAX} characters, with no contact details or links.`,
  appeal: `Write why, in 1 to ${JUNCTION_APPEAL_NOTE_MAX.toLocaleString("en-IN")} characters.`,
} as const;

/** Text with a link written into it: a scheme or "www.". */
const linkInText = (v: string) => hasLink(v, { domains: false });

const title = z
  .string()
  .max(JUNCTION_TITLE_MAX * 4, { error: JUNCTION_TEXT.title })
  .transform(oneLine)
  .refine((v) => v.length >= JUNCTION_TITLE_MIN && v.length <= JUNCTION_TITLE_MAX, { error: JUNCTION_TEXT.title })
  .refine((v) => !hasContactDetails(v), { error: JUNCTION_TEXT.contact })
  .refine((v) => !linkInText(v), { error: JUNCTION_TEXT.link });

const body = z
  .string()
  .max(JUNCTION_BODY_MAX * 2, { error: JUNCTION_TEXT.body })
  .transform(storyText)
  .refine((v) => v.length <= JUNCTION_BODY_MAX, { error: JUNCTION_TEXT.body })
  .refine((v) => !hasContactDetails(v), { error: JUNCTION_TEXT.contact })
  .refine((v) => !linkInText(v), { error: JUNCTION_TEXT.link });

/**
 * The post's one link, cleaned by the Library's rules (cleanSuggestedUrl): https only, no IP address, localhost, user
 * name, port or link shortener; tracking and affiliate parameters dropped. Empty means none. The server never fetches it.
 */
const link = z
  .string()
  .max(2000, { error: JUNCTION_TEXT.badLink })
  .transform((v, ctx) => {
    if (!v.trim()) return null;
    const clean = cleanSuggestedUrl(v);
    if (!clean) {
      ctx.addIssue({ code: "custom", message: JUNCTION_TEXT.badLink });
      return z.NEVER;
    }
    return clean;
  });

/** A new interest typed in the composer: Me's rules (1 to 40 characters, no contact details or links). */
export const interestName = z
  .string()
  .max(INTEREST_MAX * 4, { error: JUNCTION_TEXT.interest })
  .transform(oneLine)
  .refine((v) => v.length >= 1 && v.length <= INTEREST_MAX, { error: JUNCTION_TEXT.interest })
  .refine((v) => !hasContactDetails(v) && !hasLink(v), { error: JUNCTION_TEXT.interest });

/** A new post. At least one audience (My route or an interest), at most three interests, and a link on a Resource. */
export const postInput = z
  .strictObject({
    kind: z.enum(JUNCTION_POST_KINDS),
    title,
    body: body.default(""),
    link: link.default(""),
    toRoute: z.boolean(),
    interestIds: z.array(z.uuid()).max(JUNCTION_TAGS_MAX, { error: JUNCTION_TEXT.tags }).default([]),
    newInterests: z.array(interestName).max(JUNCTION_TAGS_MAX, { error: JUNCTION_TEXT.tags }).default([]),
    showGoal: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    const tags = new Set(p.interestIds).size + p.newInterests.length;
    if (tags > JUNCTION_TAGS_MAX) ctx.addIssue({ code: "custom", path: ["interestIds"], message: JUNCTION_TEXT.tags });
    if (!p.toRoute && tags === 0) ctx.addIssue({ code: "custom", path: ["toRoute"], message: JUNCTION_TEXT.audience });
    if (p.kind === "resource" && !p.link) ctx.addIssue({ code: "custom", path: ["link"], message: JUNCTION_TEXT.resourceLink });
  });
export type PostInput = z.input<typeof postInput>;
export type PostData = z.output<typeof postInput>;

/** An edit, within the edit window (the store checks it, and that a Resource keeps a link). */
export const postEditInput = z.strictObject({ postId: z.uuid(), title, body: body.default(""), link: link.default("") });
export type PostEditInput = z.input<typeof postEditInput>;

/** A comment: 1 to 1,000 characters, no contact details and no links in v1. */
export const commentInput = z.strictObject({
  postId: z.uuid(),
  body: z
    .string()
    .max(JUNCTION_COMMENT_MAX * 2, { error: JUNCTION_TEXT.comment })
    .transform(storyText)
    .refine((v) => v.length >= 1 && v.length <= JUNCTION_COMMENT_MAX, { error: JUNCTION_TEXT.comment })
    .refine((v) => !hasContactDetails(v), { error: JUNCTION_TEXT.contact })
    .refine((v) => !linkInText(v), { error: JUNCTION_TEXT.noLinksInComments }),
});
export type CommentInput = z.input<typeof commentInput>;

export const postRef = z.strictObject({ postId: z.uuid() });
export const commentRef = z.strictObject({ commentId: z.uuid() });
/** Upvote, reshare and save are toggles: the same input each way. */
export const voteInput = postRef;
export const commentVoteInput = commentRef;
export const reshareInput = postRef;
export const saveInput = postRef;
/** Pin one of your own posts at a place (1 to 3), or take it off with null. */
export const pinInput = z.strictObject({ postId: z.uuid(), position: z.number().int().min(1).max(JUNCTION_PINS_MAX).nullable() });

/** A feed page: which tab, an interest for the My interests chip, and the keyset cursor from the page before. */
export const feedQuery = z.strictObject({
  feed: z.enum(JUNCTION_FEEDS).default("top"),
  interestId: z.uuid().optional(),
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type FeedQuery = z.input<typeof feedQuery>;

/** Report on a post or comment (plan section 2.4): the reason from Junction's list and an optional note. */
export const junctionReportInput = z.strictObject({
  target: z.enum(["post", "comment"]),
  targetId: z.uuid(),
  reason: z.enum(JUNCTION_REPORT_REASONS),
  note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
});
export type JunctionReportInput = z.input<typeof junctionReportInput>;

/** An appeal against one removal: a note, once, within the appeal window (the store checks both). */
export const appealInput = z.strictObject({
  removalId: z.uuid(),
  note: z
    .string()
    .max(JUNCTION_APPEAL_NOTE_MAX * 2, { error: JUNCTION_TEXT.appeal })
    .transform(storyText)
    .refine((v) => v.length >= 1 && v.length <= JUNCTION_APPEAL_NOTE_MAX, { error: JUNCTION_TEXT.appeal }),
});
export type AppealInput = z.input<typeof appealInput>;

/** An admin's reason: 1 to 500 characters. The author reads the rule, never this reason. */
const adminReason = z.string().trim().min(1, "Write the reason.").max(REMOVAL_REASON_MAX, `Keep the reason to ${REMOVAL_REASON_MAX} characters.`);

/** Hide a reported post or comment: a reason for the record, and the rule the author's notice quotes. */
export const hideFields = { reportId: z.uuid(), reason: adminReason, rule: z.enum(JUNCTION_REPORT_REASONS) };

/** An admin's decision on an appeal: upheld (stays hidden) or reversed (shown again), with a reason. */
export const appealDecisionInput = z.strictObject({ appealId: z.uuid(), decision: z.enum(["upheld", "reversed"]), reason: adminReason });
export type AppealDecisionInput = z.input<typeof appealDecisionInput>;

/** Keep a removal record past its 180 days (an order asks for longer), or let it go again. */
export const legalHoldInput = z.strictObject({ removalId: z.uuid(), hold: z.boolean() });
export type LegalHoldInput = z.input<typeof legalHoldInput>;

/**
 * "Log a complaint or order" (plan section 2.2): an emailed complaint, a court order or a government notice an admin
 * records, which lands in the one queue with its clock. `receivedAt` is when it reached us, not when it was logged.
 */
export const intakeInput = z
  .strictObject({
    source: z.enum(INTAKE_SOURCES),
    receivedAt: z.iso.datetime({ offset: true }),
    fromLabel: z.string().trim().min(1, "Say who sent it.").max(JUNCTION_FROM_LABEL_MAX),
    reference: z.string().trim().max(JUNCTION_ORDER_REF_MAX).default(""),
    target: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
  })
  .refine((i) => Date.parse(i.receivedAt) <= Date.now() + 5 * 60_000, { error: "That time is in the future.", path: ["receivedAt"] });
export type IntakeInput = z.input<typeof intakeInput>;

/* Views ------------------------------------------------------------------------------------------------------------- */

const ISO_INSTANT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);

/**
 * A post's author as anyone sees them: name, @handle when they have one, initials, and the route label only when the
 * author shows their target role. Never an email or a user id; `isYou` marks the viewer's own.
 */
export const authorView = z.strictObject({
  name: z.string().min(1).max(120),
  handle: z.string().min(1).max(40).nullable(),
  initials: z.string().min(1).max(2),
  route: z.string().min(1).max(120).nullable(),
  isYou: z.boolean(),
});

/** One post as a feed shows it. Text of a hidden or held post reaches only its author. */
export const postCardView = z.strictObject({
  id: z.uuid(),
  kind: z.enum(JUNCTION_POST_KINDS),
  title: z.string().min(1).max(JUNCTION_TITLE_MAX),
  body: z.string().max(JUNCTION_BODY_MAX),
  link: z.strictObject({ url: z.url().max(500), host: z.string().min(1).max(253) }).nullable(),
  author: authorView,
  routeLabel: z.string().max(120).nullable(),
  interests: z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1).max(INTEREST_MAX) })).max(JUNCTION_TAGS_MAX),
  upvotes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  reshares: z.number().int().nonnegative(),
  voted: z.boolean(),
  saved: z.boolean(),
  reshared: z.boolean(),
  /** "Asha reshared": only the viewer's connections, on Following. */
  resharedBy: z.string().min(1).max(120).nullable(),
  status: z.enum(JUNCTION_STATUSES),
  createdAt: ISO_INSTANT,
  editedAt: ISO_INSTANT.nullable(),
});
export type PostCardView = z.infer<typeof postCardView>;

export const commentView = z.strictObject({
  id: z.uuid(),
  postId: z.uuid(),
  body: z.string().max(JUNCTION_COMMENT_MAX),
  author: authorView,
  upvotes: z.number().int().nonnegative(),
  voted: z.boolean(),
  status: z.enum(JUNCTION_COMMENT_STATUSES),
  createdAt: ISO_INSTANT,
});
export type CommentView = z.infer<typeof commentView>;

export const feedPage = z.strictObject({ posts: z.array(postCardView).max(50), nextCursor: z.string().max(200).nullable() });
export type FeedPage = z.infer<typeof feedPage>;

/** What the author sees on a hidden post or comment: the rule, when, and whether they can still appeal. */
export const removalNotice = z.strictObject({
  removalId: z.uuid(),
  target: z.enum(["post", "comment"]),
  rule: z.string().min(1).max(120),
  removedAt: ISO_INSTANT,
  appealBy: ISO_INSTANT,
  appeal: z.strictObject({ status: z.enum(APPEAL_STATUSES), decidedAt: ISO_INSTANT.nullable() }).nullable(),
  canAppeal: z.boolean(),
});
export type RemovalNotice = z.infer<typeof removalNotice>;

/** One open appeal on /admin/reports, with the removed text (admin only) and its deadline. */
export const appealView = z.strictObject({
  id: z.uuid(),
  removalId: z.uuid(),
  what: z.enum(["post", "comment"]),
  /** "Post by Priya S." */
  label: z.string().min(1).max(200),
  title: z.string().max(JUNCTION_TITLE_MAX).nullable(),
  text: z.string().max(4000),
  rule: z.string().min(1).max(120),
  removedAt: ISO_INSTANT,
  /** Set when the admin looking hid it, so the page can say a different admin should decide where there is one. */
  removedByYou: z.boolean(),
  note: z.string().max(JUNCTION_APPEAL_NOTE_MAX),
  appealedAt: ISO_INSTANT,
  decideBy: ISO_INSTANT,
});
export type AppealView = z.infer<typeof appealView>;

/** A hidden post or comment in force on /admin/reports, with its removal record's legal hold. */
export const hiddenJunctionView = z.strictObject({
  id: z.uuid(),
  what: z.enum(["post", "comment"]),
  label: z.string().min(1).max(200),
  title: z.string().max(JUNCTION_TITLE_MAX).nullable(),
  text: z.string().max(4000),
  hidden: z.strictObject({ at: ISO_INSTANT, by: z.string().min(1).max(80), reason: z.string().min(1).max(REMOVAL_REASON_MAX), rule: z.string().min(1).max(120) }),
  removalId: z.uuid().nullable(),
  legalHold: z.boolean(),
  purgeAfter: ISO_INSTANT.nullable(),
});
export type HiddenJunctionView = z.infer<typeof hiddenJunctionView>;

export type JunctionResult = { ok: boolean; message: string };
