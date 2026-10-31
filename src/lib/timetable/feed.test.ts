import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { eventFeeds } from "@/content";
import { EVENT_FEED_DROPS, EVENT_FEED_EVENTS_MAX } from "@/lib/schemas/constants";
import { eventFeed, eventFeedsFile, feedEventRow, type EventFeed } from "@/lib/schemas";
import { cityIn, cleanText, confsTechAddresses, confsTechRows, getText, icsRows, parseIcs, readFeed } from "./feed";

// Synthetic feed answers only (fixtures/feeds/events): every organiser, link and event there is made up.
const ics = readFileSync(new URL("../../../fixtures/feeds/events/foss-united.ics", import.meta.url), "utf8");
const confs = JSON.parse(readFileSync(new URL("../../../fixtures/feeds/events/confs-tech-python.json", import.meta.url), "utf8"));
const NOW = new Date("2026-10-31T00:30:00Z");

const icsFeed: EventFeed = {
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
const confsFeed: EventFeed = {
  ...icsFeed,
  id: "confs-tech",
  organiser: "confs.tech listing",
  format: "confs-tech",
  urls: ["https://raw.example.org/conferences/{year}/python.json"],
};

const has = (topics: { kind: string; topic: string }[], kind: string, topic: string) => topics.some((t) => t.kind === kind && t.topic === topic);
const noDrops = () => Object.fromEntries(EVENT_FEED_DROPS.map((d) => [d, 0]));

describe("the event feed list (src/content/event-feeds.json)", () => {
  it("parses, and every feed that is on records the day its terms were read", () => {
    expect(eventFeedsFile.parse(eventFeeds)).toHaveLength(eventFeeds.length);
    for (const f of eventFeeds) if (f.on) expect(f.termsReadOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names only the plan's first feeds, both off until their terms are read", () => {
    expect(eventFeeds.map((f) => f.id).sort()).toEqual(["confs-tech", "foss-united"]);
    expect(eventFeeds.filter((f) => f.on)).toEqual([]);
  });

  it("never lists a site whose terms forbid reuse", () => {
    const banned = /linkedin|naukri|indeed|glassdoor|ambitionbox|wellfound|meetup\.com|lu\.ma|luma\.com|reactor|nasscom|eventbrite/i;
    for (const f of eventFeeds) for (const u of [...f.urls, f.termsUrl]) expect(u).not.toMatch(banned);
  });

  it("refuses a feed that is on with no terms date, http addresses, and {year} outside confs.tech", () => {
    expect(eventFeed.safeParse({ ...icsFeed, termsReadOn: null }).success).toBe(false);
    expect(eventFeed.safeParse({ ...icsFeed, on: false, termsReadOn: null }).success).toBe(true);
    expect(eventFeed.safeParse({ ...icsFeed, urls: ["http://feeds.example.org/events.ics"] }).success).toBe(false);
    expect(eventFeed.safeParse({ ...icsFeed, urls: ["https://feeds.example.org/{year}.ics"] }).success).toBe(false);
    expect(eventFeed.safeParse(confsFeed).success).toBe(true);
    expect(eventFeedsFile.safeParse([icsFeed, icsFeed]).success).toBe(false);
  });
});

describe("feedEventRow", () => {
  const row = {
    sourceKey: "foss-united:a",
    sourceUrl: "https://events.example.org/a",
    title: "Python evening",
    organiser: "FOSS United",
    kind: "meetup" as const,
    startsAt: new Date("2026-11-07T05:00:00Z"),
    endsAt: new Date("2026-11-07T08:00:00Z"),
    online: false,
    city: "Pune" as const,
    venue: null,
    cost: "",
    topics: [{ kind: "skill" as const, topic: "python" }],
  };

  it("takes a row within the table's checks and refuses the rest", () => {
    expect(feedEventRow.safeParse(row).success).toBe(true);
    expect(feedEventRow.safeParse({ ...row, topics: [] }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, city: null }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, online: true }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, title: "x".repeat(161) }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, title: "A &amp; B" }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, sourceUrl: "http://events.example.org/a" }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, endsAt: new Date("2026-11-07T04:00:00Z") }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, endsAt: new Date("2026-11-30T04:00:00Z") }).success).toBe(false);
    expect(feedEventRow.safeParse({ ...row, topics: Array.from({ length: 101 }, (_, i) => ({ kind: "skill", topic: `s${i}` })) }).success).toBe(false);
  });
});

