import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestRun, DigestSend } from "@/lib/timetable/digest-store";

// Synthetic people and events only; Resend is never called (fetch is mocked).
type RunOptions = { site: string; cap: number; deadline: number; send: DigestSend };
const m = vi.hoisted(() => ({
  run: vi.fn<(o: RunOptions) => Promise<DigestRun>>(async () => ({ considered: 0, sent: 0, empty: 0, failed: 0, capped: false })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/timetable/digest-store", () => ({ runEventsDigests: m.run }));

import { GET } from "./route";

const SITE = "https://careermetro.test";
const TOKEN = "T".repeat(43);
const ID = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const get = (auth?: string) => new Request(`${SITE}/api/cron/events-digest`, { headers: auth ? { authorization: auth } : {} });
const message = (o: RunOptions) => ({
  to: "asha.rao@example.test",
  subject: "2 events in the next 7 days for your goals and interests",
  text: "Asha, your events for the week. SIEM night, Example Security Circle",
  html: "<p>Asha</p>",
  preheader: "",
  offUrl: `${o.site}/api/email/off?t=${TOKEN}&k=events`,
  idempotencyKey: `events-digest-${ID}-2026-11-02`,
});

describe("the Monday events digest cron", () => {
  let logs: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.run.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs only with the cron secret", async () => {
    for (const auth of [undefined, "Bearer wrong", "s3cret-value"]) expect((await GET(get(auth))).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
  });

  it("sends nothing until the email sender is set up", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await GET(get("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 0 });
    expect(m.run).not.toHaveBeenCalled();
  });

  it("asks for at most 20 of the shared budget, sends from hello@ with one-click unsubscribe and the idempotency key, and logs counts only", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "CareerMetro <codes@careermetro.com>");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const outcomes: unknown[] = [];
    m.run.mockImplementationOnce(async (o) => {
      outcomes.push(await o.send(message(o)));
      return { considered: 1, sent: 1, empty: 0, failed: 0, capped: false };
    });
    const res = await GET(get("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, considered: 1, sent: 1, empty: 0, failed: 0, capped: false });
    expect(m.run.mock.calls[0]![0].cap).toBe(20);
    expect(m.run.mock.calls[0]![0].site).toBe(SITE);
    expect(outcomes).toEqual([{ ok: true }]);
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("idempotency-key")).toBe(`events-digest-${ID}-2026-11-02`);
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("CareerMetro <hello@careermetro.com>");
    expect(body.headers).toEqual({ "List-Unsubscribe": `<${SITE}/api/email/off?t=${TOKEN}&k=events>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    const all = logs.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("events_digest_done");
    for (const secret of ["asha", "Asha", "SIEM night", "Example Security Circle", TOKEN]) expect(all).not.toContain(secret);
  });

  it("tells the run when Resend's daily quota is spent, and when a send may have gone out", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "CareerMetro <codes@careermetro.com>");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"statusCode":429,"name":"daily_quota_exceeded"}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"statusCode":500,"name":"application_error"}', { status: 500 }));
    const outcomes: unknown[] = [];
    m.run.mockImplementationOnce(async (o) => {
      outcomes.push(await o.send(message(o)), await o.send(message(o)));
      return { considered: 1, sent: 0, empty: 0, failed: 1, capped: true };
    });
    expect((await GET(get("Bearer s3cret-value"))).status).toBe(200);
    expect(outcomes).toEqual([
      { ok: false, quota: true, maybeSent: false },
      { ok: false, quota: false, maybeSent: true },
    ]);
  });

  it("answers 500 with the error's name only when the run fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "CareerMetro <codes@careermetro.com>");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    m.run.mockRejectedValueOnce(new Error("select asha.rao@example.test"));
    expect((await GET(get("Bearer s3cret-value"))).status).toBe(500);
    const all = errors.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("events_digest_failed");
    expect(all).not.toContain("asha.rao");
  });
});
