import { SMART } from "@/lib/schemas/constants";

/*
 * The SMART check on a story (docs/plans/me-editing-plan.md), in plain code. Worked out each time a story is shown and
 * never stored. It names the letters a story meets and one hint for the first one missing: never a score.
 */

export type SmartLetter = (typeof SMART)[number];

export type SmartStory = {
  where: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  boxes: readonly string[];
  goalLinked: boolean;
};

/** Words in a text: runs of letters or digits. */
const words = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;

/** The person's own part, said with "I", "my", "me" or "myself" (and "I'm", "I've", "I'd"). */
const OWN = /(^|[^\p{L}])(i|my|me|myself|i['’](m|ve|d|ll))(?![\p{L}])/iu;

const MONTHS = "jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?";
/** A year (1990 to 2039), a month name ("May" is left out: it is also a verb), or a duration ("3 weeks", "two months", "a year", "in a day"). */
const TIME = new RegExp(
  [
    "\\b(19[9]\\d|20[0-3]\\d)\\b",
    `\\b(${MONTHS})\\b`,
    "\\b(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|several)[ -]?(hours?|days?|weeks?|months?|years?|quarters?|sprints?|semesters?)\\b",
    "\\b(daily|weekly|monthly|quarterly|yearly|overnight)\\b",
  ].join("|"),
  "i",
);

/** Which letters a story meets, in S, M, A, R, T order. */
export function smartLetters(s: SmartStory): SmartLetter[] {
  const met: Record<SmartLetter, boolean> = {
    // Specific: where it happened and what was done, with the Action at least 12 words.
    S: s.where.trim().length > 0 && s.action.trim().length > 0 && words(s.action) >= 12,
    // Measurable: a number in the Result.
    M: /\d/.test(s.result),
    // Achievable: the Task names the person's own part.
    A: OWN.test(s.task),
    // Relevant: a goal is linked, or the story answers more than one box.
    R: s.goalLinked || s.boxes.length > 1,
    // Time-bound: a year, month or duration anywhere in the story.
    T: [s.where, s.situation, s.task, s.action, s.result].some((t) => TIME.test(t)),
  };
  return SMART.filter((l) => met[l]);
}

/** One line for each letter, shown for the first one a story misses. */
export const SMART_HINTS: Record<SmartLetter, string> = {
  S: "Say where it happened and what you did, in at least 12 words of Action.",
  M: "Add a number to the Result: how many, how much or how fast.",
  A: "Say what your own part was in the Task, with “I” or “my”.",
  R: "Link it to a goal, or pick another box it answers.",
  T: "Say when it happened or how long it took.",
};

/** The letters met and the hint for the first one missing (null when all five are met). */
export function smartCheck(s: SmartStory): { smart: SmartLetter[]; hint: string | null } {
  const smart = smartLetters(s);
  const missing = SMART.find((l) => !smart.includes(l));
  return { smart, hint: missing ? SMART_HINTS[missing] : null };
}
