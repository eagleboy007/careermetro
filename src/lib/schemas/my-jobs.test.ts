import { describe, expect, it } from "vitest";
import { JOB_TEXT_MAX, JOB_TEXT_MIN } from "./constants";
import { addJobRequest, jobLink, jobPrepView, jobStatusRequest, myJobRef, nextInterviewView, saveJobRequest, updateJobRequest } from "./my-jobs";

const resumeId = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const checkId = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const text = "Security operations analyst. Monitor alerts, triage phishing reports. ".repeat(4);

describe("jobLink", () => {
  it("takes https links only, and an empty field as none", () => {
    expect(jobLink.parse(" https://jobs.lever.co/acme/8f2a ")).toBe("https://jobs.lever.co/acme/8f2a");
    expect(jobLink.parse("")).toBeNull();
    expect(jobLink.parse("   ")).toBeNull();
    expect(jobLink.parse(null)).toBeNull();
    expect(jobLink.safeParse("http://example.com/job").success).toBe(false);
    expect(jobLink.safeParse("javascript:alert(1)").success).toBe(false);
    expect(jobLink.safeParse("ftp://example.com/job").success).toBe(false);
    expect(jobLink.safeParse("not a link").success).toBe(false);
  });

  it("refuses a link longer than 2,000 characters", () => {
    expect(jobLink.safeParse(`https://example.com/${"a".repeat(1990)}`).success).toBe(false);
    expect(jobLink.safeParse(`https://example.com/${"a".repeat(1900)}`).success).toBe(true);
  });
});

describe("addJobRequest", () => {
  it("takes a description, with or without any https link", () => {
    expect(addJobRequest.parse({ resumeId, text }).url).toBeNull();
    expect(addJobRequest.parse({ resumeId, text, url: "https://careers.example.com/soc" }).url).toBe("https://careers.example.com/soc");
  });

  it("takes a company job board's link alone, but no other link alone", () => {
    expect(addJobRequest.safeParse({ resumeId, url: "https://jobs.lever.co/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69" }).success).toBe(true);
    expect(addJobRequest.safeParse({ resumeId, url: "https://careers.example.com/soc" }).success).toBe(false);
    expect(addJobRequest.safeParse({ resumeId }).success).toBe(false);
    expect(addJobRequest.safeParse({ resumeId, text: "   ", url: "" }).success).toBe(false);
  });

  it("refuses a description that is too short or too long, even with a board link", () => {
    const board = "https://job-boards.greenhouse.io/acme/jobs/123";
    expect(addJobRequest.safeParse({ resumeId, text: "x".repeat(JOB_TEXT_MIN - 1), url: board }).success).toBe(false);
    expect(addJobRequest.safeParse({ resumeId, text: "x".repeat(JOB_TEXT_MAX + 1) }).success).toBe(false);
  });

  it("refuses a bad resume id, an http link and extra fields", () => {
    expect(addJobRequest.safeParse({ resumeId: "1", text }).success).toBe(false);
    expect(addJobRequest.safeParse({ resumeId, text, url: "http://careers.example.com/soc" }).success).toBe(false);
    expect(addJobRequest.safeParse({ resumeId, text, company: "Acme" }).success).toBe(false);
  });
});

describe("saveJobRequest", () => {
  it("tidies the company, title and city the person checked", () => {
    const saved = saveJobRequest.parse({ checkId, company: "  Zephyr   Payments ", title: "SOC analyst\n(night shift)", city: " " });
    expect(saved).toEqual({ checkId, company: "Zephyr Payments", title: "SOC analyst (night shift)", city: null });
  });

  it("needs a company and a title, and keeps each under its limit", () => {
    expect(saveJobRequest.safeParse({ checkId, company: "", title: "SOC analyst" }).success).toBe(false);
    expect(saveJobRequest.safeParse({ checkId, company: "Zephyr", title: "x".repeat(121) }).success).toBe(false);
    expect(saveJobRequest.safeParse({ checkId, company: "Zephyr", title: "SOC analyst", city: "x".repeat(61) }).success).toBe(false);
  });
});

