// The Companies workflow (.github/workflows/companies.yml, dev/corporate-plan.md call B), the fallback to the in-app
// review page /admin/companies. Actions logs and summaries are public in a public repository, so `list` writes counts
// only (waiting, suspended, no admin) and points to the page; no company's name, domain or website is printed.
// `verify` and `suspend` set one company's review status by its domain and write one audit line (the same code as the
// page, src/lib/corporate/review-queue.mjs), then print "done" only. Never the connection string.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { queueCounts, reviewQueue, setReviewStatus } from "../src/lib/corporate/review-queue.mjs";

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

/** The job summary for `list`: counts only, so no company is named in public Actions output. */
export function countsSummary(counts) {
  if (!counts.total) return "## Companies\n\nNo company is waiting for review, none is suspended, and every company has a Recruiter admin.\n";
  const lines = [
    "## Companies",
    "",
    `- Waiting for review: ${counts.waiting}`,
    `- Suspended: ${counts.suspended}`,
    `- No Recruiter admin: ${counts.noAdmin}`,
    "",
    "Review them signed in to CareerMetro at /admin/companies.",
  ];
  return lines.join("\n") + "\n";
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
      const counts = queueCounts(await reviewQueue(sql));
      summary(countsSummary(counts));
      console.log(`companies: ${counts.waiting} waiting, ${counts.suspended} suspended, ${counts.noAdmin} with no admin`);
      return;
    }
    const org = await setReviewStatus(sql, { domain: input.domain }, input.action, reviewerOf(process.env));
    if (!org) {
      console.error("companies: no company has that domain");
      process.exitCode = 1;
      return;
    }
    summary(`## Companies\n\n${input.action} done.\n`);
    console.log(`companies: ${input.action} done`);
  } catch (error) {
    console.error(`companies: failed (${error?.code ?? "error"})`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
