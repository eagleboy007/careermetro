// The Companies workflow (.github/workflows/companies.yml, dev/corporate-plan.md call B): Milin reviews companies
// during the beta. `list` writes the companies waiting for review, and any company left without a Recruiter admin, to
// the job summary: name, domain, website, created date and member counts. No email address of anyone is read.
// `verify` and `suspend` set one company's review status by its domain and write one audit line. It prints fixed
// messages only, never the connection string.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export const ACTIONS = ["list", "verify", "suspend"];
/** Who ran the workflow, as "github:<login>" (GITHUB_ACTOR); "github" when run outside Actions. */
export const reviewerOf = (env) => {
  const actor = (env.GITHUB_ACTOR ?? "").trim();
  return /^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(actor) ? `github:${actor}` : "github";
};

const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;

/** The workflow's inputs, checked: an action from the list, and for verify and suspend a plain lowercase domain. */
export function parseInputs(env) {
  const action = (env.ACTION ?? "").trim();
  const domain = (env.DOMAIN ?? "").trim().toLowerCase();
  if (!ACTIONS.includes(action)) return { error: `action must be one of ${ACTIONS.join(", ")}` };
  if (action === "list") return { action };
  if (!DOMAIN.test(domain)) return { error: "domain must be a company's email domain, like example-labs.in" };
  return { action, domain };
}

/** True when the website's host is the email domain or a subdomain either way; a mismatch is flagged for the check. */
export function websiteMatches(website, domain) {
  try {
    const host = new URL(website).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

/** Markdown-safe: table cells can't break the table or carry links or HTML. */
const cell = (v) => String(v ?? "").replace(/[|\\`*_<>[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ").slice(0, 120);

/** The review list as a Markdown table for the job summary. */
export function reviewTable(rows) {
  if (!rows.length) return "## Companies\n\nNo company is waiting for review, and every company has a Recruiter admin.\n";
  const lines = [
    "## Companies",
    "",
    "| Company | Domain | Website | Created | Members | Admins | Status | Notes |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const notes = [r.admins === 0 ? "no admin" : "", r.website && !websiteMatches(r.website, r.domain) ? "website on another domain" : ""].filter(Boolean).join("; ");
      return `| ${cell(r.name)} | ${cell(r.domain)} | ${cell(r.website)} | ${cell(r.created)} | ${r.members} | ${r.admins} | ${cell(r.status)} | ${notes} |`;
    }),
    "",
    "Run the workflow again with `verify` or `suspend` and the domain to change one.",
  ];
  return lines.join("\n") + "\n";
}

async function list(sql) {
  // Waiting for review, or left without an active admin (for example after the only admin deleted their account).
  return sql`
    select o.name, o.email_domain as domain, o.website, to_char(o.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as created,
      o.review_status as status,
      count(m.id) filter (where m.removed_at is null)::int as members,
      count(m.id) filter (where m.removed_at is null and m.role = 'admin')::int as admins
    from organizations o
    left join org_members m on m.org_id = o.id
    where o.email_domain is not null
    group by o.id
    having o.review_status = 'pending' or count(m.id) filter (where m.removed_at is null and m.role = 'admin') = 0
    order by o.created_at`;
}

async function setStatus(sql, action, domain, reviewer) {
  const status = action === "verify" ? "verified" : "suspended";
  return sql.begin(async (tx) => {
    const [org] = await tx`
      update organizations set review_status = ${status}, reviewed_at = now(), reviewed_by = ${reviewer}
      where email_domain = ${domain} returning id, name`;
    if (!org) return null;
    await tx`insert into audit_logs (actor, action, target) values (${reviewer}, ${`company_${status}`}, ${`organization:${org.id}`})`;
    return org;
  });
}

async function main() {
  const input = parseInputs(process.env);
  if (input.error) {
    console.error(`companies: ${input.error}`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("companies: DATABASE_URL is not set");
    process.exit(2);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  const summary = (text) => (process.env.GITHUB_STEP_SUMMARY ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, text) : process.stdout.write(text));
  try {
    if (input.action === "list") {
      const rows = await list(sql);
      summary(reviewTable(rows));
      console.log(`companies: ${rows.length} listed`);
      return;
    }
    const org = await setStatus(sql, input.action, input.domain, reviewerOf(process.env));
    if (!org) {
      console.error("companies: no company has that domain");
      process.exitCode = 1;
      return;
    }
    summary(`## Companies\n\n${cell(org.name)} (${cell(input.domain)}) is now ${input.action === "verify" ? "verified" : "suspended"}.\n`);
    console.log(`companies: ${input.action} done`);
  } catch (error) {
    console.error(`companies: failed (${error?.code ?? "error"})`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
