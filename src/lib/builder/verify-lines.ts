import { skills } from "@/content";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";

/*
 * The no-fabrication check for the builder's reworded lines (FR-19, plan section 3 step 3). A model line is kept only
 * when every number in it and every taxonomy skill or tool it names is in the person's own answer (tools also when
 * they picked them). A line that fails is dropped, so a bad reply can only make the resume plainer, never untrue.
 */

/**
 * Names and aliases the taxonomy marks as also being ordinary words ("react", "express", "spring", "containers").
 * A line may name one of these only when the person's own answer does: a picked tool is not enough, since the plain
 * word in a model line could stand for anything.
 */
const AMBIGUOUS = new Set(skills.flatMap((s) => s.ambiguous.map(normalizeForMatch)));

/** Every name and alias in the taxonomy, normalized, longest first. */
const TOOL_NAMES = [...new Set(skills.flatMap((s) => [s.name, ...s.aliases].map(normalizeForMatch)))]
  .filter((n) => n.length > 1)
  .sort((a, b) => b.length - a.length);

const DIGITS = /\d+(?:[.,]\d+)*/g;

/** Number words, each read as its digits, so "five" in a line needs "five" or "5" in the answer. */
const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  once: "1",
  two: "2",
  twice: "2",
  three: "3",
  thrice: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  dozen: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
  hundred: "100",
  thousand: "1000",
  lakh: "100000",
  lakhs: "100000",
  crore: "10000000",
  crores: "10000000",
  million: "1000000",
  billion: "1000000000",
};
const WORDS = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(NUMBER_WORDS).join("|")})(?![\\p{L}\\p{N}])`, "giu");

/** The numbers in a text, written without separators ("1,200" is "1200"), with number words as their digits. */
export const numbersIn = (text: string) => [
  ...(text.match(DIGITS) ?? []).map((n) => n.replace(/,/g, "")),
  ...[...text.matchAll(WORDS)].map((m) => NUMBER_WORDS[m[1].toLowerCase()]),
];

/** The taxonomy names a text mentions as whole words, ambiguous ones included. */
export function toolsIn(text: string): string[] {
  const hay = normalizeForMatch(text);
  return TOOL_NAMES.filter((n) => containsPhrase(hay, n));
}

/**
 * True when the line adds no number and no skill or tool that the answer doesn't have. A tool may also come from the
 * picked tools, unless its name is also an ordinary word: then only the answer itself counts.
 */
export function lineSupported(line: string, answer: string, picked: readonly string[] = []): boolean {
  const theirs = new Set(numbersIn(answer));
  if (numbersIn(line).some((n) => !theirs.has(n))) return false;
  const own = normalizeForMatch(answer);
  const withPicks = normalizeForMatch([answer, ...picked].join("\n"));
  return toolsIn(line).every((n) => containsPhrase(AMBIGUOUS.has(n) ? own : withPicks, n));
}

/** The person's own words as resume lines: trimmed sentences, at most `max`. Used when the model's lines fail or it is down. */
export function ownLines(answer: string, max = 4): string[] {
  const parts = answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
  if (parts.length <= max) return parts;
  // Keep every word: the sentences past the cap join the last line.
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join(" ")];
}
