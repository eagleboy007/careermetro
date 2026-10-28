import { describe, expect, it } from "vitest";
import { boardLinkOf, inFilter, isClosed, linkKind, myJobsEmpty, prepareHref, refFromParam, refParam, stageOf, statusOf, withInterview } from "./rules";

describe("statuses and stages", () => {
  it("maps each status to its stage and back", () => {
    expect(stageOf("saved")).toBeNull();
    expect(stageOf("applied")).toBe(1);
    expect(stageOf("offer")).toBe(4);
    expect(stageOf("no")).toBe(5);
    expect(stageOf("withdrawn")).toBe(6);
    for (const s of ["saved", "applied", "heard", "interview", "offer", "no", "withdrawn"] as const) expect(statusOf(stageOf(s))).toBe(s);
    expect(statusOf(null)).toBe("saved");
    expect(statusOf(9)).toBe("saved");
  });

  it("puts each status under its filter chip", () => {
    expect(inFilter("heard", "applied")).toBe(true);
    expect(inFilter("offer", "interview")).toBe(true);
    expect(inFilter("withdrawn", "closed")).toBe(true);
    expect(inFilter("no", "applied")).toBe(false);
    expect(inFilter("saved", "all")).toBe(true);
    expect(isClosed("no")).toBe(true);
    expect(isClosed("offer")).toBe(false);
  });

  it("says what an empty filter means", () => {
    expect(myJobsEmpty("all", "All").heading).toBe("Add the jobs you're already applying to.");
    expect(myJobsEmpty("closed", "Closed").heading).toBe("Nothing closed.");
    expect(myJobsEmpty("interview", "Interview").text).toContain("under Interview.");
  });
});

describe("boardLinkOf", () => {
  it("reads a posting on each of the four company job boards", () => {
    expect(boardLinkOf("https://boards.greenhouse.io/acme/jobs/5209072007")).toEqual({ ats: "greenhouse", token: "acme", id: "5209072007" });
    expect(boardLinkOf("https://job-boards.greenhouse.io/zscaler/jobs/5209072007?gh_src=x")).toEqual({ ats: "greenhouse", token: "zscaler", id: "5209072007" });
    expect(boardLinkOf("https://jobs.lever.co/meridian/0B8F8A52-6a1e-4b7f-9d6a-2f1d3c4b5a69/apply")).toEqual({
      ats: "lever",
      token: "meridian",
      id: "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
    });
    expect(boardLinkOf("https://jobs.ashbyhq.com/orbit/6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f")).toEqual({
      ats: "ashby",
      token: "orbit",
      id: "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    });
    expect(boardLinkOf("https://jobs.smartrecruiters.com/NECSWS/744000103212555-data-engineer-aws")).toEqual({
      ats: "smartrecruiters",
      token: "NECSWS",
      id: "744000103212555",
    });
  });

  it("refuses look-alike hosts, other schemes, ports, users and pages that aren't one posting", () => {
    for (const url of [
      "https://boards.greenhouse.io.evil.example/acme/jobs/1",
      "https://evilboards.greenhouse.io/acme/jobs/1",
      "https://jobs.lever.co.example.com/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
      "http://jobs.lever.co/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
      "https://jobs.lever.co:8443/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
      "https://me@jobs.lever.co/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
      "https://boards.greenhouse.io/acme",
      "https://boards.greenhouse.io/acme/jobs/abc",
      "https://jobs.lever.co/acme",
      "https://jobs.ashbyhq.com/orbit/not-a-uuid",
      "https://jobs.smartrecruiters.com/NECSWS/data-engineer",
      "https://jobs.smartrecruiters.com/%2e%2e/1",
      "https://www.linkedin.com/jobs/view/123",
      "not a link",
    ])
      expect(boardLinkOf(url), url).toBeNull();
  });

  it("tells the link field's hint which kind of link it has", () => {
    expect(linkKind("")).toBe("none");
    expect(linkKind("https://jobs.lever.co/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69")).toBe("board");
    expect(linkKind("https://careers.example.com/soc")).toBe("other");
    expect(linkKind("http://careers.example.com/soc")).toBe("invalid");
    expect(linkKind("careers.example.com")).toBe("invalid");
  });
});

describe("a job in an address", () => {
  const id = "4b7c6e1a-2f3d-4c5b-8a9e-0d1f2e3a4b5c";
  it("writes and reads post and check refs", () => {
    expect(refParam({ kind: "post", postId: id })).toBe(`post:${id}`);
    expect(refFromParam(`post:${id}`)).toEqual({ kind: "post", postId: id });
    expect(refFromParam(`check:${id.toUpperCase()}`)).toEqual({ kind: "check", checkId: id });
  });
  it("reads nothing else", () => {
    for (const bad of [undefined, ["post", id], "", id, `job:${id}`, "post:not-a-uuid", `post:${id}:x`, `check:`]) expect(refFromParam(bad)).toBeNull();
  });
  it("links Practice and the mock interview to the job", () => {
    expect(prepareHref({ kind: "check", checkId: id }, "practice")).toBe(`/practice?job=check%3A${id}`);
    expect(prepareHref({ kind: "post", postId: id }, "mock")).toBe(`/mock?tab=interview&job=post%3A${id}`);
  });
});

describe("withInterview", () => {
  it("moves an earlier status to Interview, and leaves Offer, a closed job or no date alone (handoff 12m)", () => {
    for (const s of ["saved", "applied", "heard", "interview"] as const) expect(withInterview(s, "2026-10-30T10:30")).toBe("interview");
    for (const s of ["offer", "no", "withdrawn"] as const) expect(withInterview(s, "2026-10-30T10:30")).toBe(s);
    expect(withInterview("applied", null)).toBe("applied");
  });
});
