/**
 * The four steps shown while a resume is read (v44 gap list item 2). The server answers once, so the steps move on a timer and the last one keeps turning until the next page
 * opens. Pure, so the upload form (a client component) can use it.
 */

/** When each step starts, in milliseconds after the upload is sent. A reading usually takes 10 to 30 seconds. */
export const PARSE_STEP_STARTS_MS = [0, 3000, 7000, 12000] as const;

/**
 * The step labels: what /api/resume really does (reads the file, takes out phone, email and address, finds the skills,
 * saves the profile). The role and the line come on the pages after it, so no step claims them.
 */
export const PARSE_STEPS = ["Reading your file", "Removing phone, email and address", "Finding your skills", "Saving your profile"] as const;

/** The index of the step under way `elapsedMs` after the upload was sent; the earlier ones are done. */
export function currentParseStep(elapsedMs: number): number {
  let step = 0;
  PARSE_STEP_STARTS_MS.forEach((start, i) => {
    if (elapsedMs >= start) step = i;
  });
  return step;
}

/** After this long the reading counts as slow, and the form says it is still going. */
export const SLOW_PARSE_MS = 40_000;
/**
 * The form stops waiting for pasted text after this long. The route runs for at most 120 seconds (`maxDuration` of
 * /api/resume), so by then the reply is not coming, such as when the connection dropped without an error.
 */
export const PARSE_GIVE_UP_MS = 130_000;
/**
 * The same for a file. fetch can't say when the upload body has been sent, and the route's 120 seconds start only once
 * it has, so a file of up to 4 MB on a slow mobile connection gets about another minute to arrive.
 */
export const PARSE_GIVE_UP_FILE_MS = 180_000;
/** What the form says under the steps, `elapsedMs` after the upload was sent. */
export function parseWaitNote(elapsedMs: number): string {
  return elapsedMs >= SLOW_PARSE_MS
    ? "Still reading. A long resume can take up to two minutes, so please keep this page open."
    : "This usually takes 10 to 30 seconds.";
}
/** Shown when the form stops waiting (PARSE_GIVE_UP_MS, PARSE_GIVE_UP_FILE_MS). */
export const PARSE_GAVE_UP = "This took too long. Check your connection and try again, or paste the text instead.";
