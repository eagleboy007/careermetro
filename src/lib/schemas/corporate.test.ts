import { describe, expect, it } from "vitest";
import {
  answerRequestInput,
  companyPage,
  inviteInput,
  jobInput,
  jobReportInput,
  jobRequirements,
  jobStatusInput,
  joinFinish,
  reportInput,
  signupDetails,
  signupFinish,
  workEmail,
  workEmailCode,
} from "@/lib/schemas";

const details = {
  type: "company",
  legalName: "Example Labs Private Limited",
  name: "Example Labs",
  website: "example-labs.test",
  workEmail: "Meera.Iyer@Example-Labs.test",
  size: "51 to 200",
  city: "Pune",
};

describe("corporate schemas", () => {
  it("take the sign-up details, lowercasing the work email and making the website https", () => {
    const parsed = signupDetails.parse(details);
    expect(parsed.workEmail).toBe("meera.iyer@example-labs.test");
    expect(parsed.website).toBe("https://example-labs.test");
  });

  it("refuse free mail with a plain reason", () => {
    const r = signupDetails.safeParse({ ...details, workEmail: "meera@gmail.com" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/Personal addresses like Gmail/);
    expect(workEmail.safeParse("x@yahoo.co.in").success).toBe(false);
  });

  it("refuse an http website, a missing name and an unknown size", () => {
    expect(signupDetails.safeParse({ ...details, website: "http://example-labs.test" }).success).toBe(false);
    expect(signupDetails.safeParse({ ...details, name: " " }).success).toBe(false);
    expect(signupDetails.safeParse({ ...details, size: "huge" }).success).toBe(false);
    expect(signupDetails.safeParse({ ...details, type: "agency" }).success).toBe(false);
  });

  it("take a 6-digit code with spaces between groups, and nothing else", () => {
    expect(workEmailCode.parse(" 042 917 ")).toBe("042917");
    expect(workEmailCode.safeParse("04291").success).toBe(false);
    expect(workEmailCode.safeParse("0429170").success).toBe(false);
    expect(workEmailCode.safeParse("abcdef").success).toBe(false);
    expect(signupFinish.safeParse({ details, code: "123456" }).success).toBe(true);
    expect(joinFinish.safeParse({ workEmail: "a@example-labs.test", code: "12345a" }).success).toBe(false);
  });

  it("keep the company page short and check the GSTIN or CIN shape", () => {
    const page = { about: "", industry: "", offices: "", gstinOrCin: "" };
    expect(companyPage.parse(page)).toEqual(page);
    expect(companyPage.parse({ ...page, gstinOrCin: "27aaacn1234f1z5" }).gstinOrCin).toBe("27AAACN1234F1Z5");
    expect(companyPage.safeParse({ ...page, gstinOrCin: "27AAACN1234F1Z" }).success).toBe(false);
    expect(companyPage.safeParse({ ...page, gstinOrCin: "U72900PN2019PTC123456" }).success).toBe(true);
    expect(companyPage.safeParse({ ...page, about: "x".repeat(401) }).success).toBe(false);
    expect(companyPage.safeParse({ ...page, industry: "Mining" }).success).toBe(false);
  });

  it("give only the three roles", () => {
    expect(inviteInput.safeParse({ workEmail: "a@example-labs.test", role: "hiring" }).success).toBe(true);
    expect(inviteInput.safeParse({ workEmail: "a@example-labs.test", role: "owner" }).success).toBe(false);
    expect(answerRequestInput.safeParse({ requestId: "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69", answer: "decline" }).success).toBe(true);
    expect(answerRequestInput.safeParse({ requestId: "x", answer: "admin" }).success).toBe(false);
  });

  describe("jobs", () => {
    const req = { required: ["siem", "linux"], oneOf: [["python", "bash-scripting"]], nice: ["digital-forensics"] };
    const job = { roleSlug: "cyber-security-analyst", title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req };
    const yes = { real: true, noFee: true, fair: true };

    it("take requirements as skill ids in three groups, each skill in one place", () => {
      expect(jobRequirements.parse(req)).toEqual(req);
      expect(jobRequirements.safeParse({ ...req, nice: ["siem"] }).success).toBe(false);
      expect(jobRequirements.safeParse({ ...req, oneOf: [["python", "python"]] }).success).toBe(false);
    });

    it("refuse free text where a skill id goes", () => {
      const r = jobRequirements.safeParse({ ...req, required: ["Splunk and stuff"] });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toBe("Pick skills from the list.");
    });

    it("cap required at 8 and one-of groups at 2 to 6 skills", () => {
      const ids = Array.from({ length: 9 }, (_, i) => `skill-${i}`);
      expect(jobRequirements.safeParse({ ...req, required: ids }).success).toBe(false);
      expect(jobRequirements.safeParse({ ...req, required: ids.slice(0, 8) }).success).toBe(true);
      expect(jobRequirements.safeParse({ ...req, oneOf: [["python"]] }).success).toBe(false);
      expect(jobRequirements.safeParse({ ...req, oneOf: [ids.slice(0, 7)] }).success).toBe(false);
      // A draft may start with no required skill; opening checks that later.
      expect(jobRequirements.safeParse({ required: [], oneOf: [], nice: [] }).success).toBe(true);
    });

    it("take a job with a title, work type and city, and no team by default", () => {
      const parsed = jobInput.parse({ ...job, title: "  SOC Analyst L1 " });
      expect(parsed.title).toBe("SOC Analyst L1");
      expect(parsed.hiring).toEqual([]);
      expect(parsed.open).toBeUndefined();
      expect(jobInput.safeParse({ ...job, workType: "Full time" }).success).toBe(false);
      expect(jobInput.safeParse({ ...job, title: "x" }).success).toBe(false);
      expect(jobInput.safeParse({ ...job, city: "" }).success).toBe(false);
      expect(jobInput.safeParse({ ...job, roleSlug: "Not a slug" }).success).toBe(false);
    });

    it("open a job only with all three ticks", () => {
      expect(jobInput.safeParse({ ...job, open: yes }).success).toBe(true);
      const r = jobInput.safeParse({ ...job, open: { ...yes, fair: false } });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toBe("Tick the three boxes to open the job.");
    });

    it("never turn the AI round on: the form has no such field", () => {
      expect(jobInput.parse({ ...job, aiRound: true })).not.toHaveProperty("aiRound");
    });

    it("move a job only to open, paused or closed", () => {
      const jobId = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
      expect(jobStatusInput.safeParse({ jobId, to: "paused" }).success).toBe(true);
      expect(jobStatusInput.safeParse({ jobId, to: "draft" }).success).toBe(false);
    });

    it("report a job with a reason, and keep the Inbox's report to its own targets", () => {
      const jobId = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
      expect(jobReportInput.safeParse({ jobId, reason: "fake_or_spam" }).success).toBe(true);
      expect(jobReportInput.safeParse({ jobId, reason: "boring" }).success).toBe(false);
      expect(jobReportInput.safeParse({ jobId, reason: "other", note: "x".repeat(501) }).success).toBe(false);
      expect(reportInput.safeParse({ conversationId: jobId, target: "job", reason: "other" }).success).toBe(false);
    });
  });
});
