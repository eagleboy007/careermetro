import { describe, expect, it } from "vitest";
import { afterWrongTry, codeMatches, codeState, hashCode, hashWorkEmail, isCodeShape, LOCK_MS, MAX_WRONG_TRIES, newCode } from "./codes";
import { codeDelivery } from "./delivery";
import { checkWorkEmail, emailDomain, isFreeMail, normalWebsite, websiteHost, websiteMatchesDomain } from "./domains";
import { acceptsApplications, canEditJob, canMoveApplications, canOpenJobs, canSeeBoard, canWithdraw, moveRefusal, withdrawConfirmText, canPostJobs, isLive, jobsBlocked, openRefusal, removalRefusal, secondAdminDaysLeft, secondAdminDueAt, statusMoveRefusal } from "./rules";

const NOW = new Date("2026-10-12T10:00:00Z");
const DAY = 86_400_000;
const env = { NAME_HASH_KEY: "test-key" };

describe("work-email domains", () => {
  it.each(["a@gmail.com", "a@GMAIL.com", "a@yahoo.co.in", "a@outlook.com", "a@hotmail.com", "a@live.com", "a@icloud.com", "a@proton.me", "a@rediffmail.com", "a@zohomail.in", "a@aol.com", "a@yandex.com", "a@gmx.com", "a@mail.com", "a@eu.gmail.com"])(
    "refuses free mail %s",
    (email) => {
      expect(checkWorkEmail(email)).toEqual({ ok: false, problem: "free_mail" });
    },
  );

  it("accepts a company domain, including the example test domain used by the browser walk", () => {
    expect(checkWorkEmail("Meera.Iyer@Example-Labs.test")).toEqual({ ok: true, domain: "example-labs.test" });
    expect(checkWorkEmail("hr@nimbusfintech.in")).toEqual({ ok: true, domain: "nimbusfintech.in" });
    // Not free mail just because a free provider's name is inside it.
    expect(isFreeMail("notgmail.com")).toBe(false);
    expect(isFreeMail("gmail.com.example.in")).toBe(false);
  });

  it("needs the company's domain or a subdomain of it", () => {
    expect(checkWorkEmail("a@example-labs.test", "example-labs.test").ok).toBe(true);
    expect(checkWorkEmail("a@mail.example-labs.test", "example-labs.test").ok).toBe(true);
    expect(checkWorkEmail("a@other.test", "example-labs.test")).toEqual({ ok: false, problem: "wrong_domain" });
    expect(checkWorkEmail("a@evil-example-labs.test", "example-labs.test")).toEqual({ ok: false, problem: "wrong_domain" });
  });

  it.each(["", "plain", "a@", "@b.com", "a@b", "a b@c.com", "a@@b.com", "a@b.c0m", ".a@b.com", "a..b@c.com", "a@-b.com"])("refuses a malformed address %j", (email) => {
    expect(emailDomain(email)).toBeNull();
    expect(checkWorkEmail(email)).toEqual({ ok: false, problem: "invalid" });
  });

  it("takes websites over https only, with or without the scheme", () => {
    expect(normalWebsite("example-labs.test")).toBe("https://example-labs.test");
    expect(normalWebsite("https://WWW.Example-Labs.test/")).toBe("https://www.example-labs.test");
    expect(normalWebsite("https://example-labs.test/careers/")).toBe("https://example-labs.test/careers");
    expect(websiteHost("http://example-labs.test")).toBeNull();
    expect(websiteHost("javascript:alert(1)")).toBeNull();
    expect(websiteHost("https://user:pw@example-labs.test")).toBeNull();
    expect(websiteHost("https://localhost")).toBeNull();
  });

  it("flags a website on another domain for the hand check", () => {
    expect(websiteMatchesDomain("https://www.example-labs.test", "example-labs.test")).toBe(true);
    expect(websiteMatchesDomain("https://example-labs.test", "mail.example-labs.test")).toBe(true);
    expect(websiteMatchesDomain("https://other.test", "example-labs.test")).toBe(false);
  });
});

