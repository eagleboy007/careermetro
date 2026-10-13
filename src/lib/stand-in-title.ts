/**
 * The title typed in the role search, carried to "My role isn't listed" in this tab's sessionStorage rather than the
 * address, so it never reaches request logs. Storage can be missing or blocked (a private window, blocked site data):
 * then nothing is carried and the form simply starts empty.
 */
const KEY = "cm-stand-in-title";
const MAX = 120;

export function saveStandInTitle(title: string): void {
  try {
    const line = title.replace(/\s+/g, " ").trim().slice(0, MAX);
    if (line) sessionStorage.setItem(KEY, line);
    else sessionStorage.removeItem(KEY);
  } catch {}
}

/** The carried title, or "" without one. Reading leaves it in place, so every render reads the same value. */
export function peekStandInTitle(): string {
  try {
    return (sessionStorage.getItem(KEY) ?? "").slice(0, MAX);
  } catch {
    return "";
  }
}

/** Forgets the carried title, once its posting is saved, so the next check starts empty. */
export function clearStandInTitle(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
