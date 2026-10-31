import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventFeed } from "@/lib/schemas";

// Synthetic feed answers only: every organiser, link and event here is made up.
const m = vi.hoisted(() => ({
  feeds: [] as EventFeed[],
  manual: [] as unknown,
  write: vi.fn<(reads: unknown, opts: unknown) => Promise<{ upserted: number; cancelled: number; topics: number }>>(async () => ({ upserted: 0, cancelled: 0, topics: 0 })),
}));
vi.mock("@/content", async (original) => {
  const real = await original<typeof import("@/content")>();
  return {
    ...real,
    get eventFeeds() {
      return m.feeds;
    },
    get manualEventsJson() {
      return m.manual;
    },
  };
});
vi.mock("@/lib/timetable/feed-store", () => ({ writeFeedRun: m.write }));

import { GET } from "./route";

const ics = readFileSync(new URL("../../../../../fixtures/feeds/events/foss-united.ics", import.meta.url), "utf8");
const feed: EventFeed = {
  id: "foss-united",
  name: "Synthetic iCalendar feed",
  organiser: "FOSS United",
  format: "ics",
  urls: ["https://feeds.example.org/events.ics"],
  termsUrl: "https://feeds.example.org/terms",
  termsReadOn: "2026-10-31",
  on: true,
  note: "Synthetic, for tests.",
};
const get = (auth?: string) => new Request("https://careermetro.test/api/cron/events-feed", { headers: auth ? { authorization: auth } : {} });

describe("the daily event feed", () => {
  let logs: { mock: { calls: unknown[][] } };
  let warns: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
    warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.write.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    m.feeds = [];
    m.manual = [];
  });

  it("runs only with the cron secret", async () => {
    for (const auth of [undefined, "Bearer wrong", "s3cret-value"]) expect((await GET(get(auth))).status).toBe(401);
  });

  it("reads nothing while no feed is on and the hand-entered file is empty", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    m.feeds = [{ ...feed, on: false, termsReadOn: null }];
    const res = await GET(get("Bearer s3cret-value"));
    expect(await res.json()).toMatchObject({ ok: true, feedsOn: 0, manualListed: 0, manualKept: 0, manualComplete: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
  });

  it("loads the hand-entered events with every feed off, with no network call, and logs counts only", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    m.feeds = [{ ...feed, on: false, termsReadOn: null }];
    const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    m.manual = [
      {
        title: "Synthetic Python Harbour Day",
        organiser: "Example Harbour Circle",
        kind: "conference",
        startsAt: `${later}T09:00:00+05:30`,
        endsAt: `${later}T18:00:00+05:30`,
        online: false,
        city: "Pune",
        venue: "Baner, Pune",
        cost: "",
        topics: ["python"],
        sourceUrl: "https://harbour.example.org/python-day",
        checkedOn: new Date().toISOString().slice(0, 10),
        dateEvidence: "Quoted harbour date line",
      },
    ];
    m.write.mockResolvedValueOnce({ upserted: 1, cancelled: 0, topics: 2 });
    const body = await (await GET(get("Bearer s3cret-value"))).json();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ok: true, feedsOn: 0, manualListed: 1, manualKept: 1, manualComplete: true, upserted: 1 });
    const [reads] = m.write.mock.calls[0] as unknown as [{ feedId: string; source?: string; complete: boolean; rows: { sourceKey: string }[] }[]];
    expect(reads.map((r) => [r.feedId, r.source, r.complete, r.rows.length])).toEqual([["manual", "suggestion", true, 1]]);
    expect(reads[0].rows[0].sourceKey).toBe(`manual:synthetic-python-harbour-day-${later}`);
    const logged = [...logs.mock.calls, ...warns.mock.calls].map((c) => String(c[0])).join("\n");
    expect(logged).toContain("events_feed_done");
    for (const text of ["Synthetic Python Harbour", "Harbour Circle", "harbour.example.org", "Quoted harbour", "Baner"]) expect(logged).not.toContain(text);
  });

  it("reads each feed that is on, writes its rows and logs counts only", async () => {
    m.feeds = [feed, { ...feed, id: "off-feed", on: false, termsReadOn: null }];
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ics));
    m.write.mockResolvedValueOnce({ upserted: 4, cancelled: 1, topics: 9 });
    const res = await GET(get("Bearer s3cret-value"));
    const body = await res.json();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe("https://feeds.example.org/events.ics");
    expect(body).toMatchObject({ ok: true, feedsOn: 1, feedsOk: 1, listed: 12, kept: 4, upserted: 4, cancelled: 1, droppedNoTopic: 1 });
    const [reads] = m.write.mock.calls[0] as unknown as [{ feedId: string; rows: unknown[] }[]];
    expect(reads.map((r) => [r.feedId, r.rows.length])).toEqual([
      ["manual", 0],
      ["foss-united", 4],
    ]);
    const logged = [...logs.mock.calls, ...warns.mock.calls].map((c) => String(c[0])).join("\n");
    expect(logged).toContain("events_feed_done");
    for (const text of ["Synthetic FOSS Meetup", "Kubernetes", "events.example.org", "lightning round", "Magarpatta"]) expect(logged).not.toContain(text);
  });

  it("writes nothing when every feed failed, and logs the code", async () => {
    m.feeds = [feed];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const body = await (await GET(get("Bearer s3cret-value"))).json();
    expect(body).toMatchObject({ ok: true, feedsOn: 1, feedsOk: 0, kept: 0 });
    expect(m.write).not.toHaveBeenCalled();
  });
});
