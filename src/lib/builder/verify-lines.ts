import { skills } from "@/content";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";

/*
 * The no-fabrication check for the builder's reworded lines (FR-19, plan section 3 step 3). A model line is kept only
 * when every number in it and every taxonomy skill or tool it names is in the person's own answer (tools also when
 * they picked them). A line that fails is dropped, so a bad reply can only make the resume plainer, never untrue.
 */

/** Every name and alias in the taxonomy, normalized, longest first, skipping ones that are also ordinary words. */
const TOOL_NAMES = [
  ...new Set(
    skills.flatMap((s) => {
      const plain = new Set(s.ambiguous.map((a) => a.toLowerCase()));
      return [s.name, ...s.aliases].filter((n) => !plain.has(n.toLowerCase())).map(normalizeForMatch);
    }),
  ),
]
  .filter((n) => n.length > 1)
  .sort((a, b) => b.length - a.length);

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** The numbers in a text, written without separators ("1,200" is "1200"). */
export const numbersIn = (text: string) => (text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, ""));

/** The taxonomy names a text mentions as whole words. */
export function toolsIn(text: string): string[] {
  const hay = normalizeForMatch(text);
  return TOOL_NAMES.filter((n) => containsPhrase(hay, n));
}

/** True when the line adds no number and no skill or tool that the answer (or the picked tools) doesn't have. */
export function lineSupported(line: string, answer: string, picked: readonly string[] = []): boolean {
  const theirs = new Set(numbersIn(answer));
  if (numbersIn(line).some((n) => !theirs.has(n))) return false;
  const source = normalizeForMatch([answer, ...picked].join("\n"));
  return toolsIn(line).every((n) => containsPhrase(source, n));
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
