import { z } from "zod";
import { cleanSuggestedUrl } from "@/lib/library/links";
import {
  LIBRARY_KINDS,
  LIBRARY_LANGUAGES,
  LIBRARY_MARKS,
  ON_RIDE_MAX,
  RESOURCE_REPORT_REASONS,
  RESOURCE_REPORT_STATUSES,
  SUGGESTION_DECLINE_REASONS,
  SUGGESTION_STATUSES,
} from "./constants";
import { MAX_GAPS } from "./gap";
export { LIBRARY_KINDS, LIBRARY_LANGUAGES, LIBRARY_LENGTHS, LIBRARY_MARKS, LIBRARY_TABS, RESOURCE_REPORT_REASONS, SUGGESTION_DECLINE_REASONS } from "./constants";

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
    /** The courses on today's ride ("On your ride"): the path's, and what the person added (Add to my rides). */
    onRide: z.array(z.string().min(1).max(60)).max(2 + ON_RIDE_MAX),
    /** The person's ride and Path ticks: ride tasks ticked and learn pitstops marked done. We can't see progress on other sites. */
    finished: z.array(z.string().min(1).max(60)).max(3000),
    /** Saved with the bookmark, newest first (user_resources.saved_at). */
    saved: z.array(z.string().min(1).max(60)).max(3000).default([]),
    /** "I finished this" ticked in the details panel (user_resources.finished_at). Finished is these or `finished`. */
    ticked: z.array(z.string().min(1).max(60)).max(3000).default([]),
    /** Added with Add to my rides and not yet finished (user_resources.on_ride_at): the button reads "On your rides". */
    added: z.array(z.string().min(1).max(60)).max(ON_RIDE_MAX).default([]),
    /** Each open goal's own ride courses (its path's first two): on the rides already, so the button reads "On your rides". */
    rideCourses: z.array(z.string().min(1).max(60)).max(3000).default([]),
  })
  .superRefine((v, ctx) => {
    const ids = new Set(v.items.map((i) => i.id));
    if (ids.size !== v.items.length) ctx.addIssue({ code: "custom", message: "an item is listed twice", path: ["items"] });
    const missing = [...v.goals.flatMap((g) => g.resourceIds), ...v.onRide, ...v.finished, ...v.saved, ...v.ticked, ...v.added, ...v.rideCourses].filter((id) => !ids.has(id));
    if (missing.length) ctx.addIssue({ code: "custom", message: "points to an item that isn't in the list", path: ["items"] });
  });

/* Library part 2 (docs/plans/library-part-2-plan.md): what the browser may send. The user comes from the session. */

const resourceId = z.uuid();

/** The bookmark, "I finished this" or Add to my rides, on or off, for one catalog resource. */
export const libraryActionInput = z.object({ resourceId, mark: z.enum(LIBRARY_MARKS), on: z.boolean() }).strict();

/** "Report a broken link": a fixed reason and no note, so nothing typed is kept. */
export const resourceReportInput = z.object({ resourceId, reason: z.enum(RESOURCE_REPORT_REASONS) }).strict();

/** A skill id as the taxonomy writes them. */
const skillId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);

/**
 * "Suggest a free resource": the pasted link, cleaned (https, no user info or port, a public host, tracking and
 * affiliate parameters stripped), and the open goal's skill it is for, or null for Other.
 */
export const suggestionInput = z
  .object({
    url: z
      .string()
      .max(2000)
      .transform((raw, ctx) => {
        const clean = cleanSuggestedUrl(raw);
        if (!clean) {
          ctx.addIssue({ code: "custom", message: "an https link to a public site" });
          return z.NEVER;
        }
        return clean;
      }),
    skillId: skillId.nullable(),
  })
  .strict();

/** An admin's call on a reported link: hide it, show it again, or dismiss its open reports. */
export const RESOURCE_DECISIONS = ["hide", "show", "dismiss"] as const;
export const resourceDecisionInput = z.object({ resourceId, decision: z.enum(RESOURCE_DECISIONS) }).strict();

/** An admin's call on a suggestion. A decline always has its reason; the other calls never do. */
export const SUGGESTION_DECISIONS = ["accepted", "duplicate", "declined"] as const;
export const suggestionDecisionInput = z
  .object({ suggestionId: z.uuid(), decision: z.enum(SUGGESTION_DECISIONS), declineReason: z.enum(SUGGESTION_DECLINE_REASONS).nullable() })
  .strict()
  .refine((v) => (v.decision === "declined") === (v.declineReason !== null), { message: "a decline needs its reason, and only a decline has one", path: ["declineReason"] });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();

/** One row of Broken links on /admin/library: a resource with open reports, or one an admin hid. */
export const brokenLinkRow = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  provider: z.string().min(1).max(60),
  url: z.url({ protocol: /^https$/ }),
  /** Open reports by reason. */
  counts: z.object({ broken: count, not_free: count, outdated: count, other: count }).strict(),
  /** The first open report, for the order of the list. Null for a hidden link with none open. */
  firstReported: day.nullable(),
  /** The daily link check's last result, and its day (null before it has run). */
  healthy: z.boolean(),
  lastChecked: day.nullable(),
  hidden: z.boolean(),
});

/** One row of Suggestions on /admin/library. The person who sent it isn't shown. */
export const suggestionRow = z.object({
  id: z.uuid(),
  url: z.url({ protocol: /^https$/ }),
  host: z.string().min(1).max(253),
  /** The goal chip: a skill name, or null for Other. */
  skill: z.string().min(1).max(80).nullable(),
  sent: day,
});

export const libraryAdminView = z.object({ broken: z.array(brokenLinkRow).max(200), suggestions: z.array(suggestionRow).max(200) });

/** Download your data, version 28: the Library marks, reports and suggestions. */
const markedExport = z.object({ title: z.string(), url: z.string(), at: z.string() });
export const libraryExport = z.object({ saved: z.array(markedExport), finished: z.array(markedExport), onRide: z.array(markedExport) });
export const resourceReportExport = z.object({ title: z.string(), reason: z.enum(RESOURCE_REPORT_REASONS), status: z.enum(RESOURCE_REPORT_STATUSES), created_at: z.string() });
export const resourceSuggestionExport = z.object({ url: z.string(), status: z.enum(SUGGESTION_STATUSES), created_at: z.string() });

export type LibraryActionInput = z.infer<typeof libraryActionInput>;
export type ResourceDecision = (typeof RESOURCE_DECISIONS)[number];
export type SuggestionDecision = (typeof SUGGESTION_DECISIONS)[number];
export type BrokenLinkRow = z.infer<typeof brokenLinkRow>;
export type SuggestionRow = z.infer<typeof suggestionRow>;
export type LibraryAdminView = z.infer<typeof libraryAdminView>;
export type LibraryExport = z.infer<typeof libraryExport>;
export type ResourceReportExport = z.infer<typeof resourceReportExport>;
export type ResourceSuggestionExport = z.infer<typeof resourceSuggestionExport>;
export type LibraryItem = z.infer<typeof libraryItem>;
export type LibraryGoal = z.infer<typeof libraryGoal>;
export type LibraryView = z.infer<typeof libraryView>;
export type LibraryKind = LibraryItem["kind"];
export type LibraryLanguage = LibraryItem["language"];
