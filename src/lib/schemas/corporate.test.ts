import { describe, expect, it } from "vitest";
import { answerRequestInput, companyPage, inviteInput, joinFinish, signupDetails, signupFinish, workEmail, workEmailCode } from "@/lib/schemas";

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
});
