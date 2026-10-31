import { describe, expect, it } from "vitest";
import { exampleMapLine } from "@/lib/map/fixtures";
import {
  mapLine,
  OWN_PITSTOP_ERRORS,
  OWN_PITSTOP_MESSAGES,
  OWN_PITSTOP_OPTIONS_MAX,
  OWN_PITSTOP_TITLE_MAX,
  OWN_PITSTOPS_PER_GOAL,
  ownPitstopAdd,
  ownPitstopEdit,
  ownPitstopInputError,
  ownPitstopTitle,
} from ".";

// Add a pitstop on the Map (FR-58): a pitstop of the person's own on one of their goals.
const goalId = "6f1c1a52-3c4b-4d7e-9a10-2b3c4d5e6f70";
const resourceId = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("ownPitstopTitle", () => {
  it("trims and runs spaces together", () => {
    expect(ownPitstopTitle.parse("  Blue team   labs \n")).toBe("Blue team labs");
  });
  it(`takes 1 to ${OWN_PITSTOP_TITLE_MAX} characters`, () => {
    expect(ownPitstopTitle.safeParse("x".repeat(OWN_PITSTOP_TITLE_MAX)).success).toBe(true);
    expect(ownPitstopTitle.safeParse("x".repeat(OWN_PITSTOP_TITLE_MAX + 1)).success).toBe(false);
    expect(ownPitstopTitle.safeParse("   ").success).toBe(false);
    expect(ownPitstopTitle.safeParse("").success).toBe(false);
  });
  it("keeps names with dots, and refuses links and control characters", () => {
    for (const ok of ["Node.js labs", "B.Com notes", "Excel: pivot tables", "Wireshark (free)"]) expect(ownPitstopTitle.safeParse(ok).success, ok).toBe(true);
    for (const link of ["https://example.com", "http://x.in", "www.example.com", "example.com/course", "YOUTU.BE/abc"]) expect(ownPitstopTitle.safeParse(link).success, link).toBe(false);
    expect(ownPitstopTitle.safeParse("labs\u0000").success).toBe(false);
    expect(ownPitstopTitle.safeParse("labs\u202e").success).toBe(false);
  });
});

describe("ownPitstopAdd and ownPitstopEdit", () => {
  it("takes a goal, a name and an optional free course", () => {
    expect(ownPitstopAdd.parse({ goalId, title: "Blue team labs" })).toEqual({ goalId, title: "Blue team labs", resourceId: null });
    expect(ownPitstopAdd.parse({ goalId, title: "Labs", resourceId })).toEqual({ goalId, title: "Labs", resourceId });
    expect(ownPitstopEdit.parse({ title: "Labs", resourceId: null })).toEqual({ title: "Labs", resourceId: null });
  });
  it("refuses unknown fields, made-up ids and a link for a course", () => {
    expect(ownPitstopAdd.safeParse({ goalId, title: "Labs", url: "https://example.com" }).success).toBe(false);
    expect(ownPitstopAdd.safeParse({ goalId: "g1", title: "Labs" }).success).toBe(false);
    expect(ownPitstopAdd.safeParse({ goalId, title: "Labs", resourceId: "https://example.com" }).success).toBe(false);
    expect(ownPitstopEdit.safeParse({ title: "Labs", goalId }).success).toBe(false);
  });
  it("names the refusal by code, never by the words typed", () => {
    const code = (body: unknown) => {
      const r = ownPitstopAdd.safeParse(body);
      return r.success ? null : ownPitstopInputError(r.error);
    };
    expect(code({ goalId, title: "" })).toBe("title");
    expect(code({ goalId, title: "x".repeat(41) })).toBe("title");
    expect(code({ goalId, title: "see www.example.com" })).toBe("link");
    expect(code({ goalId: "nope", title: "Labs" })).toBe("invalid");
    for (const e of OWN_PITSTOP_ERRORS) expect(OWN_PITSTOP_MESSAGES[e]).not.toMatch(/Labs/);
  });
});

describe("mapGoal with pitstops of the person's own", () => {
  const own = { id: "p1", title: "Blue team labs", course: null };
  const option = { id: "r1", title: "Detection basics", detail: "YouTube · video · 2 h" };
  it("reads without them (older data) and with them", () => {
    expect(mapLine.safeParse(exampleMapLine).success).toBe(true);
    const goals = exampleMapLine.goals.map((g, i) => (i === 3 ? { ...g, ownPitstops: [own], pitstopOptions: [option] } : g));
    expect(mapLine.safeParse({ ...exampleMapLine, goals }).success).toBe(true);
  });
  it(`holds at most ${OWN_PITSTOPS_PER_GOAL} a goal and ${OWN_PITSTOP_OPTIONS_MAX} courses offered`, () => {
    const many = (n: number) => exampleMapLine.goals.map((g, i) => (i === 3 ? { ...g, ownPitstops: Array(n).fill(own) } : g));
    expect(mapLine.safeParse({ ...exampleMapLine, goals: many(OWN_PITSTOPS_PER_GOAL) }).success).toBe(true);
    expect(mapLine.safeParse({ ...exampleMapLine, goals: many(OWN_PITSTOPS_PER_GOAL + 1) }).success).toBe(false);
    const options = exampleMapLine.goals.map((g, i) => (i === 3 ? { ...g, pitstopOptions: Array(OWN_PITSTOP_OPTIONS_MAX + 1).fill(option) } : g));
    expect(mapLine.safeParse({ ...exampleMapLine, goals: options }).success).toBe(false);
  });
});