describe("work-email codes", () => {
  const row = { expiresAt: new Date(NOW.getTime() + 600_000), attempts: 0, lockedUntil: null, usedAt: null, codeHash: "h" };

  it("are six digits from a secure source", () => {
    for (let i = 0; i < 50; i++) expect(isCodeShape(newCode())).toBe(true);
  });

  it("are stored as a keyed hash bound to the row and the person, and compared exactly", () => {
    const stored = hashCode("row-1", "user-1", "042917", env);
    expect(stored).not.toContain("042917");
    expect(codeMatches(stored, "row-1", "user-1", "042917", env)).toBe(true);
    expect(codeMatches(stored, "row-1", "user-1", "042918", env)).toBe(false);
    expect(codeMatches(stored, "row-1", "user-2", "042917", env)).toBe(false);
    expect(codeMatches(stored, "row-2", "user-1", "042917", env)).toBe(false);
    expect(codeMatches(stored, "row-1", "user-1", "42917", env)).toBe(false);
    expect(codeMatches(null, "row-1", "user-1", "042917", env)).toBe(false);
    expect(codeMatches(stored, "row-1", "user-1", "042917", { NAME_HASH_KEY: "other" })).toBe(false);
  });

  it("expire after 10 minutes", () => {
    expect(codeState(row, NOW)).toBe("open");
    expect(codeState(row, new Date(NOW.getTime() + 600_000))).toBe("expired");
  });

  it("lock for 15 minutes on the fifth wrong try", () => {
    let attempts = 0;
    for (let i = 1; i < MAX_WRONG_TRIES; i++) {
      const next = afterWrongTry({ attempts }, NOW);
      expect(next).toEqual({ attempts: i, lockedUntil: null, spent: false });
      attempts = next.attempts;
    }
    const last = afterWrongTry({ attempts }, NOW);
    expect(last).toEqual({ attempts: 5, lockedUntil: new Date(NOW.getTime() + LOCK_MS), spent: true });
    expect(codeState({ ...row, ...last }, NOW)).toBe("locked");
    expect(codeState({ ...row, ...last }, new Date(NOW.getTime() + LOCK_MS))).toBe("expired");
  });

  it("hash invited emails the same whatever the case, and never as the address", () => {
    expect(hashWorkEmail("Rahul.M@Example-Labs.test", env)).toBe(hashWorkEmail("rahul.m@example-labs.test ", env));
    expect(hashWorkEmail("rahul.m@example-labs.test", env)).not.toContain("example");
  });
});

