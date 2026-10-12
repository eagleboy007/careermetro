import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieJar } from "@/test/cookie-jar";

// The security checks every route handler makes before it touches data: same origin, body size and shape, an
// owner, and ownership itself (the store answers false for someone else's id, which must become a 404).
const m = vi.hoisted(() => ({
  jar: null as ReturnType<typeof cookieJar> | null,
  account: null as { id: string; name?: string | null; firstName?: string | null; lastName?: string | null } | null,
  rateAnalysis: vi.fn(),
  markStepDone: vi.fn(),
  confirmProfile: vi.fn(),
  getResumeForOwner: vi.fn(),
  ingestResume: vi.fn(),
  deleteExpired: vi.fn(),
  purgeDeleted: vi.fn(),
  renewExpired: vi.fn(async () => 0),
  exportData: vi.fn(),
  signOut: vi.fn(),
  completeGoogleRedirect: vi.fn(),
  afterSignIn: vi.fn(),
  parseResume: vi.fn(),
  createJobCheck: vi.fn(),
  getDb: vi.fn(() => {
    throw new Error("database must not be touched");
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => m.jar, headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  currentAccount: async () => m.account,
  signOut: m.signOut,
  completeGoogleRedirect: m.completeGoogleRedirect,
}));
vi.mock("@/lib/auth/after-sign-in", () => ({ afterSignIn: m.afterSignIn }));
vi.mock("@/lib/gaps/store", () => ({ rateAnalysis: m.rateAnalysis }));
vi.mock("@/lib/path/store", () => ({ markStepDone: m.markStepDone }));
vi.mock("@/lib/resume/store", () => ({ confirmProfile: m.confirmProfile, getResumeForOwner: m.getResumeForOwner }));
vi.mock("@/lib/resume/ingest", () => ({ ingestResume: m.ingestResume, deleteExpiredAnonymousResumes: m.deleteExpired }));
vi.mock("@/lib/account/delete", () => ({ purgeDeletedAccounts: m.purgeDeleted }));
vi.mock("@/lib/goals/store", () => ({ renewExpiredGoals: m.renewExpired }));
vi.mock("@/lib/account/export", () => ({ exportAccountData: m.exportData }));
vi.mock("@/lib/jobs/store", () => ({ createJobCheck: m.createJobCheck, JOB_CHECK_LIMITS: { perOwnerPerDay: 5 } }));
vi.mock("@/db", () => ({ getDb: m.getDb }));
vi.mock("@/lib/resume/parse", async (original) => ({ ...(await original<typeof import("@/lib/resume/parse")>()), parseResume: m.parseResume }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

import { GET as authCallback } from "@/app/auth/callback/route";
import { POST as signOutRoute } from "@/app/auth/sign-out/route";
import { GET as cleanup } from "@/app/api/cron/cleanup/route";
import { GET as exportData } from "@/app/api/account/export/route";
import { GET as health } from "@/app/api/health/route";
import { PUT as rate } from "@/app/api/gaps/[id]/rating/route";
import { POST as checkJob } from "@/app/api/job-checks/route";
import { PUT as stepDone } from "@/app/api/path-steps/[id]/route";
import { GET as exportResume } from "@/app/api/resume/[id]/export/route";
import { PUT as saveProfile } from "@/app/api/resume/[id]/profile/route";
import { POST as upload } from "@/app/api/resume/route";
import { OPTIONS as waitlistPreflight, POST as waitlist } from "@/app/api/waitlist/route";
import { SESSION_COOKIE } from "@/lib/session";

const SITE = "https://careermetro.test";
const SESSION = "S".repeat(43);
const ID = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const ctx = { params: Promise.resolve({ id: ID }) };

const put = (path: string, body: unknown, origin: string | null = SITE, headers: Record<string, string> = {}) =>
  new Request(SITE + path, {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

const PROFILE = { headline: null, totalYearsExperience: 2, roles: [], skills: [], education: [], certifications: [] };

beforeEach(() => {
  m.jar = cookieJar();
  m.jar.set(SESSION_COOKIE, SESSION);
  m.account = null;
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe.each([
  { name: "gap rating", call: (r: Request) => rate(r, ctx as never), path: `/api/gaps/${ID}/rating`, good: { rating: 4 }, store: () => m.rateAnalysis },
  { name: "path step", call: (r: Request) => stepDone(r, ctx as never), path: `/api/path-steps/${ID}`, good: { done: true }, store: () => m.markStepDone },
])("$name", ({ call, path, good, store }) => {
  it("refuses another site, a missing Origin, and a forged one", async () => {
    for (const origin of [null, "https://evil.example", "https://careermetro.test.evil.example"]) {
      expect((await call(put(path, good, origin))).status).toBe(403);
    }
    expect(store()).not.toHaveBeenCalled();
  });

  it("refuses bodies that are too large or the wrong shape before looking anything up", async () => {
    const bad = [
      put(path, good, SITE, { "content-length": "100000" }),
      put(path, " ".repeat(5000)),
      put(path, JSON.stringify({ ...good, pad: "x".repeat(5000) })),
      put(path, { rating: 0, done: null }),
      put(path, { rating: -1, done: "true" }),
      put(path, "not json"),
      put(path, {}),
      put(path, { rating: 6, done: "yes" }),
      put(path, { rating: 2.5, done: 1 }),
    ];
    for (const r of bad) expect((await call(r)).status).toBe(400);
    expect(store()).not.toHaveBeenCalled();
  });

  it("answers 404 without a session, and 404 when the store says it isn't this owner's", async () => {
    m.jar!.clear();
    expect((await call(put(path, good))).status).toBe(404);
    expect(store()).not.toHaveBeenCalled();

    m.jar!.set(SESSION_COOKIE, SESSION);
    store().mockResolvedValueOnce(false);
    expect((await call(put(path, good))).status).toBe(404);
    expect(store()).toHaveBeenCalledWith(ID, { sessionId: SESSION }, Object.values(good)[0]);
  });

  it("acts for the signed-in account, never the anonymous cookie beside it", async () => {
    m.account = { id: "user-1" };
    store().mockResolvedValueOnce(true);
    expect(await json(await call(put(path, good)))).toEqual({ status: 200, body: { ok: true } });
    expect(store()).toHaveBeenCalledWith(ID, { userId: "user-1" }, Object.values(good)[0]);
  });

  it("hides database errors behind a plain message", async () => {
    store().mockRejectedValueOnce(Object.assign(new Error("Failed query: select … params: secret"), { code: "57014" }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await json(await call(put(path, good)));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
    errors.mockRestore();
  });
});

describe("profile save", () => {
  const call = (r: Request) => saveProfile(r, ctx as never);
  const path = `/api/resume/${ID}/profile`;

  it("refuses another site, oversize bodies and invalid profiles before saving", async () => {
    expect((await call(put(path, PROFILE, "https://evil.example"))).status).toBe(403);
    expect((await call(put(path, PROFILE, SITE, { "content-length": String(65 * 1024) }))).status).toBe(413);
    expect((await call(put(path, "x".repeat(65 * 1024)))).status).toBe(413);
    expect((await json(await call(put(path, { ...PROFILE, skills: [{ name: "SQL", lastUsed: "June 2022", evidence: [] }] })))).body.error).toMatch(/dates/);
    expect((await call(put(path, { ...PROFILE, roles: [{ title: "", employer: "X", start: null, end: null, highlights: [] }] }))).status).toBe(400);
    expect(m.confirmProfile).not.toHaveBeenCalled();
  });

  it("answers 404 without a session and saves nothing", async () => {
    m.jar!.clear();
    expect((await call(put(path, PROFILE))).status).toBe(404);
    expect(m.confirmProfile).not.toHaveBeenCalled();
  });

  it("maps every store answer to its status", async () => {
    const cases = [
      [{ ok: true, version: 3 }, 200],
      [{ ok: false, reason: "conflict" }, 409],
      [{ ok: false, reason: "too_many" }, 429],
      [{ ok: false, reason: "not_found" }, 404],
    ] as const;
    for (const [answer, status] of cases) {
      m.confirmProfile.mockResolvedValueOnce(answer);
      expect((await call(put(path, PROFILE))).status).toBe(status);
    }
    expect(m.confirmProfile).toHaveBeenLastCalledWith(ID, { sessionId: SESSION }, PROFILE);
  });
});

describe("resume download", () => {
  const get = (format?: string) => exportResume(new Request(`${SITE}/api/resume/${ID}/export${format ? `?format=${format}` : ""}`), ctx as never);
  const resume = (confirmed: boolean) => ({ resumeId: ID, profileId: "p", version: 1, confirmed, profile: { ...PROFILE, headline: "Data analyst" } });

  it("refuses an unknown format before looking anything up", async () => {
    expect((await get("exe")).status).toBe(400);
    expect(m.getResumeForOwner).not.toHaveBeenCalled();
  });

  it("answers 404 without a session or for someone else's resume", async () => {
    m.jar!.clear();
    expect((await get("pdf")).status).toBe(404);
    m.jar!.set(SESSION_COOKIE, SESSION);
    m.getResumeForOwner.mockResolvedValueOnce(null);
    expect((await get("pdf")).status).toBe(404);
    expect(m.getResumeForOwner).toHaveBeenCalledWith(ID, { sessionId: SESSION });
  });

  it("waits until the profile is confirmed", async () => {
    m.getResumeForOwner.mockResolvedValueOnce(resume(false));
    expect((await get("pdf")).status).toBe(409);
  });

  it("sends a PDF by default, never cached, with a plain file name for someone not signed in", async () => {
    m.getResumeForOwner.mockResolvedValueOnce(resume(true));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="resume.pdf"');
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("puts the signed-in account's name on a Word file", async () => {
    m.account = { id: "user-1", name: "Old Name", firstName: "Priya", lastName: "Sharma" };
    m.getResumeForOwner.mockResolvedValueOnce(resume(true));
    const res = await get("docx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="priya-sharma-resume.docx"');
    expect(m.getResumeForOwner).toHaveBeenCalledWith(ID, { userId: "user-1" });
  });

  it("points to the Word file when the PDF can't print the letters, in plain words", async () => {
    m.getResumeForOwner.mockResolvedValueOnce({ ...resume(true), profile: { ...PROFILE, headline: "डेटा विश्लेषक" } });
    const res = await get("pdf");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("Word file");
  });

  it("logs only the format, never the resume", async () => {
    const lines: string[] = [];
    const out = vi.spyOn(console, "log").mockImplementation((line) => void lines.push(String(line)));
    m.getResumeForOwner.mockResolvedValueOnce(resume(true));
    await get("pdf");
    out.mockRestore();
    expect(lines.join("\n")).not.toContain("Data analyst");
  });
});

describe("resume upload", () => {
  const post = (form: FormData, origin: string | null = SITE, headers: Record<string, string> = {}) =>
    new Request(SITE + "/api/resume", { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers }, body: form });
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };

  it("needs our own site, consent, and a file or text, and never reads anything without them", async () => {
    expect((await upload(post(form({ consent: "yes", text: "resume" }), "https://evil.example"))).status).toBe(403);
    expect((await upload(post(form({ text: "resume" })))).status).toBe(400);
    expect((await upload(post(form({ consent: "yes" })))).status).toBe(400);
    expect((await upload(post(form({ consent: "yes", text: "   " })))).status).toBe(400);
    expect((await upload(post(form({ consent: "yes", text: "x" }), SITE, { "content-length": String(6 * 1024 * 1024) }))).status).toBe(413);
    expect(m.ingestResume).not.toHaveBeenCalled();
  });

  it("refuses a file over 4 MB without reading it", async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "cv.pdf");
    expect((await upload(post(form({ consent: "yes", file: big })))).status).toBe(413);
    expect(m.ingestResume).not.toHaveBeenCalled();
  });

  it("passes pasted text through as text with a hashed client, and hides failures", async () => {
    m.ingestResume.mockResolvedValueOnce({ ok: true, resumeId: ID });
    const res = await json(await upload(post(form({ consent: "yes", text: "My resume" }), SITE, { "x-forwarded-for": "203.0.113.7" })));
    expect(res).toEqual({ status: 200, body: { ok: true, resumeId: ID } });
    const input = m.ingestResume.mock.calls[0][0];
    expect(input.as).toBe("text");
    expect(new TextDecoder().decode(input.bytes)).toBe("My resume");
    expect(input.owner).toEqual({ sessionId: SESSION });
    expect(input.clientHash).not.toContain("203.0.113.7");

    m.ingestResume.mockRejectedValueOnce(new Error("Failed query … My resume"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await json(await upload(post(form({ consent: "yes", text: "My resume" }))));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain("My resume");
    errors.mockRestore();
  });

  it("gives a visitor without a session a new one rather than failing", async () => {
    m.jar!.clear();
    m.ingestResume.mockResolvedValueOnce({ ok: true, resumeId: ID });
    await upload(post(form({ consent: "yes", text: "My resume" })));
    expect(m.ingestResume.mock.calls[0][0].owner.sessionId).toBe(m.jar!.values.get(SESSION_COOKIE));
  });
});

describe("daily cleanup", () => {
  const get = (auth?: string) => new Request(SITE + "/api/cron/cleanup", { headers: auth ? { authorization: auth } : {} });

  it("runs only with the cron secret, and never when no secret is set", async () => {
    // Unset: "Bearer undefined" must not get in. Empty: "Bearer" (Headers trims the trailing space) must not either.
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await cleanup(get("Bearer undefined"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cleanup(get("Bearer"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const auth of [undefined, "Bearer wrong", "s3cret-value", "bearer s3cret-value", "Bearer s3cret-valu"]) expect((await cleanup(get(auth))).status).toBe(401);
    expect(m.deleteExpired).not.toHaveBeenCalled();
    expect(m.purgeDeleted).not.toHaveBeenCalled();
    expect(m.renewExpired).not.toHaveBeenCalled();
    m.deleteExpired.mockResolvedValueOnce(2);
    m.purgeDeleted.mockResolvedValueOnce(1);
    m.renewExpired.mockResolvedValueOnce(4);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await json(await cleanup(get("Bearer s3cret-value")))).toEqual({ status: 200, body: { ok: true, deleted: 2, accountsDeleted: 1 } });
    // The counts reach the logs, so a run can be checked there.
    expect(logs.mock.calls.map((c) => String(c[0])).find((l) => l.includes("cleanup_done"))).toMatch(/"anonymousResumesDeleted":2.*"accountsDeleted":1.*"peopleRenewed":4/);
    logs.mockRestore();
    // One step failing doesn't stop the other, and the job reports the failure.
    m.deleteExpired.mockRejectedValueOnce(new Error("down"));
    m.purgeDeleted.mockResolvedValueOnce(3);
    expect(await json(await cleanup(get("Bearer s3cret-value")))).toEqual({ status: 500, body: { ok: false, deleted: null, accountsDeleted: 3 } });
    // Renewing goals failing is reported too, without holding up the deletions.
    m.deleteExpired.mockResolvedValueOnce(0);
    m.purgeDeleted.mockResolvedValueOnce(0);
    m.renewExpired.mockRejectedValueOnce(new Error("down"));
    expect(await json(await cleanup(get("Bearer s3cret-value")))).toEqual({ status: 500, body: { ok: false, deleted: 0, accountsDeleted: 0 } });
  });
});

describe("download your data", () => {
  it("needs a signed-in account and sends a private, uncached attachment", async () => {
    m.account = null;
    expect((await exportData()).status).toBe(401);
    expect(m.exportData).not.toHaveBeenCalled();
    m.account = { id: ID };
    m.exportData.mockResolvedValueOnce({ exportVersion: 1, account: { email: "a@b.in" } });
    const res = await exportData();
    expect(res.status).toBe(200);
    expect(m.exportData).toHaveBeenCalledWith(ID);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="careermetro-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(await res.json()).toEqual({ exportVersion: 1, account: { email: "a@b.in" } });
  });
});

describe("health parse check", () => {
  it("costs money, so it needs the cron secret, and never runs without one", async () => {
    const get = (auth?: string) => new Request(SITE + "/api/health?check=parse", { headers: auth ? { authorization: auth } : {} });
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await health(get("Bearer undefined"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const auth of [undefined, "Bearer wrong", "s3cret-value"]) expect((await health(get(auth))).status).toBe(401);
    expect(m.parseResume).not.toHaveBeenCalled();
  });
});

describe("waitlist", () => {
  const post = (body: unknown, origin: string | null = SITE) =>
    new Request(SITE + "/api/waitlist", { method: "POST", headers: origin ? { origin, "x-forwarded-for": "198.51.100.4" } : {}, body: JSON.stringify(body) });

  it("refuses another site, catches bots quietly, and checks the form before the database", async () => {
    expect((await waitlist(post({ email: "a@example.com" }, "https://evil.example"))).status).toBe(403);
    expect(await json(await waitlist(post({ email: "a@example.com", website: "spam" })))).toEqual({ status: 200, body: { ok: true } });
    expect((await waitlist(post({ email: "not an email" }))).status).toBe(400);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("takes the public site's form at careermetro.com and www, and no other site", async () => {
    for (const site of ["https://careermetro.com", "https://www.careermetro.com"]) {
      const preflight = waitlistPreflight(new Request(SITE + "/api/waitlist", { method: "OPTIONS", headers: { origin: site } }));
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(site);
      const res = await waitlist(post({ email: "not an email", consent: true }, site));
      expect(res.status).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe(site);
    }
    for (const other of ["https://evil.example", "http://careermetro.com", "https://careermetro.com.evil.example"]) {
      const preflight = waitlistPreflight(new Request(SITE + "/api/waitlist", { method: "OPTIONS", headers: { origin: other } }));
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      const res = await waitlist(post({ email: "a@example.com", consent: true }, other));
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect((await waitlist(post({ email: "a@example.com", consent: true, website: "spam" }, "https://careermetro.com"))).status).toBe(200);
    expect(m.getDb).not.toHaveBeenCalled();
  });
});

describe("sign-out", () => {
  it("only from our own pages, and clears the anonymous cookie too", async () => {
    const req = (origin?: string) => new Request(SITE + "/auth/sign-out", { method: "POST", headers: origin ? { origin } : {} });
    expect((await signOutRoute(req("https://evil.example"))).status).toBe(403);
    expect((await signOutRoute(req())).status).toBe(403);
    expect(m.signOut).not.toHaveBeenCalled();
    expect(m.jar!.values.has(SESSION_COOKIE)).toBe(true);

    const res = await signOutRoute(req(SITE));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(SITE + "/");
    expect(m.signOut).toHaveBeenCalledOnce();
    expect(m.jar!.values.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("Google return", () => {
  it("never sends people to another site, and goes back to sign-in on a bad code", async () => {
    m.completeGoogleRedirect.mockResolvedValueOnce({ ok: false, reason: "rejected" });
    let res = await authCallback(new Request(`${SITE}/auth/callback?code=x&next=https://evil.example`));
    const failed = new URL(res.headers.get("location")!);
    expect(failed.origin).toBe(SITE);
    expect(failed.pathname).toBe("/sign-in");
    expect(failed.searchParams.get("next")).toBe("/today");
    expect(m.afterSignIn).not.toHaveBeenCalled();

    for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/\n/evil.example", "/\t/evil.example"]) {
      m.completeGoogleRedirect.mockResolvedValueOnce({ ok: true });
      m.afterSignIn.mockImplementationOnce(async (n: string) => n);
      res = await authCallback(new Request(`${SITE}/auth/callback?code=x&next=${encodeURIComponent(next)}`));
      expect(m.afterSignIn).toHaveBeenLastCalledWith("/today");
      expect(new URL(res.headers.get("location")!).origin).toBe(SITE);
    }
  });
});

describe("job check", () => {
  const posting = "Data Analyst at Example Analytics Pvt Ltd. Write SQL queries for weekly sales reports. ".repeat(4);
  const good = { resumeId: ID, roleSlug: "data-analyst", company: "Example Analytics Pvt Ltd", title: "Data Analyst", text: posting };
  const post = (body: unknown, origin: string | null = SITE, headers: Record<string, string> = {}) =>
    new Request(SITE + "/api/job-checks", {
      method: "POST",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("refuses another site, a missing Origin and a forged one", async () => {
    for (const origin of [null, "https://evil.example", "https://careermetro.test.evil.example"]) {
      expect((await checkJob(post(good, origin))).status).toBe(403);
    }
    expect(m.createJobCheck).not.toHaveBeenCalled();
  });

  it("refuses bodies that are too large or the wrong shape before looking anything up", async () => {
    expect((await checkJob(post(good, SITE, { "content-length": "100000" }))).status).toBe(413);
    expect((await checkJob(post({ ...good, text: "x".repeat(60_000) }))).status).toBe(413);
    const bad = [
      "not json",
      {},
      { ...good, text: "Too short." },
      { ...good, text: "x".repeat(12_001) },
      { ...good, company: " " },
      { ...good, title: undefined },
      { ...good, resumeId: "../../etc" },
      { ...good, roleSlug: "Data Analyst" },
      { ...good, goals: ["sql"] },
    ];
    for (const body of bad) {
      const res = await json(await checkJob(post(body)));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("Example Analytics");
    }
    expect((await json(await checkJob(post({ ...good, text: "Too short." })))).body.error).toMatch(/at least 200 characters/);
    expect((await checkJob(post({ ...good, roleSlug: "no-such-role" }))).status).toBe(404);
    expect(m.createJobCheck).not.toHaveBeenCalled();
  });

  it("answers 404 without a session, and acts for the signed-in account", async () => {
    m.jar!.clear();
    expect((await checkJob(post(good))).status).toBe(404);
    expect(m.createJobCheck).not.toHaveBeenCalled();

    m.account = { id: "user-1" };
    m.createJobCheck.mockResolvedValueOnce({ ok: true, id: "check-1", reused: false });
    expect(await json(await checkJob(post(good)))).toEqual({ status: 200, body: { ok: true, id: "check-1", reused: false } });
    expect(m.createJobCheck).toHaveBeenCalledWith({ ...good, text: posting.trim() }, { userId: "user-1" });
  });

  it("says plainly why nothing was saved", async () => {
    const cases = [
      ["not_found", 404, /couldn't find/],
      ["not_confirmed", 409, /Looks right/],
      ["limit", 429, /checked 5 jobs today.*Nothing was saved/],
      ["budget", 503, /capacity.*Nothing was saved/],
      ["unavailable", 503, /Nothing was saved/],
      ["no_skills", 422, /any skills/],
    ] as const;
    for (const [reason, status, message] of cases) {
      m.createJobCheck.mockResolvedValueOnce({ ok: false, reason });
      const res = await json(await checkJob(post(good)));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(message);
    }
  });

  it("never logs or returns the posting text, even when the store fails with it in the error", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    const spies = [vi.spyOn(console, "log").mockImplementation(capture), vi.spyOn(console, "warn").mockImplementation(capture), vi.spyOn(console, "error").mockImplementation(capture)];
    m.createJobCheck.mockResolvedValueOnce({ ok: true, id: "check-1", reused: true });
    m.createJobCheck.mockResolvedValueOnce({ ok: false, reason: "refused" });
    m.createJobCheck.mockRejectedValueOnce(Object.assign(new Error(`Failed query: insert … params: ${posting}`), { code: "57014" }));
    const bodies = [];
    for (let i = 0; i < 3; i++) bodies.push(JSON.stringify((await json(await checkJob(post(good)))).body));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const text of [...lines, ...bodies]) {
      expect(text).not.toContain("Write SQL queries");
      expect(text).not.toContain("Example Analytics");
    }
    for (const s of spies) s.mockRestore();
  });
});
