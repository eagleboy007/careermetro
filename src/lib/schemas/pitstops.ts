import { z } from "zod";
import { OWN_PITSTOP_OPTIONS_MAX, OWN_PITSTOP_TITLE_MAX, OWN_PITSTOPS_PER_GOAL } from "./constants";
export { OWN_PITSTOP_CHANGES_PER_DAY, OWN_PITSTOP_OPTIONS_MAX, OWN_PITSTOP_TITLE_MAX, OWN_PITSTOPS_MAX, OWN_PITSTOPS_PER_GOAL } from "./constants";

/*
 * Add a pitstop on the Map (FR-58; handoff section 7 "Pitstops ... the user adds are drawn as spurs labelled ADDED BY
 * YOU", section 5 "A suggested extra pitstop per goal", section 6 rule 8 "Extra pitstop: the next unused resource for
 * that skill"; section 13 `path_steps.source` = user). A pitstop of one's own is an extra learn halt on one of the
 * person's open goals: it gets them ready and never fills the gap, moves the train, or changes gaps, readiness or match.
 */

/**
 * A web address in words the person typed: a scheme, "www.", or a domain followed by a path. A name such as
 * "Node.js labs" or "B.Com notes" is fine. Links aren't kept in a name: a course comes from the free catalog.
 */
const LINK = /https?:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\/\S/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

/** Why a name or change was refused, as a code: the free text itself is never logged or echoed in an error. */
export const OWN_PITSTOP_ERRORS = ["invalid", "title", "link", "not_found", "goal_closed", "per_goal", "max", "course", "no_path", "limit"] as const;
export type OwnPitstopError = (typeof OWN_PITSTOP_ERRORS)[number];

/** The name: spaces run together and trimmed, 1 to 40 characters, no control characters and no links. */
export const ownPitstopTitle = z
  .string()
  .max(OWN_PITSTOP_TITLE_MAX * 4)
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, { message: "title" })
      .max(OWN_PITSTOP_TITLE_MAX, { message: "title" })
      .refine((s) => !CONTROL.test(s), { message: "title" })
      .refine((s) => !LINK.test(s), { message: "link" }),
  );

/** A free catalog course for the pitstop, by id, or none. The server checks it is a live, free link for the goal. */
const courseId = z.uuid().nullable().default(null);

/** Add: which of the person's goals, the name, and optionally one of the free courses offered for it. */
export const ownPitstopAdd = z.strictObject({ goalId: z.uuid(), title: ownPitstopTitle, resourceId: courseId });
/** Edit: a new name, and the course (null takes it off). The goal stays the same. */
export const ownPitstopEdit = z.strictObject({ title: ownPitstopTitle, resourceId: courseId });

export type OwnPitstopAdd = z.infer<typeof ownPitstopAdd>;
export type OwnPitstopEdit = z.infer<typeof ownPitstopEdit>;

/** The code for a refused add or edit body: a bad name or link says so, anything else is "invalid". */
export function ownPitstopInputError(error: z.ZodError): OwnPitstopError {
  const titleIssue = error.issues.find((i) => i.path[0] === "title");
  if (!titleIssue) return "invalid";
  return titleIssue.message === "link" ? "link" : "title";
}

/** A course as the Map shows it: title and "provider · kind · length". */
const course = z.object({ id: z.string().min(1).max(60), title: z.string().min(1).max(160), detail: z.string().max(120) });

/** One of the person's own pitstops, as the Map shows it. */
export const ownPitstop = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(OWN_PITSTOP_TITLE_MAX),
  /** The free catalog course picked for it; null when none was, or the link broke or was hidden. */
  course: course.nullable(),
});

/** A free course offered when adding one: the next unused catalog links for the goal's skill. */
export const ownPitstopOption = course;

export const ownPitstops = z.array(ownPitstop).max(OWN_PITSTOPS_PER_GOAL);
export const ownPitstopOptions = z.array(ownPitstopOption).max(OWN_PITSTOP_OPTIONS_MAX);

export type OwnPitstop = z.infer<typeof ownPitstop>;
export type OwnPitstopOption = z.infer<typeof ownPitstopOption>;

/** The words for each refusal, shown under the form. Never repeats what the person typed. */
export const OWN_PITSTOP_MESSAGES: Record<OwnPitstopError, string> = {
  invalid: "That didn't work. Refresh the page and try again.",
  title: `Give it a name of 1 to ${OWN_PITSTOP_TITLE_MAX} characters.`,
  link: "Name it in words. Links aren't kept here; pick one of the free courses instead.",
  not_found: "We couldn't find this pitstop or goal. It may have been removed already.",
  goal_closed: "This goal is met or skipped, so it takes no new pitstops.",
  per_goal: `A goal can have up to ${OWN_PITSTOPS_PER_GOAL} pitstops of your own. Remove one first.`,
  max: "You have as many pitstops of your own as we keep. Remove one first.",
  course: "That course isn't on our free list for this goal any more. Pick another or none.",
  no_path: "Open your path first, then add pitstops of your own.",
  limit: "That's a lot of changes for one day. Try again tomorrow.",
};
