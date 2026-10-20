import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { boardsToClose, collect, getJson, loadBoards, summaryLines, writeRun } from "../../../scripts/departures/fetch-feeds.mjs";
import { capPosts, careersUrlOf, cityOf, classify, experienceNoteOf, FEED_LIMITS, feedUrl, FUTURE_SKEW_MS, htmlLines, postedAtOf, postRow, rawPost, skillMatchersFor, skillsOf, USER_AGENT, workTypeOf } from "./feed-rules.mjs";
import { FEED_SCHEMAS, jobBoardsFile, jobPostRow } from "./feed-schemas.mjs";

// The daily Departures feed (docs/plans/departures-live-plan.md) against saved, synthetic answers of each public
// job-board API (fixtures/feeds): no network. Every company here is made up.
const root = resolve(__dirname, "../../..");
const fixture = (ats: string) => JSON.parse(readFileSync(resolve(root, `fixtures/feeds/${ats}.json`), "utf8")) as unknown;
const skills = JSON.parse(readFileSync(resolve(root, "src/content/skills.json"), "utf8")) as { id: string; name: string; aliases: string[] }[];
const matchers = skillMatchersFor(skills);

const board = (ats: string, token: string, company: string) => ({ company, ats, token, careersUrl: `https://example.com/${token}`, addedBy: "Development", addedOn: "2026-10-20" });
const boards = jobBoardsFile.parse([
  board("greenhouse", "examplelabs", "Example Labs"),
  board("lever", "examplecart", "Examplecart"),
  board("ashby", "examplepay", "Examplepay"),
  board("smartrecruiters", "ExampleWorks", "Example Works"),
  board("lever", "gone", "Gone Example"),
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch that answers each board's API address from the fixtures, and 404 for anything else. */
const fakeFetch = (answers: Record<string, unknown>) =>
  vi.fn(async (url: string | URL | Request) => {
    const key = Object.keys(answers).find((k) => String(url) === k);
    if (!key) return json({ message: "Not found" }, 404);
    const a = answers[key];
    return typeof a === "number" ? json({}, a) : json(a);
  }) as unknown as typeof fetch;
const allAnswers = () => ({
  [feedUrl("greenhouse", "examplelabs")]: fixture("greenhouse"),
  [feedUrl("lever", "examplecart")]: fixture("lever"),
  [feedUrl("ashby", "examplepay")]: fixture("ashby"),
  [feedUrl("smartrecruiters", "ExampleWorks")]: fixture("smartrecruiters"),
});

afterEach(() => vi.restoreAllMocks());

describe("the board list (src/content/job-boards.json)", () => {
  const list = loadBoards();
  const mined = JSON.parse(readFileSync(resolve(root, "scripts/jd-mining/boards.json"), "utf8")) as Record<string, string[]>;
  const host = { greenhouse: "job-boards.greenhouse.io", lever: "jobs.lever.co", ashby: "jobs.ashbyhq.com", smartrecruiters: "jobs.smartrecruiters.com" } as const;

  it("is valid, within the cap, each board once, on one of the four public APIs, with its careers page on that board", () => {
    expect(list.length).toBeGreaterThan(20);
    expect(list.length).toBeLessThanOrEqual(FEED_LIMITS.boards);
    for (const b of list) {
      expect(new URL(b.careersUrl).hostname).toBe(b.host === "eu" ? "job-boards.eu.greenhouse.io" : host[b.ats]);
      // The first list is taken from the boards skill mining already reads; boards added later passed the board check.
      if (b.ats !== "smartrecruiters" && b.addedBy === "Development") expect(mined[b.ats]).toContain(b.token);
    }
  });

  it("refuses a board listed twice, an unknown ATS, a page that isn't https and a token that isn't one", () => {
    const ok = board("lever", "examplecart", "Examplecart");
    expect(jobBoardsFile.safeParse([ok, { ...ok, token: "ExampleCart" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, ats: "workable" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, ats: "linkedin" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, careersUrl: "http://jobs.lever.co/examplecart" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, token: "../x" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, extra: 1 }]).success).toBe(false);
  });

  it("keeps a token's case, takes a dot in an Ashby token only, and refuses anything unsafe in a URL", () => {
    const sr = board("smartrecruiters", "SWIGGY", "Swiggy");
    expect(jobBoardsFile.parse([sr, board("smartrecruiters", "NielsenIQ", "NielsenIQ"), board("smartrecruiters", "KLA-Tencor", "KLA")]).map((b) => b.token)).toEqual(["SWIGGY", "NielsenIQ", "KLA-Tencor"]);
    expect(feedUrl("smartrecruiters", "SWIGGY")).toBe("https://api.smartrecruiters.com/v1/companies/SWIGGY/postings?limit=100");
    expect(jobBoardsFile.safeParse([board("ashby", "flagright.com", "Flagright")]).success).toBe(true);
    expect(feedUrl("ashby", "flagright.com")).toBe("https://api.ashbyhq.com/posting-api/job-board/flagright.com");
    expect(jobBoardsFile.safeParse([board("lever", "flagright.com", "Flagright")]).success).toBe(false);
    for (const bad of ["..", "a..b", ".a", "a.", "a/b", "a%2Fb", "a?b", "a#b", "a b", "a\\b", "", "x".repeat(81)])
      expect(jobBoardsFile.safeParse([board("ashby", bad, "Bad")]).success, bad).toBe(false);
    expect(jobPostRow.shape.boardToken.safeParse("flagright.com").success).toBe(true);
    expect(jobPostRow.shape.boardToken.safeParse("../x").success).toBe(false);
  });

  it("takes Greenhouse's EU host on a Greenhouse board only, and reads and links it there", () => {
    const eu = { ...board("greenhouse", "examplelabs", "Example Labs"), host: "eu", careersUrl: careersUrlOf("greenhouse", "examplelabs", "eu") };
    expect(jobBoardsFile.safeParse([eu]).success).toBe(true);
    expect(jobBoardsFile.safeParse([{ ...eu, host: "us" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...board("lever", "examplecart", "Examplecart"), host: "eu" }]).success).toBe(false);
    expect(feedUrl("greenhouse", "examplelabs", "eu")).toBe("https://boards-api.eu.greenhouse.io/v1/boards/examplelabs/jobs?content=true");
    expect(eu.careersUrl).toBe("https://job-boards.eu.greenhouse.io/examplelabs");
    expect(careersUrlOf("greenhouse", "examplelabs")).toBe("https://job-boards.greenhouse.io/examplelabs");
    expect([careersUrlOf("lever", "a"), careersUrlOf("ashby", "a.com"), careersUrlOf("smartrecruiters", "SWIGGY")]).toEqual([
      "https://jobs.lever.co/a",
      "https://jobs.ashbyhq.com/a.com",
      "https://jobs.smartrecruiters.com/SWIGGY",
    ]);
  });
});

describe("feed rules", () => {
  it("asks only the four public job-board APIs, as CareerMetro", () => {
    expect(new URL(feedUrl("greenhouse", "a")).hostname).toBe("boards-api.greenhouse.io");
    expect(new URL(feedUrl("lever", "a")).hostname).toBe("api.lever.co");
    expect(new URL(feedUrl("ashby", "a")).hostname).toBe("api.ashbyhq.com");
    expect(new URL(feedUrl("smartrecruiters", "a")).hostname).toBe("api.smartrecruiters.com");
    expect(USER_AGENT).toBe("CareerMetro jobs (careermetro.vercel.app)");
  });

  it("splits skills by heading: requirements are required, nice to have and bonus are not, and other sections don't count", () => {
    const lines = ["About the role", "You will build Tableau dashboards.", "Requirements", "SQL and Excel every day", "Nice to have:", "Python", "Benefits", "Docker courses paid for"];
    expect(skillsOf(lines, matchers)).toEqual({ required: ["sql", "excel"], nice: ["python"] });
    expect(skillsOf(["Must have", "Java", "Bonus points", "Java and Docker"], matchers)).toEqual({ required: ["java"], nice: ["docker"] });
    // With no such heading, every skill the post names counts as required.
    expect(skillsOf(["We use SQL, Power BI and Python every day.", "Tableau is a plus too"], matchers).nice).toEqual([]);
    expect(skillsOf(["We use SQL, Power BI and Python every day."], matchers).required.sort()).toEqual(["power-bi", "python", "sql"]);
    // A requirement line is never taken for a heading.
    expect(skillsOf(["Requirements", "Strong SQL skills", "Excel"], matchers).required).toEqual(["sql", "excel"]);
  });

  it("reads lines from HTML escaped twice, as Greenhouse sends it", () => {
    expect(htmlLines("&amp;lt;p&amp;gt;&amp;lt;strong&amp;gt;Requirements&amp;lt;/strong&amp;gt;&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;SQL&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;")).toEqual(["Requirements", "SQL"]);
  });

  it("keeps the experience the post states, never a company's age, and reads place and work type", () => {
    expect(experienceNoteOf("2-4 years of experience in analytics")).toBe("2 to 4 years");
    expect(experienceNoteOf("5+ years of professional experience")).toBe("5+ years");
    expect(experienceNoteOf("8+ years of experience, including 2+ years with Kafka")).toBe("8+ years");
    expect(experienceNoteOf("We were founded 30 years ago.")).toBeNull();
    expect(experienceNoteOf("No years here.")).toBeNull();
    expect(cityOf("Remote - India", true)).toBe("Remote");
    expect(cityOf("Pune, Maharashtra, India", false)).toBe("Pune");
    expect(cityOf("India", false)).toBe("India");
    expect([workTypeOf("Full-time"), workTypeOf("Part-time"), workTypeOf("Contract"), workTypeOf("FullTime"), workTypeOf(null)]).toEqual(["full_time", "part_time", "freelance", "full_time", "full_time"]);
    expect(classify("Junior Data Analyst")).toBe("data-analyst");
    expect(classify("Director, Data Analytics")).toBeNull();
  });

  it("keeps India and remote-India posts only, with an https link and a title", () => {
    const at = (location: string, remote = false, url = "https://jobs.example.com/1") =>
      postRow("lever", { token: "examplecart", company: "Examplecart" }, { externalId: "1", title: "Data Analyst", url, location, remote, workType: "full_time", postedAt: null, lines: ["SQL", "Excel"] }, matchers);
    expect(at("Bengaluru")?.city).toBe("Bengaluru");
    expect(at("Remote - India", true)?.city).toBe("Remote");
    expect(at("Remote", true)).toBeNull();
    expect(at("London, United Kingdom")).toBeNull();
    expect(at("Pune", false, "http://jobs.example.com/1")).toBeNull();
    expect(at("Pune", false, "javascript:alert(1)")).toBeNull();
  });

  it("never keeps a posted time dated after the fetch (T90)", () => {
    const now = new Date(Date.UTC(2026, 9, 20, 6));
    const post = (postedAt: Date | null) =>
      postRow("lever", { token: "examplecart", company: "Examplecart" }, { externalId: "1", title: "Data Analyst", url: "https://jobs.example.com/1", location: "Pune", remote: false, workType: "full_time", postedAt, lines: ["SQL"] }, matchers, now)?.postedAt;
    const earlier = new Date(Date.UTC(2026, 9, 19));
    expect(post(earlier)).toEqual(earlier);
    expect(post(null)).toBeNull();
    expect(post(now)).toEqual(now);
    expect(post(new Date(now.getTime() + FUTURE_SKEW_MS))).toEqual(now);
    expect(post(new Date(now.getTime() + FUTURE_SKEW_MS + 1))).toBeNull();
    expect(post(new Date(Date.UTC(2027, 0, 1)))).toBeNull();
    expect(postedAtOf(new Date(Date.UTC(2030, 0, 1)), now)).toBeNull();
    // So a far-future post can't take a cap's place from a real one.
    const row = (externalId: string, postedAt: Date | null) => ({ ats: "lever", boardToken: "a", externalId, postedAt: postedAtOf(postedAt, now) });
    expect(capPosts([row("future", new Date(Date.UTC(2027, 0, 1))), row("real", earlier)], 1, 10).map((r) => r.externalId)).toEqual(["real"]);
  });

  it("caps posts per board and in all, keeping the newest", () => {
    const row = (ats: string, boardToken: string, externalId: string, day: number) => ({ ats, boardToken, externalId, postedAt: new Date(Date.UTC(2026, 9, day)) });
    const rows = [row("lever", "a", "1", 1), row("lever", "a", "2", 5), row("lever", "a", "3", 3), row("ashby", "b", "4", 2), row("ashby", "b", "5", 4)];
    expect(capPosts(rows, 2, 10).map((r) => r.externalId)).toEqual(["2", "5", "3", "4"]);
    expect(capPosts(rows, 2, 3).map((r) => r.externalId)).toEqual(["2", "5", "3"]);
  });

  it("checks each row: https only, title 2 to 160, skill ids as slugs", () => {
    const ok = { ats: "lever", boardToken: "examplecart", externalId: "1", url: "https://jobs.lever.co/examplecart/1", title: "Data Analyst", company: "Examplecart", city: "Pune", workType: "full_time", experienceNote: null, roleSlug: "data-analyst", requiredSkillIds: ["sql"], niceSkillIds: [], postedAt: null };
    expect(jobPostRow.safeParse(ok).success).toBe(true);
    expect(jobPostRow.safeParse({ ...ok, url: "http://jobs.lever.co/examplecart/1" }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, title: "D" }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, title: "x".repeat(161) }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, requiredSkillIds: ["Not a slug"] }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, ats: "naukri" }).success).toBe(false);
  });

  it("reads each saved answer through its schema into posts", () => {
    const gh = FEED_SCHEMAS.greenhouse;
    const jobs = gh.jobs(gh.board.parse(fixture("greenhouse")));
    const parsed = jobs.map((j: unknown) => gh.job.safeParse(j));
    // One posting has no title, so it alone is skipped.
    expect(parsed.filter((p: { success: boolean }) => !p.success)).toHaveLength(1);
    const first = rawPost("greenhouse", gh.job.parse(jobs[0]), "examplelabs");
    expect(first).toMatchObject({ externalId: "4001", title: "Junior Data Analyst", location: "Pune, Maharashtra, India", workType: "full_time" });
    expect(first.lines).toContain("Requirements");
    expect(FEED_SCHEMAS.lever.board.safeParse({ jobs: [] }).success).toBe(false);
  });
});

