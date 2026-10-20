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