describe("cleanText and cityIn", () => {
  it("turns markup into one plain line, clipped with …", () => {
    expect(cleanText("Linux &amp; <b>Kubernetes</b> &#33;\n evening", 160)).toBe("Linux & Kubernetes ! evening");
    expect(cleanText("&lt;script&gt;x&lt;/script&gt; &#x1F600;", 160)).toBe("x 😀");
    expect(cleanText("a\u0007b", 10)).toBe("a b");
    expect(cleanText("x".repeat(200), 160)).toHaveLength(160);
    expect(cleanText("x".repeat(200), 160).endsWith("…")).toBe(true);
  });

  it("finds a profile city by name or its old name, and nothing abroad", () => {
    expect(cityIn("Example Labs, Magarpatta, Pune, Maharashtra")).toBe("Pune");
    expect(cityIn("Koramangala, Bangalore")).toBe("Bengaluru");
    expect(cityIn("Bombay")).toBe("Mumbai");
    expect(cityIn("Gurgaon")).toBe("Gurugram");
    expect(cityIn("Berlin, Germany")).toBeNull();
    expect(cityIn("")).toBeNull();
  });
});

describe("parseIcs", () => {
  it("unfolds and unescapes each VEVENT, with times in UTC, India time or as dates", () => {
    const { events, listed } = parseIcs(ics);
    expect(listed).toBe(12);
    const pune = events[0] as { summary: string; description: string; location: string; start: Date; end: Date; allDay: boolean };
    expect(pune.summary).toBe("Synthetic FOSS Meetup Pune, November");
    expect(pune.description).toContain("Bring a laptop.\nAll welcome.");
    expect(pune.location).toBe("Example Labs, Magarpatta, Pune, Maharashtra");
    expect(pune.start.toISOString()).toBe("2026-11-07T05:00:00.000Z");
    expect(pune.end.toISOString()).toBe("2026-11-07T08:00:00.000Z");
    const blr = events[3] as { start: Date; end: Date; allDay: boolean };
    expect(blr.allDay).toBe(true);
    expect(blr.start.toISOString()).toBe("2026-11-20T18:30:00.000Z");
    expect(blr.end.toISOString()).toBe("2026-11-22T18:30:00.000Z");
  });

  it("skips an event whose time it can't read, and a time zone other than India's", () => {
    const bad = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:x\nDTSTART;TZID=Europe/Berlin:20261107T103000\nEND:VEVENT\nBEGIN:VEVENT\nUID:b\nSUMMARY:y\nDTSTART:soon\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseIcs(bad)).toEqual({ events: [null, null], listed: 2 });
  });

  it("reads CRLF line ends and stops at EVENT_FEED_EVENTS_MAX", () => {
    const one = "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:x\r\nDTSTART:20261107T103000Z\r\nEND:VEVENT\r\n";
    expect(parseIcs(`BEGIN:VCALENDAR\r\n${one}END:VCALENDAR\r\n`).listed).toBe(1);
    expect(parseIcs(one.repeat(EVENT_FEED_EVENTS_MAX + 5)).events).toHaveLength(EVENT_FEED_EVENTS_MAX);
  });
});

describe("icsRows", () => {
  it("keeps India and online events with a topic and an https link, and counts every drop", () => {
    const { rows, dropped, listed } = icsRows(icsFeed, ics, NOW);
    expect(listed).toBe(12);
    expect(rows.map((r) => r.sourceKey)).toEqual([
      "foss-united:evt-pune-001@example.org",
      "foss-united:evt-mumbai-002@example.org",
      "foss-united:evt-online-003@example.org",
      "foss-united:evt-blr-004@example.org",
    ]);
    expect(dropped).toEqual({ ...noDrops(), invalid: 2, cancelled: 1, past: 1, too_far: 1, too_long: 1, no_place: 1, no_topic: 1 });
    for (const r of rows) expect(feedEventRow.safeParse(r).success).toBe(true);
    const [pune, mumbai, online, blr] = rows;
    expect(pune).toMatchObject({ title: "Synthetic FOSS Meetup Pune, November", organiser: "FOSS United", kind: "meetup", city: "Pune", online: false, venue: null, cost: "" });
    expect(has(pune.topics, "skill", "python")).toBe(true);
    expect(mumbai.title).toBe("Linux & Kubernetes evening");
    expect(has(mumbai.topics, "skill", "kubernetes")).toBe(true);
    expect(online).toMatchObject({ online: true, city: null, kind: "online" });
    expect(blr).toMatchObject({ city: "Bengaluru", kind: "workshop" });
    // A date with no time shows 09:00 to 18:00 India time, its last day the one before DTEND.
    expect(blr.startsAt.toISOString()).toBe("2026-11-21T03:30:00.000Z");
    expect(blr.endsAt.toISOString()).toBe("2026-11-22T12:30:00.000Z");
  });

  it("never keeps the description", () => {
    const { rows } = icsRows(icsFeed, ics, NOW);
    expect(JSON.stringify(rows)).not.toContain("lightning round");
  });
});

