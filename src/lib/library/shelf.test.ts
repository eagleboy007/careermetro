import { describe, expect, it } from "vitest";
import { eliteShelfEntries } from "@/content";
import { eliteShelfView, type LibraryItem, type ShelfEntry } from "@/lib/schemas";
import { exampleEliteShelf } from "./fixtures";
import { buildEliteShelf, type ShelfInput } from "./shelf";

// Made-up entries and catalog rows; the last test runs the real shelf file through the builder.
const item = (id: string, url: string): LibraryItem => ({ id, title: `Course ${id}`, provider: "Example Learn", kind: "practice", minutes: 60, url, language: "English", skills: ["SQL"] });
const parts = (answered: boolean) => [
  { text: "First step to take.", ...(answered ? { answer: "The first answer." } : {}) },
  { text: "Second step to take.", ...(answered ? { answer: "The second answer." } : {}) },
];
const entries: ShelfEntry[] = [
  { type: "slot", id: "slot-one", group: "course", label: "Video course", summary: "Comes once there is an agreement." },
  { type: "free", id: "free-linux", group: "drill", url: "https://learn.example.test/linux", why: "Linux levels in the browser." },
  { type: "own", id: "own-sql", group: "drill", title: "SQL drills", minutes: 20, skillIds: ["sql"], summary: "Six queries.", parts: parts(true), reviewed: false },
  { type: "free", id: "free-sql", group: "drill", url: "https://learn.example.test/sql", why: "SQL lessons in the browser." },
  { type: "own", id: "own-talk", group: "playbook", title: "Tell me about yourself", minutes: 10, skillIds: ["communication"], summary: "An order for it.", parts: parts(false), reviewed: true },
  { type: "free", id: "free-gone", group: "playbook", url: "https://learn.example.test/broken", why: "A link the check marked broken." },
];
const input = (patch: Partial<ShelfInput> = {}): ShelfInput => ({
  elite: true,
  entries,
  items: [item("c1", "https://learn.example.test/linux"), item("c2", "https://learn.example.test/sql")],
  skillIdsByUrl: new Map([
    ["https://learn.example.test/linux", ["linux"]],
    ["https://learn.example.test/sql", ["sql"]],
  ]),
  goals: [
    { skillId: "python", name: "Python" },
    { skillId: "sql", name: "SQL basics" },
  ],
  allowUnreviewed: true,
  ...patch,
});

describe("buildEliteShelf", () => {
  it("shows paid courses, then playbooks, then drills, with the person's goals first in each and file order after", () => {
    const shelf = buildEliteShelf(input());
    expect(shelf.cards.map((c) => c.id)).toEqual(["slot-one", "own-talk", "own-sql", "free-sql", "free-linux"]);
    expect(shelf.cards.find((c) => c.id === "free-sql")).toMatchObject({ goal: "SQL basics", title: "Course c2", url: "https://learn.example.test/sql" });
    expect(shelf.cards.find((c) => c.id === "free-linux")).toMatchObject({ goal: null });
  });

  it("leaves out a free source the catalog no longer lists as healthy", () => {
    expect(buildEliteShelf(input()).cards.some((c) => c.id === "free-gone")).toBe(false);
  });

  it("with Elite off, sends what each card is but no link and no steps", () => {
    const shelf = buildEliteShelf(input({ elite: false }));
    expect(shelf.cards).toHaveLength(5);
    for (const c of shelf.cards) {
      if (c.type === "free") expect(c.url).toBeNull();
      if (c.type === "own") expect([c.parts, c.count]).toEqual([null, 2]);
    }
  });

  it("keeps unchecked playbooks and drills out where unreviewed content isn't allowed (production)", () => {
    const ids = buildEliteShelf(input({ allowUnreviewed: false })).cards.map((c) => c.id);
    expect(ids).not.toContain("own-sql");
    expect(ids).toContain("own-talk");
  });

  it("refuses a view that sends a link with Elite off", () => {
    const open = buildEliteShelf(input());
    expect(eliteShelfView.safeParse({ ...open, elite: false }).success).toBe(false);
  });

  it("builds the real shelf: paid slots carry no link or price, and in production only checked items show", () => {
    const real = (elite: boolean, allowUnreviewed: boolean) => exampleEliteShelf(elite, allowUnreviewed);
    const on = real(true, true);
    expect(on.cards.filter((c) => c.type === "slot").length).toBeGreaterThan(0);
    expect(on.cards.filter((c) => c.type === "free").length).toBe(eliteShelfEntries.filter((e) => e.type === "free").length);
    for (const c of on.cards) if (c.type === "slot") expect(Object.keys(c).sort()).toEqual(["group", "id", "label", "summary", "type"]);
    const live = real(true, false);
    const checked = eliteShelfEntries.filter((e) => e.type === "own" && e.reviewed).length;
    expect(live.cards.filter((c) => c.type === "own")).toHaveLength(checked);
  });
});
