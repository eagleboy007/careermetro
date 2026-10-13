import { describe, expect, it } from "vitest";
import { companyReviewInput, reviewQueueRow } from "@/lib/schemas";

const ORG = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
const row = { id: ORG, name: "Example Labs", type: "company", domain: "example-labs.test", website: "https://example-labs.test", city: "Pune", size: "51 to 200", created: "2026-10-12", status: "pending", members: 1, admins: 1 };

describe("admin schemas", () => {
  it("take a company id and verify or suspend, and nothing else", () => {
    expect(companyReviewInput.parse({ orgId: ORG, decision: "verify" })).toEqual({ orgId: ORG, decision: "verify" });
    expect(companyReviewInput.safeParse({ orgId: ORG, decision: "suspend" }).success).toBe(true);
    expect(companyReviewInput.safeParse({ orgId: ORG, decision: "delete" }).success).toBe(false);
    expect(companyReviewInput.safeParse({ orgId: "example-labs.test", decision: "verify" }).success).toBe(false);
    expect(companyReviewInput.safeParse({ orgId: ORG, decision: "verify", reviewer: "admin:someone" }).success).toBe(false);
  });

  it("read a review row with company fields and counts, dropping anything else", () => {
    expect(reviewQueueRow.parse(row)).toEqual(row);
    expect(reviewQueueRow.parse({ ...row, email: "meera@example-labs.test" })).not.toHaveProperty("email");
    expect(reviewQueueRow.safeParse({ ...row, created: "12 Oct" }).success).toBe(false);
    expect(reviewQueueRow.safeParse({ ...row, status: "deleted" }).success).toBe(false);
    expect(reviewQueueRow.safeParse({ ...row, admins: -1 }).success).toBe(false);
  });
});
