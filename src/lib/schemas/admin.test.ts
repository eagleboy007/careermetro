import { describe, expect, it } from "vitest";
import { companyReviewInput, HELD_REASON_TEXT, HELD_REASONS, heldProofRow, heldProofView, proofReviewInput, reviewQueueRow } from "@/lib/schemas";

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

describe("held-proof review schemas", () => {
  const PROOF = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
  const BADGE = "c4ed1100-0000-4000-8000-000000000001";
  const held = { id: PROOF, certId: "aws-cloud-practitioner", issuer: "Amazon Web Services", heldReason: "badge_reused", submitted: "2026-10-12", badgeId: BADGE, firstName: "Priya", lastName: "Sharma", name: "Priya Sharma", others: "1" };

  it("take a proof id and accept or reject, and nothing else", () => {
    expect(proofReviewInput.parse({ proofId: PROOF, decision: "accept" })).toEqual({ proofId: PROOF, decision: "accept" });
    expect(proofReviewInput.safeParse({ proofId: PROOF, decision: "reject" }).success).toBe(true);
    expect(proofReviewInput.safeParse({ proofId: PROOF, decision: "delete" }).success).toBe(false);
    expect(proofReviewInput.safeParse({ proofId: "not-an-id", decision: "accept" }).success).toBe(false);
    // The admin and the person come from the server, never the browser.
    expect(proofReviewInput.safeParse({ proofId: PROOF, decision: "accept", userId: PROOF }).success).toBe(false);
  });

  it("read a held row with a known reason, dropping anything else such as an email or the credential hash", () => {
    const parsed = heldProofRow.parse({ ...held, email: "priya@example.test", credentialKey: "abc" });
    expect(parsed.others).toBe(1);
    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("credentialKey");
    expect(heldProofRow.safeParse({ ...held, heldReason: "something_else" }).success).toBe(false);
    expect(heldProofRow.safeParse({ ...held, badgeId: "not a badge" }).success).toBe(false);
    expect(heldProofRow.safeParse({ ...held, badgeId: null }).success).toBe(true);
  });

  it("show a view with plain words, a short name and a Credly page only", () => {
    const view = {
      id: PROOF,
      certificate: "AWS Certified Cloud Practitioner",
      issuer: "Amazon Web Services",
      reason: "credential_reused",
      reasonText: HELD_REASON_TEXT.credential_reused,
      submittedOn: "2026-10-12",
      person: "Priya S.",
      others: 1,
      badgeUrl: `https://www.credly.com/badges/${BADGE}`,
    };
    expect(heldProofView.parse(view)).toEqual(view);
    expect(heldProofView.safeParse({ ...view, email: "priya@example.test" }).success).toBe(false);
    expect(heldProofView.safeParse({ ...view, badgeUrl: "https://evil.example/badges/x" }).success).toBe(false);
    for (const reason of HELD_REASONS) expect(HELD_REASON_TEXT[reason]).toMatch(/another account/);
  });
});