describe("confs.tech", () => {
  it("reads this year's and next year's files", () => {
    expect(confsTechAddresses(confsFeed, NOW)).toEqual(["https://raw.example.org/conferences/2026/python.json", "https://raw.example.org/conferences/2027/python.json"]);
    expect(confsTechAddresses(icsFeed, NOW)).toEqual(["https://feeds.example.org/events.ics"]);
  });

  it("keeps India and online conferences, with the file's topic", () => {
    const { rows, dropped, listed } = confsTechRows(confsFeed, confs, "https://raw.example.org/conferences/2026/python.json", NOW);
    expect(listed).toBe(6);
    expect(rows.map((r) => r.title)).toEqual(["Synthetic PyConf India", "Synthetic Python Online Day", "Synthetic Hybrid Conf"]);
    expect(dropped).toEqual({ ...noDrops(), invalid: 1, past: 1, no_place: 1 });
    const [india, online, hybrid] = rows;
    expect(india).toMatchObject({ kind: "conference", city: "Hyderabad", online: false, organiser: "pyconf.example.org", sourceKey: "confs-tech:2026-11-28:pyconf.example.org/2026" });
    expect(india.startsAt.toISOString()).toBe("2026-11-28T03:30:00.000Z");
    expect(india.endsAt.toISOString()).toBe("2026-11-29T12:30:00.000Z");
    expect(has(india.topics, "skill", "python")).toBe(true);
    expect(online).toMatchObject({ kind: "online", city: null, online: true });
    expect(online.endsAt.toISOString()).toBe("2026-12-05T12:30:00.000Z");
    expect(hybrid).toMatchObject({ kind: "conference", city: "Bengaluru", online: false });
  });

  it("fails a file that isn't a list", () => {
    expect(confsTechRows(confsFeed, { not: "a list" }, "https://raw.example.org/conferences/2026/python.json", NOW).ok).toBe(false);
  });
});

describe("getText", () => {
  const answer = (body: string, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

  it("reads an answer within the size cap, and fails with a short code otherwise", async () => {
    expect(await getText("https://x.example.org", { fetchImpl: answer("hello") })).toEqual({ ok: true, text: "hello" });
    expect(await getText("https://x.example.org", { fetchImpl: answer("nope", { status: 404 }) })).toEqual({ ok: false, error: "404" });
    expect(await getText("https://x.example.org", { fetchImpl: answer("x".repeat(50)), maxBytes: 10 })).toEqual({ ok: false, error: "too_large" });
    expect(await getText("https://x.example.org", { fetchImpl: answer("x", { headers: { "content-length": "999" } }), maxBytes: 10 })).toEqual({ ok: false, error: "too_large" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await getText("https://x.example.org", { fetchImpl: down })).toEqual({ ok: false, error: "network" });
  });

  it("sends the feed's user agent, refuses redirects and never sends a cookie", async () => {
    const fetchImpl = answer("ok");
    await getText("https://x.example.org", { fetchImpl });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("user-agent")).toMatch(/^CareerMetro/);
    expect(new Headers(init.headers).get("cookie")).toBeNull();
  });
});

describe("readFeed", () => {
  it("reads an iCalendar feed whole", async () => {
    const fetchImpl = vi.fn(async () => new Response(ics));
    const read = await readFeed(icsFeed, { fetchImpl, now: NOW });
    expect(read).toMatchObject({ feedId: "foss-united", ok: true, complete: true, error: null, listed: 12 });
    expect(read.rows).toHaveLength(4);
  });

  it("takes a missing next-year confs.tech file as empty, and stays complete", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/2026/") ? new Response(JSON.stringify(confs)) : new Response("Not Found", { status: 404 }),
    );
    const read = await readFeed(confsFeed, { fetchImpl, now: NOW });
    expect(read).toMatchObject({ ok: true, complete: true, error: null, listed: 6 });
    expect(read.rows).toHaveLength(3);
  });

  it("marks a feed whose answer failed, so it cancels nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await readFeed(icsFeed, { fetchImpl, now: NOW })).toMatchObject({ ok: false, complete: false, error: "503", rows: [] });
    const half = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/2026/") ? new Response(JSON.stringify(confs)) : new Response("down", { status: 500 }),
    );
    expect(await readFeed(confsFeed, { fetchImpl: half, now: NOW })).toMatchObject({ ok: true, complete: false, error: "500" });
  });

  it("fails an answer that isn't a calendar or JSON", async () => {
    expect(await readFeed(icsFeed, { fetchImpl: vi.fn(async () => new Response("<html>hi</html>")), now: NOW })).toMatchObject({ ok: false, error: "invalid" });
    expect(await readFeed(confsFeed, { fetchImpl: vi.fn(async () => new Response("not json")), now: NOW })).toMatchObject({ ok: false, error: "invalid" });
  });

  it("keeps one row per source key when two files list the same event", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(confs)));
    const read = await readFeed(confsFeed, { fetchImpl, now: NOW });
    expect(new Set(read.rows.map((r) => r.sourceKey)).size).toBe(read.rows.length);
    expect(read.rows).toHaveLength(3);
  });
});
