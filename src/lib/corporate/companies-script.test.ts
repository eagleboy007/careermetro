import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { countsSummary, parseInputs, reviewerOf } from "../../../scripts/companies.mjs";
import { queueCounts, websiteMatches } from "./review-queue.mjs";

// The Companies workflow's script (scripts/companies.mjs): counts only in public Actions output, and verify / suspend
// by domain with the same code as /admin/companies.
const script = resolve(__dirname, "../../../scripts/companies.mjs");

describe("reviewerOf", () => {
  it("names the GitHub login that ran the workflow, and refuses anything that isn't a login", () => {
    expect(reviewerOf({ GITHUB_ACTOR: "eagleboy007" })).toBe("github:eagleboy007");
    expect(reviewerOf({ GITHUB_ACTOR: "a b'; drop" })).toBe("github");
    expect(reviewerOf({})).toBe("github");
  });
});

describe("companies script", () => {
  it("takes only list, verify or suspend, and a plain domain for a change", () => {
    expect(parseInputs({ ACTION: "list" })).toEqual({ action: "list" });
    expect(parseInputs({ ACTION: "verify", DOMAIN: " Example-Labs.in " })).toEqual({ action: "verify", domain: "example-labs.in" });
    expect(parseInputs({ ACTION: "delete", DOMAIN: "example-labs.in" }).error).toBeDefined();
    expect(parseInputs({ ACTION: "suspend", DOMAIN: "" }).error).toBeDefined();
    expect(parseInputs({ ACTION: "suspend", DOMAIN: "x'; drop table organizations;--" }).error).toBeDefined();
  });

  it("writes counts only, pointing to the in-app page, and flags a website on another domain", () => {
    const counts = queueCounts([
      { status: "pending", admins: 1 },
      { status: "verified", admins: 0 },
      { status: "suspended", admins: 0 },
    ]);
    expect(counts).toEqual({ total: 3, waiting: 1, suspended: 1, noAdmin: 2 });
    const text = countsSummary(counts);
    expect(text).toContain("- Waiting for review: 1");
    expect(text).toContain("- Suspended: 1");
    expect(text).toContain("- No Recruiter admin: 2");
    expect(text).toContain("/admin/companies");
    expect(countsSummary(queueCounts([]))).toMatch(/No company is waiting/);
    expect(websiteMatches("https://careers.example-labs.test", "example-labs.test")).toBe(true);
    expect(websiteMatches("https://other.test", "example-labs.test")).toBe(false);
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
    await sql!`delete from audit_logs where actor = 'github:cm-reviewer' and target like 'organization:%' and created_at > now() - interval '1 hour'`;
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
    // Counts only: Actions output is public, so no company's name, domain or website, and nobody's email.
    expect(listed.summary).toMatch(/Waiting for review: [1-9]/);
    expect(listed.summary).toMatch(/No Recruiter admin: [1-9]/);
    for (const out of [listed.summary, listed.stdout]) {
      expect(out).not.toContain("Example Labs");
      expect(out).not.toContain("Lonely Labs");
      expect(out).not.toContain(run);
      expect(out).not.toContain("@");
      expect(out).not.toContain("postgres://");
    }

    const verifiedRun = exec({ ACTION: "verify", DOMAIN: domain, GITHUB_ACTOR: "cm-reviewer" });
    expect(verifiedRun.status).toBe(0);
    expect(verifiedRun.summary).toBe("## Companies\n\nverify done.\n");
    expect(verifiedRun.summary + verifiedRun.stdout).not.toContain(run);
    const [verified] = await sql!`select review_status, reviewed_by, reviewed_at from organizations where id = ${org.id}`;
    expect(verified).toMatchObject({ review_status: "verified", reviewed_by: "github:cm-reviewer" });
    expect(verified.reviewed_at).not.toBeNull();
    const audit = await sql!`select action from audit_logs where target = ${`organization:${org.id}`}`;
    expect(audit.map((a) => a.action)).toEqual(["company_verified"]);

    expect(exec({ ACTION: "suspend", DOMAIN: domain, GITHUB_ACTOR: "cm-reviewer" }).status).toBe(0);
    expect((await sql!`select review_status from organizations where id = ${org.id}`)[0].review_status).toBe("suspended");
    expect(exec({ ACTION: "verify", DOMAIN: `nobody-${domain}` }).status).toBe(1);
  });
});
