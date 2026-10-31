/**
 * Folded sections on Me, "View as others" and /u (C23, handoff section 11), in plain code so they can be tested: each
 * list section shows its first FOLD_SHOWN items, newest first, then "Show N more".
 */

/** How many items a folded section shows before "Show N more". */
export const FOLD_SHOWN = 3;

/** What a section shows: every item when open or short enough, else the first `first`; and how many are folded away. */
export function foldItems<T>(items: readonly T[], open: boolean, first = FOLD_SHOWN): { shown: T[]; hidden: number } {
  const folds = items.length > first;
  return { shown: folds && !open ? items.slice(0, first) : [...items], hidden: folds ? items.length - first : 0 };
}

/** The latest four-digit year in a free-text year ("2019 to 2021", "Class of 2020"), or null when it names none. */
export function latestYear(text: string | null | undefined): number | null {
  const years = (text ?? "").match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g);
  return years ? Math.max(...years.map(Number)) : null;
}

/**
 * Education rows newest first by the year they give (C23: the latest course first). Rows with no year keep their order
 * after the dated ones; rows with the same year keep theirs too.
 */
export function newestFirstByYear<T extends { year: string | null | undefined }>(rows: readonly T[]): T[] {
  return rows
    .map((row, i) => ({ row, i, year: latestYear(row.year) }))
    .sort((a, b) => (a.year === null ? (b.year === null ? a.i - b.i : 1) : b.year === null ? -1 : b.year - a.year || a.i - b.i))
    .map(({ row }) => row);
}
