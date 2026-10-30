import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { certifications } from ".";
import { buildPack, csv, FIELDS } from "../../scripts/review/build-review-pack.mjs";
import { answers, packRefs, parseCsv } from "../../scripts/review/read-review.mjs";

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

  it("lists every certification awaiting review once, and no reviewed one", () => {
    const refs = parseCsv(pack["certifications.csv"]).slice(1).map((r) => r[0]);
    const awaiting = certifications.filter((c) => c.reviewed === false).map((c) => c.id);
    expect(refs).toEqual(awaiting);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("reads back only answered lines, and flags a Ref that no longer exists, whole, not only its role (T158)", () => {
    const head = parseCsv(pack["roles-testing.csv"])[0];
    const blank = ["", "", ""];
    const text = csv([
      head,
      ["qa-automation-engineer#title", "QA Automation Engineer", "Title", "QA Automation Engineer", "", ...blank],
      ["qa-automation-engineer#skill:selenium", "QA Automation Engineer", "Skill: Required", "Selenium", "Automate, \"web\" tests", "", "Nice to have", "Playwright is more common now"],
      // A skill the role no longer lists: the role is still there, but the line isn't.
      ["qa-automation-engineer#skill:not-a-skill", "QA Automation Engineer", "Skill: Required", "Gone", "", "yes", "", ""],
      ["gone-role#title", "Gone", "Title", "Gone", "", "yes", "", ""],
      // A new line a reviewer added has no Ref, and is never flagged.
      ["", "QA Automation Engineer", "", "", "", "", "Add k6", ""],
    ]);
    const known = packRefs(pack);
    expect(known.has("qa-automation-engineer#skill:selenium")).toBe(true);
    expect(known.has("qa-automation-engineer")).toBe(false);
    const got = answers(text, known);
    expect(got.map((a: { ref: string; change: string; unknown: boolean }) => [a.ref, a.change, a.unknown])).toEqual([
      ["qa-automation-engineer#skill:selenium", "Nice to have", false],
      ["qa-automation-engineer#skill:not-a-skill", "", true],
      ["gone-role#title", "", true],
      ["", "Add k6", false],
    ]);
  });

  it("knows every Ref of every pack file: practice and timed-test questions and certifications too", () => {
    const known = packRefs(pack);
    for (const name of ["practice-questions.csv", "timed-test-questions.csv", "certifications.csv"]) {
      for (const [ref] of parseCsv(pack[name]).slice(1)) expect(known.has(ref), `${name} ${ref}`).toBe(true);
    }
    expect(known.has("Ref")).toBe(false);
  });

  it("tells reviewers that Practice changes are edited in place, since Practice questions have no review mark", () => {
    expect(pack["README.md"]).toContain("Practice questions have no review mark");
    expect(pack["README.md"]).not.toMatch(/for a question or a certification, it sets/);
  });
});
