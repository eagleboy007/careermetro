import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companiesForReview, reviewCompany } from "./companies";

vi.mock("server-only", () => ({}));

// The company review page's data against a real Postgres with migrations applied: the list, and verify / suspend with
// the review record and one audit line.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;

describe.skipIf(!sql)("admin companies (database)", () => {
  const run = `adm${Date.now()}`;
  const lines: string[] = [];
  let adminId = "";

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql!`delete from audit_logs where actor = ${`admin:${adminId}`}`;
    await sql!`delete from organizations where email_domain like ${`%${run}%`}`;
    await sql!`delete from users where email like ${`${run}%`}`;
    await sql!.end();
  });

  async function person(n: string, deleted = false) {
    const [u] = await sql!`insert into users (email, name, deletion_requested_at) values (${`${run}-${n}@example.test`}, 'Meera Iyer', ${deleted ? new Date() : null}) returning id`;
    return u.id as string;
  }
  async function company(n: string, status: "pending" | "verified" | "suspended", website: string | null, admin?: string) {
    const domain = `${run}-${n}.example-labs.test`;
    const [org] = await sql!`insert into organizations (name, email_domain, website, review_status, city, size) values (${`Labs ${n}`}, ${domain}, ${website}, ${status}, 'Pune', '51 to 200') returning id`;
    if (admin) {
      await sql!`insert into org_members (org_id, user_id, role, work_email_domain, work_email_verified_at, recheck_due_at) values (${org.id}, ${admin}, 'admin', ${domain}, now(), now() + interval '180 days')`;
    }
    return { id: org.id as string, domain };
  }

  it("lists waiting, suspended and admin-less companies with counts and flags, never an email address", async () => {
    adminId = await person("reviewer");
    const pending = await company("pending", "pending", "https://www.example.com", await person("a"));
    const suspended = await company("suspended", "suspended", null, await person("b"));
    const fine = await company("fine", "verified", null, await person("c"));
    const orphan = await company("orphan", "verified", null, await person("d", true));

    const list = (await companiesForReview({ sql: sql! })).filter((c) => c.domain.includes(run));
    expect(list.map((c) => c.id)).toEqual([pending.id, suspended.id, orphan.id]);
    expect(list.map((c) => c.id)).not.toContain(fine.id);
    expect(list[0]).toMatchObject({ name: "Labs pending", status: "pending", members: 1, admins: 1, noAdmin: false, websiteOnOtherDomain: true, city: "Pune", size: "51 to 200", type: "company" });
    expect(list[0]!.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The only admin deleted their account: the company has no admin left.
    expect(list[2]).toMatchObject({ status: "verified", members: 0, admins: 0, noAdmin: true, websiteOnOtherDomain: false });
    expect(JSON.stringify(list)).not.toContain("@");
  });

  it("verifies and suspends by id with the reviewer as admin:<user id> and one audit line each", async () => {
    const org = await company("review", "pending", null, await person("e"));
    const verified = await reviewCompany(adminId, { orgId: org.id, decision: "verify" }, { sql: sql! });
    expect(verified).toEqual({ ok: true, message: "Labs review is verified." });
    const [row] = await sql!`select review_status, reviewed_by, reviewed_at from organizations where id = ${org.id}`;
    expect(row).toMatchObject({ review_status: "verified", reviewed_by: `admin:${adminId}` });
    expect(row.reviewed_at).not.toBeNull();
    expect((await companiesForReview({ sql: sql! })).map((c) => c.id)).not.toContain(org.id);

    expect(await reviewCompany(adminId, { orgId: org.id, decision: "suspend" }, { sql: sql! })).toEqual({ ok: true, message: "Labs review is suspended." });
    expect((await companiesForReview({ sql: sql! })).find((c) => c.id === org.id)?.status).toBe("suspended");
    await reviewCompany(adminId, { orgId: org.id, decision: "verify" }, { sql: sql! });

    const audit = await sql!`select actor, action from audit_logs where target = ${`organization:${org.id}`} order by created_at`;
    expect(audit).toEqual([
      { actor: `admin:${adminId}`, action: "company_verified" },
      { actor: `admin:${adminId}`, action: "company_suspended" },
      { actor: `admin:${adminId}`, action: "company_verified" },
    ]);
    // Logs carry the event and the decision only.
    expect(lines.join("\n")).toContain("company_reviewed");
    expect(lines.join("\n")).not.toContain("Labs review");
    expect(lines.join("\n")).not.toContain(org.domain);
  });

  it("refuses bad input and an unknown company, writing nothing", async () => {
    const before = await sql!`select count(*)::int as n from audit_logs where actor = ${`admin:${adminId}`}`;
    expect((await reviewCompany(adminId, { orgId: "example-labs.test", decision: "verify" }, { sql: sql! })).ok).toBe(false);
    expect((await reviewCompany(adminId, { orgId: adminId, decision: "delete" }, { sql: sql! })).ok).toBe(false);
    expect(await reviewCompany(adminId, { orgId: "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b", decision: "verify" }, { sql: sql! })).toEqual({
      ok: false,
      message: "That company isn't on the list any more. Reload the page to see the latest.",
    });
    const after = await sql!`select count(*)::int as n from audit_logs where actor = ${`admin:${adminId}`}`;
    expect(after[0].n).toBe(before[0].n);
  });
});
