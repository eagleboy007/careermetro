import { createHmac } from "node:crypto";
import { nameHashKeys } from "@/lib/hash-keys";

/**
 * The resume name check (dev/resume-name-check-plan.md): a resume joins an account only when the account's first and
 * last name are both among the words of the name printed on the resume. The name is never stored, only keyed hashes
 * of its words, which can't be reversed without the server secret.
 */

/** The words of a name, lowercased, without accents or punctuation. Single letters (initials) are left out. */
export function nameWords(name: string | null | undefined): string[] {
  if (!name) return [];
  const plain = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return [...new Set(plain.split(/[^\p{L}]+/u).filter((w) => [...w].length > 1))];
}

const hashWith = (key: string, word: string) => createHmac("sha256", key).update(word).digest("base64url");

/** Hashes of the words of the name on a resume, for `resumes.name_hashes`. Null when the resume shows no name. */
export function nameHashes(name: string | null | undefined, env: Record<string, string | undefined> = process.env): string[] | null {
  const words = nameWords(name);
  const [key] = nameHashKeys(env);
  return words.length ? words.map((w) => hashWith(key, w)) : null;
}

/**
 * "unnamed": the account has no name to compare (an older account, or one like "R."), so nothing may join it until
 * the person adds one.
 */
export type NameCheck = "match" | "mismatch" | "unknown" | "unnamed";

/** Whether a name has a word the check can use. Sign-up asks for one before the account exists. */
export const hasUsableName = (name: string | null | undefined) => nameWords(name).length > 0;

/**
 * Whether an account's name matches a resume's name hashes: its first and last word must both be there, in any order,
 * with any middle names. A one-word account name matches only a resume that shows one name word, so "Sharma" doesn't
 * match "Amit Sharma". "unknown" when the resume showed no name; "unnamed" when the account has none to compare.
 */
export function checkName(accountName: string | null | undefined, hashes: string[] | null | undefined, env: Record<string, string | undefined> = process.env): NameCheck {
  const words = nameWords(accountName);
  if (!words.length) return "unnamed";
  if (!hashes?.length) return "unknown";
  if (words.length === 1 && hashes.length > 1) return "mismatch";
  const have = new Set(hashes);
  // Hashes saved under an earlier key still match: each key is tried on its own, never mixed within one name.
  const matches = (key: string) => [words[0], words[words.length - 1]].every((w) => have.has(hashWith(key, w)));
  return nameHashKeys(env).some(matches) ? "match" : "mismatch";
}

/** What the person reads when a resume isn't added to their account. Never says whose name the resume shows. */
export const NAME_MISMATCH_MESSAGE =
  "This resume shows a different name from your account, so we didn't add it. Upload your own resume. If the name on your account is wrong, ask us to correct it from the Grievances page.";

/** What a signed-in person reads when their account has no name yet, so an upload can't be checked. */
export const NAME_NEEDED_MESSAGE = "Please add your name to your account first: sign out, sign in again and enter it, then upload your resume.";