describe("statuses and refs", () => {
  it("knows the seven statuses only", () => {
    const ref = { kind: "check", checkId };
    for (const status of ["saved", "applied", "heard", "interview", "offer", "no", "withdrawn"])
      expect(jobStatusRequest.safeParse({ ref, status }).success).toBe(true);
    expect(jobStatusRequest.safeParse({ ref, status: "rejected" }).success).toBe(false);
    expect(jobStatusRequest.safeParse({ ref, status: 3 }).success).toBe(false);
  });

  it("names a feed post or a job check, never both or neither", () => {
    expect(myJobRef.safeParse({ kind: "post", postId: checkId }).success).toBe(true);
    expect(myJobRef.safeParse({ kind: "post", checkId }).success).toBe(false);
    expect(myJobRef.safeParse({ kind: "check", checkId, postId: checkId }).success).toBe(false);
    expect(myJobRef.safeParse({ kind: "save", id: checkId }).success).toBe(false);
  });
});

describe("updateJobRequest", () => {
  const ref = { kind: "check", checkId };

  it("takes dates as days, and empty fields as none", () => {
    const parsed = updateJobRequest.parse({ ref, status: "applied", appliedOn: "2026-10-21", closedOn: "", note: "  " });
    expect(parsed).toMatchObject({ appliedOn: "2026-10-21", closedOn: null, note: null });
    expect(updateJobRequest.safeParse({ ref, status: "applied", appliedOn: "21 Oct" }).success).toBe(false);
    expect(updateJobRequest.safeParse({ ref, status: "applied", appliedOn: "2026-02-30" }).success).toBe(false);
  });

  it("takes the interview as a date and time in IST, and empty as none (handoff 12m)", () => {
    expect(updateJobRequest.parse({ ref, status: "applied", interviewAt: "2026-10-30T10:30" }).interviewAt).toBe("2026-10-30T10:30");
    expect(updateJobRequest.parse({ ref, status: "applied", interviewAt: "" }).interviewAt).toBeNull();
    expect(updateJobRequest.parse({ ref, status: "applied" }).interviewAt).toBeNull();
    for (const bad of ["2026-02-30T10:30", "2026-10-30T25:00", "2026-10-30 10:30", "2026-10-30T10:30:00Z", "30 Oct, 10:30", "1999-12-31T10:00"])
      expect(updateJobRequest.safeParse({ ref, status: "applied", interviewAt: bad }).success, bad).toBe(false);
  });

  it("keeps the note under 2,000 characters", () => {
    expect(updateJobRequest.safeParse({ ref, status: "saved", note: "x".repeat(2000) }).success).toBe(true);
    expect(updateJobRequest.safeParse({ ref, status: "saved", note: "x".repeat(2001) }).success).toBe(false);
  });

  it("refuses an unknown status, an http link and extra fields", () => {
    expect(updateJobRequest.safeParse({ ref, status: "ghosted" }).success).toBe(false);
    expect(updateJobRequest.safeParse({ ref, status: "saved", url: "http://example.com" }).success).toBe(false);
    expect(updateJobRequest.safeParse({ ref, status: "saved", description: "x" }).success).toBe(false);
  });
});

describe("jobPrepView", () => {
  const prep = { ref: { kind: "check", checkId }, company: "Zephyr Payments", title: "SOC analyst", open: ["SIEM"], only: ["KQL"], skipped: ["KQL"] };
  it("names the job and its skills in words, never a job text", () => {
    expect(jobPrepView.parse(prep)).toEqual(prep);
    expect(jobPrepView.safeParse({ ...prep, description: text }).success).toBe(false);
    expect(jobPrepView.safeParse({ ...prep, company: "" }).success).toBe(false);
    expect(jobPrepView.safeParse({ ...prep, ref: { kind: "check", checkId: "x" } }).success).toBe(false);
  });
});

describe("nextInterviewView", () => {
  it("names the job and when, nothing else", () => {
    const next = { ref: { kind: "check", checkId }, company: "Zephyr Payments", title: "SOC analyst", interviewAt: "2026-10-30T05:00:00.000Z" };
    expect(nextInterviewView.parse(next)).toEqual(next);
    expect(nextInterviewView.safeParse({ ...next, note: "Ask about nights" }).success).toBe(false);
    expect(nextInterviewView.safeParse({ ...next, interviewAt: "Fri 30 Oct" }).success).toBe(false);
  });
});
