import { describe, expect, it } from "vitest";
import { auditPageInput, COMPANY_AUDIT_ACTIONS, COMPANY_AUDIT_LABELS, companyAuditLine } from "@/lib/schemas";

const ID = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
const ORG = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";

describe("company audit schemas (corporate build step 7)", () => {
  it("take ids and fixed action names only", () => {
    const line = { orgId: ORG, actor: `member:${ID}`, action: "interview_booked", target: `application:${ID}` };
    expect(companyAuditLine.parse(line)).toEqual(line);
    expect(companyAuditLine.parse({ ...line, actor: "candidate", action: "interview_accepted" }).actor).toBe("candidate");
    // Someone with no role yet asking for access (security review 2026-10-13).
    expect(companyAuditLine.parse({ ...line, actor: "requester", action: "access_requested", target: `invite:${ID}` }).actor).toBe("requester");
    for (const action of ["board_viewed", "chat_read", "found_chat_read", "message_sent", "found_message_sent", "access_rechecked", "access_requested"]) {
      expect(companyAuditLine.safeParse({ ...line, action }).success).toBe(true);
    }
    for (const target of [`job:${ID}`, `member:${ID}`, `invite:${ID}`, `company:${ORG}`]) expect(companyAuditLine.safeParse({ ...line, target }).success).toBe(true);
  });

  it("refuse free text, names, emails and phones anywhere in a line", () => {
    const line = { orgId: ORG, actor: `member:${ID}`, action: "candidate_viewed", target: `application:${ID}` };
    for (const actor of ["Meera Iyer", "meera.iyer@example-labs.test", `member:${ID} Meera`, "member:", "user"]) expect(companyAuditLine.safeParse({ ...line, actor }).success).toBe(false);
    for (const target of ["application:+91 98765 43210", `application:${ID}:note`, "Priya Nair", `resume:${ID}`, `application:${ID}x`]) {
      expect(companyAuditLine.safeParse({ ...line, target }).success).toBe(false);
    }
    expect(companyAuditLine.safeParse({ ...line, action: "said hello" }).success).toBe(false);
    // No extra fields: a note or message can't ride along.
    expect(companyAuditLine.safeParse({ ...line, note: "Strong triage skills" }).success).toBe(false);
  });

  it("names every lane move and labels every action", () => {
    expect(COMPANY_AUDIT_ACTIONS).toContain("moved_not_this_time");
    expect(COMPANY_AUDIT_ACTIONS).toContain("moved_shortlisted");
    for (const a of COMPANY_AUDIT_ACTIONS) expect(COMPANY_AUDIT_LABELS[a]).toMatch(/^[A-Z]/);
    expect(new Set(COMPANY_AUDIT_ACTIONS).size).toBe(COMPANY_AUDIT_ACTIONS.length);
  });

  it("read a page cursor of a time and an id, and ignore anything else", () => {
    const before = `2026-10-13T10:00:00.000Z_${ID}`;
    expect(auditPageInput.parse({ before })).toEqual({ before });
    expect(auditPageInput.parse({})).toEqual({});
    for (const bad of ["yesterday", `2026-10-13_${ID}`, "2026-10-13T10:00:00.000Z", ["a", "b"], `2026-10-13T10:00:00.000Z_${ID}' or 1=1`]) {
      expect(auditPageInput.parse({ before: bad })).toEqual({ before: undefined });
    }
  });
});
