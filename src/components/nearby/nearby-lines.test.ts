import { describe, expect, it } from "vitest";
import { emptySentence, sharesSentence, toAddText } from "./nearby-lines";

describe("Nearby lines wording", () => {
  it("says the share as one sentence", () => {
    expect(sharesSentence({ title: "Application Security Engineer", shared: 6, total: 9 })).toBe(
      "Application Security Engineer shares 6 of its 9 key skills with you.",
    );
  });

  it("lists up to three skills to add, marks old ones to refresh, and folds the rest", () => {
    const add = (n: number) => ({ toAdd: Array.from({ length: n }, (_, i) => ({ name: `S${i + 1}`, outdated: i === 1 })) });
    expect(toAddText(add(0))).toBe("No key skills to add");
    expect(toAddText(add(1))).toBe("Add: S1");
    expect(toAddText(add(3))).toBe("Add: S1, S2 (refresh) and S3");
    expect(toAddText(add(5))).toBe("Add: S1, S2 (refresh), S3 and 2 more");
  });

  it("keeps the empty state plain, with the closest role's real counts when there is one", () => {
    expect(emptySentence({ slug: "data-scientist", title: "Data Scientist", shared: 2, total: 8 })).toBe(
      "None of our other roles shares at least half its key skills with you yet. The closest, Data Scientist, shares 2 of its 8.",
    );
    expect(emptySentence(null)).toBe("None of our other roles shares a key skill with you yet.");
  });
});
