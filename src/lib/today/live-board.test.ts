import { describe, expect, it } from "vitest";
import { exampleLiveJobs } from "@/lib/departures/fixtures";
import { departure } from "@/lib/schemas";
import { BOARD_ROWS, boardRows, type BoardPost } from "./live-board";

const titles: Record<string, string> = { "data-analyst": "Data Analyst", "business-analyst": "Business Analyst", "data-engineer": "Data Engineer" };
const title = (slug: string) => titles[slug] ?? null;
const post = (p: Partial<BoardPost>): BoardPost => ({
  roleSlug: "data-analyst",
  city: "Pune",
  goalsBefore: 0,
  gaps: [],
  fitNote: null,
  closed: false,
  destination: false,
  ...p,
});
const gaps = (n: number) => Array.from({ length: n }, (_, i) => ({ status: "missing" as const, name: `Skill ${i + 1}` }));

describe("boardRows", () => {
  it("groups open posts by role and city, counts them, and takes the closest post's gaps", () => {
    const rows = boardRows(
      [
        post({ goalsBefore: 2, gaps: gaps(2) }),
        post({ goalsBefore: 1, gaps: [{ status: "weak", name: "Power BI" }] }),
        post({ city: "Remote", goalsBefore: 3, gaps: gaps(3) }),
      ],
      title,
    );
    expect(rows).toEqual([
      { id: "row-1", role: "Data Analyst", where: "Pune · 2 posts", gapsLeft: 1, gaps: [{ status: "weak", name: "Power BI" }], note: "One gap in the closest post." },
      { id: "row-2", role: "Data Analyst", where: "Remote · 1 post", gapsLeft: 3, gaps: gaps(3), note: "3 gaps in the closest post." },
    ]);
    for (const r of rows) expect(departure.safeParse(r).success).toBe(true);
  });

  it("leaves out closed posts, posts that name too few skills and posts no library role matches", () => {
    const rows = boardRows(
      [
        post({ closed: true }),
        post({ fitNote: "Fit not shown: the post names too few skills we know." }),
        post({ roleSlug: null }),
        post({ roleSlug: "not-in-the-library" }),
      ],
      title,
    );
    expect(rows).toEqual([]);
  });

  it("orders by gaps left, then the line's own role, then most posts, and shows five rows at most", () => {
    const rows = boardRows(
      [
        post({ roleSlug: "data-engineer", city: "Pune", goalsBefore: 0 }),
        post({ roleSlug: "business-analyst", city: "Pune", goalsBefore: 2, gaps: gaps(2) }),
        post({ roleSlug: "data-analyst", city: "Pune", goalsBefore: 2, gaps: gaps(2), destination: true }),
        post({ roleSlug: "data-analyst", city: "Delhi", goalsBefore: 4, gaps: gaps(4) }),
        post({ roleSlug: "data-analyst", city: "Mumbai", goalsBefore: 4, gaps: gaps(4) }),
        post({ roleSlug: "data-analyst", city: "Mumbai", goalsBefore: 5, gaps: gaps(5) }),
        post({ roleSlug: "data-analyst", city: "Chennai", goalsBefore: 6, gaps: gaps(6) }),
      ],
      title,
    );
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(rows.map((r) => `${r.role} · ${r.where}`)).toEqual([
      "Data Engineer · Pune · 1 post",
      "Data Analyst · Pune · 1 post",
      "Business Analyst · Pune · 1 post",
      "Data Analyst · Mumbai · 2 posts",
      "Data Analyst · Delhi · 1 post",
    ]);
    expect(rows[0].note).toBe("No required gaps in the closest post.");
    expect(rows[1].note).toBe("2 gaps in the closest post. This is your destination.");
  });

  it("reads the example live posts the way /design shows them", () => {
    const rows = boardRows(exampleLiveJobs, title);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(departure.safeParse(r).success).toBe(true);
      expect(r.gaps).toHaveLength(Math.min(10, r.gapsLeft));
    }
  });
});