describe("code delivery until an email sender exists", () => {
  it("sends nothing in production, even with the preview flag", () => {
    expect(codeDelivery({ VERCEL_ENV: "production", NODE_ENV: "production", TODAY_PREVIEW: "1" })).toBe("off");
  });
  it("shows the code on screen with the test sign-in, and locally", () => {
    expect(codeDelivery({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("test");
    expect(codeDelivery({ NODE_ENV: "development" })).toBe("test");
  });
  it("sends nothing on a preview that has real sign-in, or a production build run elsewhere", () => {
    expect(codeDelivery({ VERCEL_ENV: "preview", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBe("off");
    expect(codeDelivery({ NODE_ENV: "production" })).toBe("off");
  });
});

describe("the admin rule (Milin, 2026-10-12)", () => {
  const due = secondAdminDueAt(NOW);

  it("gives a new company 14 days to add a second admin", () => {
    expect(due).toEqual(new Date(NOW.getTime() + 14 * DAY));
    expect(secondAdminDaysLeft({ adminCount: 1, secondAdminDueAt: due }, NOW)).toBe(14);
    expect(secondAdminDaysLeft({ adminCount: 1, secondAdminDueAt: due }, new Date(NOW.getTime() + 13.5 * DAY))).toBe(1);
    expect(secondAdminDaysLeft({ adminCount: 1, secondAdminDueAt: due }, new Date(NOW.getTime() + 20 * DAY))).toBe(0);
    expect(secondAdminDaysLeft({ adminCount: 2, secondAdminDueAt: due }, NOW)).toBeNull();
  });

  it("opens jobs only for a verified company with two admins, or one admin within the 14 days", () => {
    const verified = { reviewStatus: "verified" as const, adminCount: 1, secondAdminDueAt: due };
    expect(canOpenJobs(verified, NOW)).toBe(true);
    expect(canOpenJobs(verified, new Date(due.getTime() - 1))).toBe(true);
    expect(canOpenJobs(verified, due)).toBe(false);
    expect(canOpenJobs({ ...verified, adminCount: 2 }, new Date(due.getTime() + 100 * DAY))).toBe(true);
    expect(canOpenJobs({ ...verified, reviewStatus: "pending", adminCount: 2 }, NOW)).toBe(false);
    expect(canOpenJobs({ ...verified, reviewStatus: "suspended", adminCount: 3 }, NOW)).toBe(false);
  });

  it("never lets admins drop below two once there are two, nor to none", () => {
    expect(removalRefusal("admin", 1)).toBe("last_admin");
    expect(removalRefusal("admin", 2)).toBe("keep_two_admins");
    expect(removalRefusal("admin", 3)).toBeNull();
    expect(removalRefusal("hiring", 1)).toBeNull();
    expect(removalRefusal("interviewer", 2)).toBeNull();
  });
});

describe("jobs rules (build step 3)", () => {
  const due = secondAdminDueAt(NOW);
  const verified = { reviewStatus: "verified" as const, adminCount: 1, secondAdminDueAt: due };

  it("say why a company can't open jobs, and agree with canOpenJobs", () => {
    const cases = [
      [verified, NOW, null],
      [{ ...verified, reviewStatus: "pending" as const }, NOW, "pending"],
      [{ ...verified, reviewStatus: "suspended" as const, adminCount: 2 }, NOW, "suspended"],
      [verified, due, "second_admin"],
      [{ ...verified, adminCount: 2 }, new Date(due.getTime() + 100 * DAY), null],
    ] as const;
    for (const [org, at, reason] of cases) {
      expect(jobsBlocked(org, at)).toBe(reason);
      expect(canOpenJobs(org, at)).toBe(reason === null);
    }
  });

  it("let Recruiter admins and Hiring HR post jobs, never Interviewers", () => {
    expect(canPostJobs("admin")).toBe(true);
    expect(canPostJobs("hiring")).toBe(true);
    expect(canPostJobs("interviewer")).toBe(false);
  });

  it("let admins edit any job, Hiring HR only jobs they are on as owner or Hiring HR, and Interviewers none", () => {
    expect(canEditJob("admin", null)).toBe(true);
    expect(canEditJob("hiring", "owner")).toBe(true);
    expect(canEditJob("hiring", "hiring")).toBe(true);
    expect(canEditJob("hiring", "interviewer")).toBe(false);
    expect(canEditJob("hiring", null)).toBe(false);
    expect(canEditJob("interviewer", "owner")).toBe(false);
  });

  it("move a job only along draft, open, paused and closed, and never out of closed", () => {
    expect(statusMoveRefusal("draft", "open")).toBeNull();
    expect(statusMoveRefusal("draft", "closed")).toBeNull();
    expect(statusMoveRefusal("draft", "paused")).toBe("bad_move");
    expect(statusMoveRefusal("open", "paused")).toBeNull();
    expect(statusMoveRefusal("open", "closed")).toBeNull();
    expect(statusMoveRefusal("paused", "open")).toBeNull();
    expect(statusMoveRefusal("paused", "closed")).toBeNull();
    expect(statusMoveRefusal("closed", "open")).toBe("bad_move");
    expect(statusMoveRefusal("open", "open")).toBe("bad_move");
  });

  it("open a job only for a company that may, and with a required skill", () => {
    const req = { required: ["siem"], oneOf: [], nice: [] };
    expect(openRefusal(verified, req, NOW)).toBeNull();
    expect(openRefusal({ ...verified, reviewStatus: "pending" }, req, NOW)).toBe("pending");
    expect(openRefusal(verified, { ...req, required: [] }, NOW)).toBe("needs_required");
    expect(openRefusal({ ...verified, reviewStatus: "suspended" }, { ...req, required: [] }, NOW)).toBe("suspended");
  });

  it("show a job to candidates only while it is open and the company is verified", () => {
    expect(isLive("open", "verified")).toBe(true);
    expect(isLive("open", "suspended")).toBe(false);
    expect(isLive("open", "pending")).toBe(false);
    expect(isLive("paused", "verified")).toBe(false);
    expect(isLive("draft", "verified")).toBe(false);
  });
});

describe("the board (build step 4)", () => {
  it("shows a job's board to admins, and to anyone else only on that job's team", () => {
    expect(canSeeBoard("admin", null)).toBe(true);
    expect(canSeeBoard("hiring", null)).toBe(false);
    expect(canSeeBoard("hiring", "hiring")).toBe(true);
    expect(canSeeBoard("interviewer", "interviewer")).toBe(true);
    expect(canSeeBoard("interviewer", null)).toBe(false);
  });

  it("lets admins, and Hiring HR on the job, move candidates; never Interviewers", () => {
    expect(canMoveApplications("admin", null)).toBe(true);
    expect(canMoveApplications("hiring", "owner")).toBe(true);
    expect(canMoveApplications("hiring", "hiring")).toBe(true);
    expect(canMoveApplications("hiring", null)).toBe(false);
    expect(canMoveApplications("hiring", "interviewer")).toBe(false);
    expect(canMoveApplications("interviewer", "interviewer")).toBe(false);
  });

  it("refuses the L1 AI lane while the AI round is off, a move to the same lane, and any move after withdrawing", () => {
    const off = { aiRound: false, withdrawn: false };
    expect(moveRefusal("applied", "shortlisted", off)).toBeNull();
    expect(moveRefusal("shortlisted", "ai", off)).toBe("ai_off");
    expect(moveRefusal("shortlisted", "ai", { ...off, aiRound: true })).toBeNull();
    expect(moveRefusal("team", "team", off)).toBe("same_stage");
    expect(moveRefusal("not_this_time", "applied", off)).toBeNull();
    expect(moveRefusal("offer", "applied", off)).toBeNull();
    expect(moveRefusal("applied", "shortlisted", { ...off, withdrawn: true })).toBe("withdrawn");
  });

  it("on a closed job, allows only Not this time", () => {
    const closed = { aiRound: false, withdrawn: false, jobStatus: "closed" as const };
    expect(moveRefusal("applied", "shortlisted", closed)).toBe("job_closed");
    expect(moveRefusal("not_this_time", "applied", closed)).toBe("job_closed");
    expect(moveRefusal("team", "not_this_time", closed)).toBeNull();
    expect(moveRefusal("applied", "shortlisted", { ...closed, jobStatus: "paused" })).toBeNull();
  });

  it("lets the candidate withdraw any application not yet withdrawn, Not this time included", () => {
    expect(canWithdraw({ withdrawn: false })).toBe(true);
    expect(canWithdraw({ withdrawn: true })).toBe(false);
    expect(withdrawConfirmText("Example Labs", "not_this_time")).toBe("Withdraw? Example Labs stops seeing your profile.");
    expect(withdrawConfirmText("Example Labs", "team")).toBe("Withdraw? Example Labs stops seeing your profile for this job.");
  });

  it("takes applications only for open jobs of verified companies", () => {
    expect(acceptsApplications("open", "verified")).toBe(true);
    expect(acceptsApplications("open", "pending")).toBe(false);
    expect(acceptsApplications("open", "suspended")).toBe(false);
    expect(acceptsApplications("paused", "verified")).toBe(false);
    expect(acceptsApplications("closed", "verified")).toBe(false);
  });
});
