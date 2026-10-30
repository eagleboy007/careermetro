import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPack, csv, FIELDS } from "../../scripts/review/build-review-pack.mjs";
import { answers, parseCsv } from "../../scripts/review/read-review.mjs";

const root = resolve(__dirname, "../..");
const pack: Record<string, string> = buildPack();

describe("the expert review pack (docs/review/pack)", () => {
  it("is current: run node scripts/review/build-review-pack.mjs after a content change", () => {
    for (const [name, body] of Object.entries(pack)) expect(readFileSync(resolve(root, "docs/review/pack", name), "utf8"), name).toBe(body);
  });

  it("puts every role awaiting review in exactly one field file", () => {
    const refs = FIELDS.flatMap((f: { file: string }) => parseCsv(pack[f.file]).slice(1).filter((r) => r[0].endsWith("#title")).map((r) => r[0]));
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.length).toBeGreaterThan(100);
  });

  it("reads back only answered lines, and flags a Ref that no longer exists", () => {
    const head = parseCsv(pack["roles-testing.csv"])[0];
    const blank = ["", "", ""];
    const text = csv([
      head,
      ["qa-automation-engineer#title", "QA Automation Engineer", "Title", "QA Automation Engineer", "", ...blank],
      ["qa-automation-engineer#skill:selenium", "QA Automation Engineer", "Skill: Required", "Selenium", "Automate, \"web\" tests", "", "Nice to have", "Playwright is more common now"],
      ["gone-role#title", "Gone", "Title", "Gone", "", "yes", "", ""],
    ]);
    const got = answers(text, new Set(["qa-automation-engineer"]));
    expect(got.map((a: { ref: string; change: string; unknown: boolean }) => [a.ref, a.change, a.unknown])).toEqual([
      ["qa-automation-engineer#skill:selenium", "Nice to have", false],
      ["gone-role#title", "", true],
    ]);
  });
});