describe("getJson", () => {
  it("names a failed board by status only, times out after the limit, and refuses an answer over the size cap", async () => {
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: fakeFetch({}) })).toEqual({ ok: false, error: "404" });
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init!.signal!.reason))),
    ) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: hang, timeoutMs: 20 })).toEqual({ ok: false, error: "timeout" });
    const big = vi.fn(async () => new Response("x".repeat(2000))) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: big, maxBytes: 1000 })).toEqual({ ok: false, error: "too_large" });
    const notJson = vi.fn(async () => new Response("<html>")) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: notJson })).toEqual({ ok: false, error: "not_json" });
    const sent = fakeFetch({ "https://api.lever.co/v0/postings/x?mode=json": [] });
    expect(await getJson("https://api.lever.co/v0/postings/x?mode=json", { fetchImpl: sent })).toEqual({ ok: true, data: [] });
    expect(vi.mocked(sent).mock.calls[0][1]).toMatchObject({ headers: { "user-agent": USER_AGENT }, redirect: "error" });
  });

  it("refuses an answer that ended up anywhere but https", async () => {
    const plain = vi.fn(async () => Object.defineProperty(json([]), "url", { value: "http://api.lever.co/v0/postings/x" })) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: plain })).toEqual({ ok: false, error: "network" });
    const thrown = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: thrown })).toEqual({ ok: false, error: "network" });
  });
});

