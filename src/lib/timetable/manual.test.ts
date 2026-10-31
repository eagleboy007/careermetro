import { describe, expect, it } from "vitest";
import type { ManualEvent } from "@/lib/schemas";
import { manualAdminRows, manualKeys, manualRow, readManual } from "./manual";

// Synthetic hand-entered events only: every organiser, link and event here is made up.
const NOW = new Date("2026-10-31T00:30:00Z");
const ev = (over: Partial<ManualEvent> = {}): ManualEvent => ({
  title: "Example AI and Python Day 2026",
  organiser: "Example Python Circle",
  kind: "conference",
  startsAt: "2026-11-21T09:00:00+05:30",
  endsAt: "2026-11-21T18:00:00+05:30",
  online: false,
  city: "Pune",
  venue: "Baner, Pune",
  cost: "",
  topics: ["python"],
  sourceUrl: "https://events.example.org/ai-python-day",
  checkedOn: "2026-10-31",
  dateEvidence: "Saturday, 21 November 2026, 9 am to 6 pm",
  ...over,
});

describe("hand-entered events as a feed run", () => {
  it("maps an event to the feed's row: key, India times as instants, place, cost, and its topics", () => {
    const row = manualRow(ev(), NOW);
    expect(row).toMatchObject({
      sourceKey: "manual:example-ai-and-python-day-2026-2026-11-21",
      sourceUrl: "https://events.example.org/ai-python-day",
      title: "Example AI and Python Day 2026",
      organiser: "Example Python Circle",
      kind: "conference",
      online: false,
      city: "Pune",
      venue: "Baner, Pune",
      cost: "",
    });
    if (typeof row === "string") throw new Error(row);
    expect(row.startsAt.toISOString()).toBe("2026-11-21T03:30:00.000Z");
    expect(row.endsAt.toISOString()).toBe("2026-11-21T12:30:00.000Z");
    // The file's skills as written, then interest topics the matcher finds in the title.
    expect(row.topics[0]).toEqual({ kind: "skill", topic: "python" });
    expect(row.topics).toContainEqual({ kind: "interest", topic: "ai" });
    expect(row.topics.every((t) => t.kind === "interest" || t.topic === "python")).toBe(true);
    // The date evidence never leaves the content file.
    expect(JSON.stringify(row)).not.toContain("Saturday, 21 November");
  });

  it("leaves out an event that has ended or is more than a year ahead", () => {
    expect(manualRow(ev({ startsAt: "2026-10-20T09:00:00+05:30", endsAt: "2026-10-20T18:00:00+05:30", checkedOn: "2026-10-10" }), NOW)).toBe("past");
    expect(manualRow(ev({ startsAt: "2027-12-01T09:00:00+05:30", endsAt: "2027-12-01T18:00:00+05:30" }), NOW)).toBe("too_far");
  });

  it("is complete when the whole file parses, under the hand-entered source", () => {
    const run = readManual([ev(), ev({ title: "Example Cloud Evening", startsAt: "2026-12-05T18:00:00+05:30", endsAt: "2026-12-05T20:00:00+05:30" })], { now: NOW });
    expect(run).toMatchObject({ feedId: "manual", source: "suggestion", ok: true, complete: true, error: null, listed: 2 });
    expect(run.rows.map((r) => r.sourceKey)).toEqual(["manual:example-ai-and-python-day-2026-2026-11-21", "manual:example-cloud-evening-2026-12-05"]);
  });

  it("counts a past event as dropped but stays complete, so a removed event can still be cancelled", () => {
    const run = readManual([ev(), ev({ title: "Old", startsAt: "2026-10-01T09:00:00+05:30", endsAt: "2026-10-01T10:00:00+05:30", checkedOn: "2026-09-30" })], { now: NOW });
    expect(run.complete).toBe(true);
    expect(run.rows).toHaveLength(1);
    expect(run.dropped.past).toBe(1);
  });

  it("loads the entries that pass but cancels nothing when the file fails as a whole", () => {
    const bad = { ...ev({ title: "Listed elsewhere" }), sourceUrl: "https://www.meetup.com/example/events/1" };
    const run = readManual([ev(), bad, ev()], { now: NOW });
    expect(run).toMatchObject({ ok: true, complete: false, error: "invalid" });
    expect(run.rows).toHaveLength(1);
    expect(run.dropped.invalid).toBe(2);
  });

  it("reads nothing from a file that isn't a list", () => {
    expect(readManual({ events: [] }, { now: NOW })).toMatchObject({ ok: false, complete: false, rows: [], listed: 0 });
  });

  it("lists the file for admins with each event's state", () => {
    const past = ev({ title: "Old", startsAt: "2026-10-01T09:00:00+05:30", endsAt: "2026-10-01T10:00:00+05:30", checkedOn: "2026-09-30" });
    const raw = [ev({ title: "Later", startsAt: "2026-12-01T09:00:00+05:30", endsAt: "2026-12-01T10:00:00+05:30" }), ev(), past, { title: "broken" }];
    expect(manualKeys(raw)).toHaveLength(3);
    const rows = manualAdminRows(raw, new Map([["manual:example-ai-and-python-day-2026-2026-11-21", "live"]]), NOW);
    expect(rows.map((r) => [r.title, r.state])).toEqual([
      ["Old", "over"],
      ["Example AI and Python Day 2026", "live"],
      ["Later", "waiting"],
    ]);
    expect(rows[1]).toMatchObject({ checkedOn: "2026-10-31", sourceUrl: "https://events.example.org/ai-python-day" });
    expect(JSON.stringify(rows)).not.toContain("dateEvidence");
  });
});
