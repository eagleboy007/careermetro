import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADDED_BY, candidatesFrom, checkBoards, entryOf, parseCsv, passingEntries, reportLines } from "../../../scripts/departures/check-boards.mjs";
import { feedUrl, skillMatchersFor } from "./feed-rules.mjs";
import { jobBoardsFile } from "./feed-schemas.mjs";

// The board check (scripts/departures/check-boards.mjs) against the feed's saved, synthetic board answers
// (fixtures/feeds): no network. Every company here is made up.
const root = resolve(__dirname, "../../..");
const fixture = (ats: string) => JSON.parse(readFileSync(resolve(root, `fixtures/feeds/${ats}.json`), "utf8")) as unknown;
const skills = JSON.parse(readFileSync(resolve(root, "src/content/skills.json"), "utf8")) as { id: string; name: string; aliases: string[] }[];
const matchers = skillMatchersFor(skills);

const HEADER = "company,ats,token,evidence_url,india_cities_seen,role_kinds_seen,source,note,api_host_note";
const csv = [
  HEADER,
  "Example Labs,greenhouse,examplelabs,https://job-boards.greenhouse.io/examplelabs/jobs/1,Pune,data,search,,",
  'Example Labs EU,greenhouse,examplelabseu,https://job-boards.eu.greenhouse.io/examplelabseu,Pune,data,search,"DOUBT: city from search, not the post",eu host: boards-api.eu.greenhouse.io',
  "Examplecart,lever,examplecart,https://jobs.lever.co/examplecart/1,Mumbai,qa,earlier-csv,,",
  "Examplepay,ashby,examplepay.com,https://jobs.ashbyhq.com/examplepay.com,Gurugram,software,search,,",
  "Example Works,smartrecruiters,ExampleWorks,https://jobs.smartrecruiters.com/ExampleWorks,Chennai,data,search,,",
  "Gone Example,lever,gone,https://jobs.lever.co/gone,Pune,data,search,,",
  "Nowhere Example,lever,nowhere,https://jobs.lever.co/nowhere,Pune,data,search,,",
  "Twice Example,lever,ExampleCart,https://jobs.lever.co/ExampleCart,Pune,data,search,,",
  "Bad Example,lever,../x,https://jobs.lever.co/x,Pune,data,search,,",
  "Unknown Example,workable,example,https://apply.workable.com/example,Pune,data,search,,",
  "",
].join("\r\n");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeFetch = (answers: Record<string, unknown>) =>
  vi.fn(async (url: string | URL | Request) => {
    const key = Object.keys(answers).find((k) => String(url) === k);
    if (!key) return json({ message: "Not found" }, 404);
    const a = answers[key];
    return typeof a === "number" ? json({}, a) : json(a);
  }) as unknown as typeof fetch;

afterEach(() => vi.restoreAllMocks());

describe("parseCsv", () => {
  it("reads quoted fields with commas and doubled quotes, CRLF and blank lines, keyed by the header", () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(10);
    expect(rows[1]).toMatchObject({ company: "Example Labs EU", note: "DOUBT: city from search, not the post", api_host_note: "eu host: boards-api.eu.greenhouse.io" });
    expect(parseCsv('a,b\n"say ""hi""","two\nlines"\n')).toEqual([{ a: 'say "hi"', b: "two\nlines" }]);
    expect(parseCsv("a,b\n1")).toEqual([{ a: "1", b: "" }]);
    expect(parseCsv("")).toEqual([]);
  });

  it("reads the candidates file Data research collected", () => {
    const rows = parseCsv(readFileSync(resolve(root, "scripts/departures/board-candidates.csv"), "utf8"));
    expect(Object.keys(rows[0])).toEqual(HEADER.split(","));
    const { boards } = candidatesFrom(rows);
    expect(boards.length).toBeGreaterThan(100);
    expect(boards.filter((b) => b.host === "eu").every((b) => b.ats === "greenhouse")).toBe(true);
  });
});

describe("candidatesFrom", () => {
  it("keeps each known board once with its case, marks the EU host, and skips what can't be a board", () => {
    const { boards, skipped } = candidatesFrom(parseCsv(csv));
    expect(boards.map((b) => `${b.ats}:${b.token}${b.host ? `@${b.host}` : ""}`)).toEqual([
      "greenhouse:examplelabs",
      "greenhouse:examplelabseu@eu",
      "lever:examplecart",
      "ashby:examplepay.com",
      "smartrecruiters:ExampleWorks",
      "lever:gone",
      "lever:nowhere",
    ]);
    // Listed twice (another case), an unsafe token and an ATS the feed doesn't read.
    expect(skipped).toBe(3);
  });
});

