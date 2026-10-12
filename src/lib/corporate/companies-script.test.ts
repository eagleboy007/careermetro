import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { parseInputs, reviewTable, websiteMatches } from "../../../scripts/companies.mjs";

// The Companies workflow's script (scripts/companies.mjs): Milin's review list and verify / suspend by domain.
const script = resolve(__dirname, "../../../scripts/companies.mjs");

describe("companies script", () => {
  it("takes only list, verify or suspend, and a plain domain for a change", () => {
    expect(parseInputs({ ACTION: "list" })).toEqual({ action: "list" });
    expect(parseInputs({ ACTION: "verify", DOMAIN: " Example-Labs.in " })).toEqual({ action: "verify", domain: "example-labs.in" });
    expect(parseInputs({ ACTION: "delete", DOMAIN: "example-labs.in" }).error).toBeDefined();
    expect(parseInputs({ ACTION: "suspend", DOMAIN: "" }).error).toBeDefined();
    expect(parseInputs({ ACTION: "suspend", DOMAIN: "x'; drop table organizations;--" }).error).toBeDefined();
  });

  it("writes a table with no email address, flagging no admin and a website on another domain", () => {
    const table = reviewTable([
      { name: "Example Labs", domain: "example-labs.test", website: "https://www.example-labs.test", created: "2026-10-12", members: 1, admins: 1, status: "pending" },
      { name: "Left | Alone", domain: "left.test", website: "https://other.test", created: "2026-10-11", members: 0, admins: 0, status: "verified" },
    ]);
    expect(table).toContain("| Example Labs | example-labs.test | https://www.example-labs.test | 2026-10-12 | 1 | 1 | pending |  |");
    expect(table).toContain("Left \\| Alone");
    expect(table).toContain("no admin; website on another domain");
    expect(table).not.toContain("@");
    expect(reviewTable([])).toMatch(/No company is waiting/);
    expect(websiteMatches("https://careers.example-labs.test", "example-labs.test")).toBe(true);
    expect(websiteMatches("not a url", "example-labs.test")).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

describe.skipIf(!sql)("companies script (database)", () => {
  const run = `cos${Date.now()}`;
  const domain = `${run}.example-labs.test`;
  const lonely = `${run}-lonely.example-labs.test`;
  afterAll(async () => {
    await sql!`delete from organizations where email_domain in (${domain}, ${lonely})`;
    await sql!`delete from audit_logs where actor = 'milin-github' and target like 'organization:%' and created_at > now() - interval '1 hour'`;
    await sql!`delete from users where email like ${`${run}%`}`;
    await sql!.end();
  });
  const exec = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "companies-"));
    const summary = join(dir, "summary.md");
    const out = spawnSync(process.execPath, [script], {
      cwd: resolve(__dirname, "../../.."),
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DATABASE_URL: url!, GITHUB_STEP_SUMMARY: summary, ...env },
      encoding: "utf8",
    });
    let text = "";
    try {
      text = readFileSync(summary, "utf8");
    } catch {}
    return { status: out.status, summary: text, stdout: out.stdout + out.stderr };
  };

  it("lists pending companies and ones with no admin, then verifies and suspends by domain with an audit line", async () => {
    const [u] = await sql!`insert into users (email, name) values (${`${run}@example.test`}, 'Meera Iyer') returning id`;
    const [org] = await sql!`insert into organizations (name, email_domain, website) values ('Example Labs', ${domain}, ${`https://${domain}`}) returning id`;
    await sql!`insert into org_members (org_id, user_id, role, work_email_domain, work_email_verified_at, recheck_due_at) values (${org.id}, ${u.id}, 'admin', ${domain}, now(), now() + interval '180 days')`;
    await sql!`insert into organizations (name, email_domain, review_status) values ('Lonely Labs', ${lonely}, 'verified')`;

    const listed = exec({ ACTION: "list" });
    expect(listed.status).toBe(0);
    expect(listed.summary).toMatch(new RegExp(`Example Labs \\| ${domain.replace(/\./g, "\\.")} .*\\| 1 \\| 1 \\| pending`));
    expect(listed.summary).toMatch(/Lonely Labs .*no admin/);
    expect(listed.summary).not.toContain(`${run}@example.test`);
    expect(listed.stdout).not.toContain("postgres://");

    expect(exec({ ACTION: "verify", DOMAIN: domain }).status).toBe(0);
    const [verified] = await sql!`select review_status, reviewed_by, reviewed_at from organizations where id = ${org.id}`;
    expect(verified).toMatchObject({ review_status: "verified", reviewed_by: "milin-github" });
    expect(verified.reviewed_at).not.toBeNull();
    const audit = await sql!`select action from audit_logs where target = ${`organization:${org.id}`}`;
    expect(audit.map((a) => a.action)).toEqual(["company_verified"]);
    expect(exec({ ACTION: "list" }).summary).not.toContain(`| ${domain} |`);

    expect(exec({ ACTION: "suspend", DOMAIN: domain }).status).toBe(0);
    expect((await sql!`select review_status from organizations where id = ${org.id}`)[0].review_status).toBe("suspended");
    expect(exec({ ACTION: "verify", DOMAIN: `nobody-${domain}` }).status).toBe(1);
  });
});