describe("collect", () => {
  it("reads every board once, keeps checked India rows, skips a failed board with its status, and logs nothing", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchImpl = fakeFetch(allAnswers());
    const { rows, results } = await collect(boards, matchers, { fetchImpl });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(boards.length);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    expect(results.find((r) => r.token === "gone")).toEqual({ ats: "lever", token: "gone", ok: false, posts: 0, error: "404" });
    expect(results.filter((r) => r.ok).map((r) => [r.token, r.posts]).sort()).toEqual([
      ["ExampleWorks", 1],
      ["examplecart", 2],
      ["examplelabs", 3],
      ["examplepay", 1],
    ]);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    expect(byId.get("4001")).toMatchObject({ company: "Example Labs", city: "Pune", experienceNote: "2 to 4 years", roleSlug: "data-analyst", requiredSkillIds: ["sql", "excel"], niceSkillIds: ["python"] });
    expect(byId.get("4003")).toMatchObject({ city: "Remote" });
    // Too few skills found: kept, and Departures shows it with no fit.
    expect(byId.get("4004")).toMatchObject({ requiredSkillIds: [], roleSlug: null });
    expect(byId.get("a1b2c3d4-0001")).toMatchObject({ city: "Bengaluru", roleSlug: "qa-automation-engineer", requiredSkillIds: ["java", "selenium", "api-testing"], niceSkillIds: ["docker"] });
    expect(byId.get("a1b2c3d4-0002")).toMatchObject({ city: "Mumbai", workType: "part_time" });
    expect(byId.get("9f1e0000-aaaa-4bbb-8ccc-000000000001")).toMatchObject({ city: "Gurugram", experienceNote: "5+ years", requiredSkillIds: ["typescript", "react"], niceSkillIds: ["kubernetes"] });
    expect(byId.get("744000000000001")).toMatchObject({ city: "Chennai", url: "https://jobs.smartrecruiters.com/ExampleWorks/744000000000001" });
    // Not in India, http, no title, remote without India: left out.
    for (const id of ["4002", "4005", "4006", "a1b2c3d4-0003", "9f1e0000-aaaa-4bbb-8ccc-000000000002", "744000000000002"]) expect(byId.has(id)).toBe(false);
    for (const r of rows) expect(jobPostRow.safeParse(r).success).toBe(true);
    // No post text in a row: only these fields.
    expect(Object.keys(rows[0]).sort()).toEqual(["ats", "boardToken", "city", "company", "experienceNote", "externalId", "niceSkillIds", "postedAt", "requiredSkillIds", "roleSlug", "title", "url", "workType"]);
  });

  it("fails a board whose answer doesn't fit its schema, and the summary names boards and counts only", async () => {
    const { rows, results } = await collect(boards.slice(0, 1), matchers, { fetchImpl: fakeFetch({ [feedUrl("greenhouse", "examplelabs")]: { postings: [] } }) });
    expect(rows).toEqual([]);
    expect(results).toEqual([{ ats: "greenhouse", token: "examplelabs", ok: false, posts: 0, error: "invalid" }]);
    const full = await collect(boards, matchers, { fetchImpl: fakeFetch(allAnswers()) });
    const text = summaryLines(full.results, full.rows.length, { open: 7, closed: 1 }).join("\n");
    expect(text).toContain("Boards read: 4 of 5. Posts kept: 7.");
    expect(text).toContain("Skipped lever/gone: last_error 404");
    expect(text).not.toMatch(/Analyst|Engineer|SQL|Pune/);
  });

  it("marks a board the caps cut and a full SmartRecruiters page, keeps every post it saw, and closes only on the board read whole (T79)", async () => {
    const capped = await collect(boards, matchers, { fetchImpl: fakeFetch(allAnswers()), perBoard: 1 });
    const gh = capped.results.find((r) => r.token === "examplelabs");
    expect(gh).toMatchObject({ ok: true, posts: 3, capped: true });
    expect(capped.rows.filter((r) => r.boardToken === "examplelabs")).toHaveLength(1);
    expect(capped.seen.filter((s) => s.k === "greenhouse:examplelabs")).toHaveLength(3);
    expect(capped.results.find((r) => r.token === "examplepay")?.capped).toBeUndefined();
    const closing = boardsToClose([], capped.results, boards, false);
    // Read whole though capped: it closes what left it, and writeRun keeps the posts it saw (seen) open.
    expect(closing).toContain("greenhouse:examplelabs");
    expect(closing).toContain("ashby:examplepay");
    expect(summaryLines(capped.results, capped.rows.length, null).join("\n")).toContain("Capped greenhouse/examplelabs: over the post caps");

    const page = fixture("smartrecruiters") as { content: unknown[] };
    const full = { content: Array.from({ length: FEED_LIMITS.smartRecruitersPage }, (_, i) => page.content[i % page.content.length]) };
    const sr = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [feedUrl("smartrecruiters", "ExampleWorks")]: full }) });
    expect(sr.results[0]).toMatchObject({ ok: true, truncated: true });
    expect(boardsToClose([], sr.results, boards, false)).toEqual([]);
    const more = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [feedUrl("smartrecruiters", "ExampleWorks")]: { ...page, totalFound: 250 } }) });
    expect(more.results[0]).toMatchObject({ truncated: true });
    const whole = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch(allAnswers()) });
    expect(whole.results[0].truncated).toBeUndefined();
    expect(summaryLines(sr.results, sr.rows.length, null).join("\n")).toContain("Kept open smartrecruiters/ExampleWorks: answer cut short");
  });

  it("closes only boards it read, and boards taken off the list", () => {
    const results = [
      { ats: "lever" as const, token: "a", ok: true, posts: 1, error: null },
      { ats: "lever" as const, token: "b", ok: false, posts: 0, error: "500" },
    ];
    const listed = jobBoardsFile.parse([board("lever", "a", "A"), board("lever", "b", "B")]);
    expect(boardsToClose(["lever:a", "lever:b", "ashby:old"], results, listed)).toEqual(["ashby:old", "lever:a"]);
    expect(boardsToClose(["lever:a", "lever:b", "ashby:old"], results, listed, false)).toEqual(["lever:a"]);
    expect(boardsToClose(["lever:bad,key}"], [], listed)).toEqual([]);
    expect(boardsToClose(["ashby:flagright.com", "ashby:a..b"], [], listed)).toEqual(["ashby:flagright.com"]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

describe.skipIf(!sql)("the feed's writes (database)", () => {
  const run = `feed${Date.now()}`;
  const mine = jobBoardsFile.parse([board("greenhouse", `${run}g`, "Example Labs"), board("lever", `${run}l`, "Examplecart")]);
  const runIds: string[] = [];
  const answers = (greenhouse: unknown, lever: unknown) =>
    fakeFetch({ [feedUrl("greenhouse", `${run}g`)]: greenhouse, [feedUrl("lever", `${run}l`)]: lever });
  const posts = () => sql!`select external_id, board_token, closed_at, city from job_posts where board_token in ${sql!(mine.map((b) => b.token))} order by external_id`;
  const t0 = new Date("2026-01-05T01:00:00Z");
  const at = (days: number) => new Date(t0.getTime() + days * 86_400_000);
  const once = async (fetchImpl: typeof fetch, days: number) => {
    const { rows, results } = await collect(mine, matchers, { fetchImpl });
    const written = await writeRun(sql!, { boards: mine, rows, results, startedAt: at(days), now: new Date(at(days).getTime() + 1000), closeUnlisted: false });
    runIds.push(written.runId);
    return written;
  };

  afterAll(async () => {
    await sql!`delete from job_posts where board_token in ${sql!(mine.map((b) => b.token))}`;
    if (runIds.length) await sql!`delete from job_feed_runs where id in ${sql!(runIds)}`;
    await sql!.end();
  });

  it("upserts by external id, closes what left a board it read, closes nothing on a board that failed, and reopens a post that came back", async () => {
    await once(answers(fixture("greenhouse"), fixture("lever")), 0);
    expect((await posts()).map((p) => [p.external_id, p.closed_at])).toEqual([
      ["4001", null],
      ["4003", null],
      ["4004", null],
      ["a1b2c3d4-0001", null],
      ["a1b2c3d4-0002", null],
    ]);

    // Next day: two Greenhouse posts left the board, and Lever failed.
    const gh = fixture("greenhouse") as { jobs: { id: unknown }[] };
    const second = await once(answers({ jobs: gh.jobs.filter((j) => j.id === 4001) }, 500), 1);
    expect(second.closed).toBe(2);
    const after = new Map((await posts()).map((p) => [p.external_id, p.closed_at]));
    expect(after.get("4001")).toBeNull();
    expect(after.get("4003")).not.toBeNull();
    expect(after.get("4004")).not.toBeNull();
    expect(after.get("a1b2c3d4-0001")).toBeNull();
    expect(after.get("a1b2c3d4-0002")).toBeNull();
    const [runRow] = await sql!`select boards_ok, boards_failed, posts_closed, finished_at from job_feed_runs where id = ${second.runId}`;
    expect(runRow).toMatchObject({ boards_ok: 1, boards_failed: 1, posts_closed: 2 });
    expect(runRow.finished_at).not.toBeNull();

    // The day after, 4003 is back on the board: the same row opens again.
    await once(answers({ jobs: gh.jobs.filter((j) => j.id === 4001 || j.id === 4003) }, fixture("lever")), 2);
    const back = new Map((await posts()).map((p) => [p.external_id, p.closed_at]));
    expect(back.get("4003")).toBeNull();
    expect(back.get("4004")).not.toBeNull();
    expect((await posts()).filter((p) => p.external_id === "4003")).toHaveLength(1);
  });

  it("never closes a post the caps left out, but still closes one that left a capped board (T79)", async () => {
    await once(answers(fixture("greenhouse"), fixture("lever")), 3);
    const { rows, results, seen } = await collect(mine, matchers, { fetchImpl: answers(fixture("greenhouse"), fixture("lever")), perBoard: 1 });
    const startedAt = at(4);
    const written = await writeRun(sql!, { boards: mine, rows, results, seen, startedAt, now: new Date(startedAt.getTime() + 1000), closeUnlisted: false });
    runIds.push(written.runId);
    // Both boards were cut to one post; the others were seen, so all stay open.
    expect(written.closed).toBe(0);
    expect((await posts()).filter((p) => p.closed_at !== null).map((p) => p.external_id)).toEqual([]);

    // Next day 4004 is gone from Greenhouse and the caps still cut both boards: 4004 closes, every post seen stays open.
    const gh = fixture("greenhouse") as { jobs: { id: unknown }[] };
    const later = await collect(mine, matchers, { fetchImpl: answers({ jobs: gh.jobs.filter((j) => j.id !== 4004) }, fixture("lever")), perBoard: 1 });
    expect(later.results.every((r) => r.capped)).toBe(true);
    const next = at(5);
    const closing = await writeRun(sql!, { ...later, boards: mine, startedAt: next, now: new Date(next.getTime() + 1000), closeUnlisted: false });
    runIds.push(closing.runId);
    expect(closing.closed).toBe(1);
    expect((await posts()).filter((p) => p.closed_at !== null).map((p) => p.external_id)).toEqual(["4004"]);
  });

  it("replaces a stored posted_at that is still in the future, and keeps a sane one the board stopped sending (T90)", async () => {
    const runAt = new Date("2026-10-20T12:00:00Z");
    const write = async (greenhouse: unknown) => {
      const { rows, results } = await collect(mine, matchers, { fetchImpl: answers(greenhouse, fixture("lever")), now: runAt });
      const written = await writeRun(sql!, { boards: mine, rows, results, startedAt: runAt, now: runAt, closeUnlisted: false });
      runIds.push(written.runId);
    };
    await write(fixture("greenhouse"));
    const token = `${run}g`;
    await sql!`update job_posts set posted_at = '2099-01-01T00:00:00Z' where board_token = ${token} and external_id = '4001'`;
    await sql!`update job_posts set posted_at = '2026-10-17T09:00:00Z' where board_token = ${token} and external_id = '4003'`;
    // The board now sends no date for either.
    const gh = fixture("greenhouse") as { jobs: Record<string, unknown>[] };
    const undated = { jobs: gh.jobs.map((j) => (j.id === 4001 || j.id === 4003 ? { ...j, first_published: undefined, updated_at: undefined } : j)) };
    await write(undated);
    const dated = new Map(
      (await sql!`select external_id, posted_at from job_posts where board_token = ${token} and external_id in ('4001', '4003')`).map((r) => [r.external_id, r.posted_at]),
    );
    expect(dated.get("4001")).toBeNull();
    expect((dated.get("4003") as Date).toISOString()).toBe("2026-10-17T09:00:00.000Z");
  });

  it("refuses a row the table's checks don't allow", async () => {
    await expect(
      sql!`insert into job_posts (ats, board_token, external_id, url, title, company, city) values ('lever', ${`${run}x`}, '1', 'http://example.com', 'Data Analyst', 'Example', 'Pune')`,
    ).rejects.toThrow();
    await expect(
      sql!`insert into job_posts (ats, board_token, external_id, url, title, company, city) values ('naukri', ${`${run}x`}, '1', 'https://example.com', 'Data Analyst', 'Example', 'Pune')`,
    ).rejects.toThrow();
  });
});