describe("checkBoards and the passing filter", () => {
  const { boards } = candidatesFrom(parseCsv(csv));
  const answers = () =>
    fakeFetch({
      [feedUrl("greenhouse", "examplelabs")]: fixture("greenhouse"),
      [feedUrl("greenhouse", "examplelabseu", "eu")]: fixture("greenhouse"),
      [feedUrl("lever", "examplecart")]: fixture("lever"),
      [feedUrl("ashby", "examplepay.com")]: fixture("ashby"),
      [feedUrl("smartrecruiters", "ExampleWorks")]: fixture("smartrecruiters"),
      [feedUrl("lever", "nowhere")]: [],
    });

  it("asks each board once at its own host, counts posts and India posts by the feed's rules, and logs nothing", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchImpl = answers();
    const results = await checkBoards(boards, matchers, { fetchImpl, delayMs: 0 });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(boards.length);
    expect(vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]))).toContain("https://boards-api.eu.greenhouse.io/v1/boards/examplelabseu/jobs?content=true");
    expect(vi.mocked(fetchImpl).mock.calls[0][1]).toMatchObject({ redirect: "error" });
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    expect(results.map((r) => [r.token, r.status, r.total, r.india])).toEqual([
      ["examplelabs", "200", 6, 3],
      ["examplelabseu", "200", 6, 3],
      ["examplecart", "200", 3, 2],
      ["examplepay.com", "200", 3, 1],
      ["ExampleWorks", "200", 2, 1],
      ["gone", "404", 0, 0],
      ["nowhere", "200", 0, 0],
    ]);
  });

  it("passes only boards that answered 200 with at least one India post, as ready-to-paste board entries", async () => {
    const results = await checkBoards(boards, matchers, { fetchImpl: answers(), delayMs: 0 });
    const passing = passingEntries(results, "2026-10-20");
    expect(passing.map((p) => p.token)).toEqual(["examplelabs", "examplelabseu", "examplecart", "examplepay.com", "ExampleWorks"]);
    expect(passing[1]).toEqual({
      company: "Example Labs EU",
      ats: "greenhouse",
      token: "examplelabseu",
      host: "eu",
      careersUrl: "https://job-boards.eu.greenhouse.io/examplelabseu",
      addedBy: "Data research (checked by the board check)",
      addedOn: "2026-10-20",
    });
    expect(passing[0]).not.toHaveProperty("host");
    expect(passing[4].careersUrl).toBe("https://jobs.smartrecruiters.com/ExampleWorks");
    // The entries go straight into job-boards.json.
    expect(jobBoardsFile.safeParse(passing).success).toBe(true);
    expect(ADDED_BY).toBe(passing[0].addedBy);

    const rows = [
      { company: "A", ats: "lever" as const, token: "a", status: "200", total: 5, india: 0 },
      { company: "B", ats: "lever" as const, token: "b", status: "500", total: 0, india: 0 },
      { company: "C", ats: "lever" as const, token: "c", status: "invalid", total: 0, india: 0 },
      { company: "D", ats: "lever" as const, token: "d", status: "200", total: 1, india: 1 },
    ];
    expect(passingEntries(rows, "2026-10-20").map((p) => p.token)).toEqual(["d"]);
    expect(entryOf(rows[3], "2026-10-20").careersUrl).toBe("https://jobs.lever.co/d");
  });

  it("fails a board whose answer doesn't fit its schema, and the report names boards and counts only", async () => {
    const results = await checkBoards(boards.slice(0, 1), matchers, { fetchImpl: fakeFetch({ [feedUrl("greenhouse", "examplelabs")]: { postings: [] } }), delayMs: 0 });
    expect(results).toEqual([{ company: "Example Labs", ats: "greenhouse", token: "examplelabs", status: "invalid", total: 0, india: 0 }]);
    const all = await checkBoards(boards, matchers, { fetchImpl: answers(), delayMs: 0 });
    const text = reportLines(all, passingEntries(all, "2026-10-20").length, 3).join("\n");
    expect(text).toContain("greenhouse(eu)\texamplelabseu\t200\t6\t3");
    expect(text).toContain("lever\tgone\t404\t0\t0");
    expect(text).toContain("Boards checked: 7. Passing (200 and at least 1 India post): 5. Rows skipped (not a board, or listed twice): 3.");
    expect(text).toContain("By status: 200 6, 404 1.");
    expect(text).not.toMatch(/Example Labs|Analyst|Engineer|SQL|Pune/);
  });
});
