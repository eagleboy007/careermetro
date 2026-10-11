import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Supply-chain rules for GitHub Actions (engineering-standards.md, section 8): every workflow declares the token's
// permissions, and every third-party action is pinned to a full commit SHA, so a moved or hijacked tag can't change
// what runs. Dependabot keeps the pins current.
const DIR = resolve(__dirname, "../../.github/workflows");
const workflows = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(DIR, f), "utf8") }));

describe("GitHub workflows", () => {
  it("exist", () => {
    expect(workflows.length).toBeGreaterThan(3);
  });

  it.each(workflows.map((w) => [w.name, w.text]))("%s declares top-level permissions", (_, text) => {
    expect(text).toMatch(/^permissions:\s*\n\s+\w+:\s*(read|write|none)/m);
  });

  it.each(workflows.map((w) => [w.name, w.text]))("%s pins every action to a commit SHA", (_, text) => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]).filter((u) => !u.startsWith("./"));
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });

  it.each(workflows.map((w) => [w.name, w.text]))("%s never grants write-all", (_, text) => {
    expect(text).not.toMatch(/permissions:\s*write-all/);
  });
});
