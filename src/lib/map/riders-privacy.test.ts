import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// On your line (C13, docs/plans/on-your-line-plan.md section 2): "Show my pitstop on the map" and the people on a
// pitstop are never visible to companies, on public profiles or in email. None of that code may read the column, the
// riders store or the riders view; a grep over the source, so a new file is checked as soon as it exists.
const SRC = resolve(__dirname, "../..");
const FORBIDDEN = /show_on_map|showOnMap|@\/lib\/map\/riders|\.\/riders|pitstopRiders|PitstopRiders/;

const PLACES = [
  // Every company store and screen.
  "lib/corporate",
  "app/(app)/corporate",
  // Public profiles (/u/<handle>) and what they are built from.
  "app/(app)/u",
  "lib/me/public.ts",
  // Every email and its one-tap links.
  "lib/email",
  "app/email",
  "lib/my-jobs/weekly.ts",
  "lib/my-jobs/weekly-store.ts",
  "lib/timetable/digest.ts",
  "lib/timetable/digest-store.ts",
];

const files = (path: string): string[] => {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
};

describe("On your line stays out of company, public profile and email code", () => {
  it("checks real places", () => {
    expect(files(join(SRC, "lib/corporate")).length).toBeGreaterThan(10);
    expect(files(join(SRC, "app/(app)/corporate")).length).toBeGreaterThan(0);
    expect(files(join(SRC, "lib/me/public.ts"))).toHaveLength(1);
  });

  it("finds no file there that reads the switch or the riders", () => {
    const found = PLACES.flatMap((p) => files(join(SRC, p)))
      .filter((f) => /\.[mc]?[jt]sx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(found).toEqual([]);
  });

  it("keeps the column out of company search's person columns", () => {
    const find = readFileSync(join(SRC, "lib/corporate/find-store.ts"), "utf8");
    expect(find).toMatch(/personColumns/);
    expect(find).not.toMatch(/showOnMap|show_on_map/);
  });
});
