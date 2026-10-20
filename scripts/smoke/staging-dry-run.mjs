// Dry run of docs/launch/prod-smoke.md on staging, or any preview that offers "Continue as test user" (docs/staging.md).
// It follows sections 3 to 6 and the account deletion in section 8 in a real browser, with the test-user sign-in in
// place of section 2's emailed code (staging has no Supabase keys, so it never sends codes).
//
//   BASE=https://careermetro-git-staging-career-metro.vercel.app BYPASS=... node scripts/smoke/staging-dry-run.mjs
//
// BASE (or the first argument) is the site; BYPASS, when set, is sent as the x-vercel-protection-bypass header to that
// site only, and only when it is a careermetro-*.vercel.app host. The header, the test email and anything from the resume are never printed. One line per step, ok or FAIL;
// the exit code is 1 on any failure. The test account is deleted at the end, as section 8 says, even after a failure.
// Run by .github/workflows/smoke-staging.yml. Playwright isn't a project dependency: `npm install --no-save playwright@1.56.1`.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const STAGING = "https://careermetro-git-staging-career-metro.vercel.app";
const BASE = (process.argv[2] || process.env.BASE || STAGING).replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
// The bypass opens every preview of the project, so it only goes to the project's own Vercel hosts.
const BYPASS_HOST = /^careermetro-[a-z0-9-]+\.vercel\.app$/;
const BYPASS = process.env.BYPASS && BYPASS_HOST.test(new URL(BASE).host) ? process.env.BYPASS : "";
if (process.env.BYPASS && !BYPASS) console.log(`note: the bypass header was not sent to ${new URL(BASE).host} (not a careermetro-*.vercel.app host)`);
// The test email's domain: screenshots mask any text with it.
const EMAIL_DOMAIN = "example.com";
// Optional: a folder for a screenshot of each failed step (the workflow keeps them for 3 days).
const SHOTS = process.env.SMOKE_SHOTS || "";
const RESUME = new URL("../../fixtures/resumes/priya-sharma.pdf", import.meta.url).pathname;
// The test resume's name: a signed-in upload under another name is refused on purpose (prod-smoke.md section 2).
const NAME = "Priya Sharma";
// A fresh, unguessable address each run: anyone who types the same one on a preview sees its account.
const EMAIL = `smoke-${Date.now()}-${randomBytes(6).toString("hex")}@example.com`;

/** Never lets the bypass value or the test email reach the log, whatever an error message carries. */
const redact = (s) => {
  let out = String(s);
  for (const secret of [BYPASS, EMAIL, EMAIL.toLowerCase()]) if (secret) out = out.split(secret).join("[hidden]");
  return out;
};

if (!/^https?:\/\//.test(BASE)) {
  console.log("FAIL setup: BASE must be an http(s) URL");
  process.exit(1);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// Reduced motion, as in e2e/walk.mjs. The bypass header goes on every request of this context, so requests to any other
// host are refused below: the header never leaves for a third party (the Vercel toolbar, a font host).
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
  acceptDownloads: true,
  ...(BYPASS ? { extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } } : {}),
});
await ctx.route(
  (url) => url.origin !== ORIGIN,
  (route) => route.abort("blockedbyclient"),
);
const p = await ctx.newPage();
p.setDefaultTimeout(30000);
p.setDefaultNavigationTimeout(60000);

let failed = 0;
let blockedBy = "";
let n = 0;
const path = () => {
  try {
    return new URL(p.url()).pathname;
  } catch {
    return "?";
  }
};
/** One line per step. A failed `critical` step skips the rest of the flow, since each later step needs it. */
const step = async (name, fn, { critical = false } = {}) => {
  if (blockedBy) {
    failed++;
    console.log("FAIL", name, `(skipped: "${blockedBy}" failed)`);
    return false;
  }
  try {
    await fn();
    console.log("ok  ", name, "->", path());
    return true;
  } catch (e) {
    failed++;
    console.log("FAIL", name, "@", path(), redact(e?.message ?? e).split("\n")[0].slice(0, 300));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Staging dry run::${redact(name)}`);
    if (SHOTS) {
      // The email field and any line with the test address are masked; the resume is synthetic.
      const mask = [p.locator('input[type="email"], input[name="email"]'), p.getByText(EMAIL_DOMAIN, { exact: false })];
      await p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9.-]+/gi, "-")}.png`, fullPage: true, mask }).catch(() => {});
    }
    if (critical) blockedBy = name;
    return false;
  }
};
// The same wait as the walk: the gaps and path pages stream in behind these words.
const settled = () =>
  p
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: 90000 })
    .catch(() => {});
const reload = async () => {
  await p.reload();
  await p.waitForLoadState("networkidle");
  await settled();
};
const open = async (route) => {
  await p.goto(BASE + route);
  await p.waitForLoadState("networkidle");
  await settled();
};
/** The app's own error line on the page (role=alert), for a failure message. App copy only, never resume text. */
const alertText = async () => {
  const alert = p.getByRole("alert").first();
  return (await alert.count()) ? ` (page says: ${(await alert.innerText()).slice(0, 160)})` : "";
};
/** "Continue as test user" with the test name and email; returns the path it lands on. */
const testSignIn = async () => {
  await open("/sign-in");
  const button = p.getByRole("button", { name: "Continue as test user", exact: true });
  if (!(await button.count())) {
    throw new Error("no \"Continue as test user\" here: real sign-in is on, so run prod-smoke.md section 2 by hand instead");
  }
  await p.getByRole("textbox", { name: "Name", exact: true }).fill(NAME);
  await p.getByRole("textbox", { name: "Email", exact: true }).fill(EMAIL);
  await button.click();
  await p.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  return path();
};

let signedUp = false;
let deleted = false;
let goalNames = [];

await step("1.1 health answers ok", async () => {
  const res = await ctx.request.get(BASE + "/api/health", { timeout: 60000 });
  if (res.status() === 401 || res.status() === 403) throw new Error(`HTTP ${res.status()}: Deployment Protection blocked it; BYPASS is missing or wrong`);
  const body = await res.json().catch(() => ({}));
  if (res.status() !== 200 || body.ok !== true) {
    throw new Error(`HTTP ${res.status()}: database ${body.database}, schema ${body.schema}, claude ${body.claude}${body.missingSecrets ? `, missing ${body.missingSecrets}` : ""}`);
  }
}, { critical: true });

// Section 2 on a preview: the test user stands in for the emailed code (2.1 to 2.4); the name step (2.5) is the same.
await step("2 sign up as the test user: Create your account, with the name filled in", async () => {
  const landed = await testSignIn();
  if (!landed.startsWith("/sign-up/finish")) throw new Error(`a new address should go to Create your account, went to ${landed}`);
  await p.getByRole("heading", { name: "Create your account", exact: true }).waitFor();
  await p.getByText(/^Signed in as .+\. One last step\.$/).waitFor();
  if ((await p.getByLabel("First name", { exact: true }).inputValue()) !== "Priya") await p.getByLabel("First name", { exact: true }).fill("Priya");
  if ((await p.getByLabel("Last name", { exact: true }).inputValue()) !== "Sharma") await p.getByLabel("Last name", { exact: true }).fill("Sharma");
  await p.getByRole("checkbox", { name: "I am 18 or older and agree to the terms and privacy policy.", exact: true }).check();
  await p.getByRole("button", { name: "Create my account", exact: true }).click();
  // From here an account may exist, so the clean-up deletes it even if Today never loads.
  signedUp = true;
  await p.waitForURL(/\/today/, { timeout: 30000 });
}, { critical: true });

await step("2.5 Today with no resume: the role chips and the drop zone", async () => {
  await p.waitForLoadState("networkidle");
  await p.getByRole("group", { name: "Target role", exact: true }).waitFor();
  await p.getByText("Drop your resume here", { exact: true }).waitFor();
});

await step("3.1 upload the synthetic resume on Today: the review page", async () => {
  await p.locator('input[type="file"]').setInputFiles(RESUME);
  await p.getByRole("checkbox", { name: /^I agree that CareerMetro reads my resume/ }).check();
  await p.getByRole("button", { name: "Read my resume", exact: true }).click();
  try {
    await p.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: 90000 });
  } catch (e) {
    throw new Error(`no review page after 90 s${await alertText()}`, { cause: e });
  }
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Looks right", exact: true }).waitFor();
}, { critical: true });

await step("3.2 Looks right, then Pick a role: Closest to your resume, 1 to 3 roles, each saying why", async () => {
  await p.getByRole("button", { name: "Looks right", exact: true }).click();
  await p.getByRole("status").getByText("Saved", { exact: true }).waitFor();
  await p.getByRole("link", { name: "Pick a role", exact: true }).click();
  await p.waitForURL(/\/resume\/[0-9a-f-]+\/role/);
  await p.waitForLoadState("networkidle");
  await p.getByRole("heading", { name: "Closest to your resume", exact: true }).waitFor();
  const suggested = p.locator('section[aria-labelledby="suggested-roles"] li');
  const count = await suggested.count();
  if (count < 1 || count > 3) throw new Error(`expected 1 to 3 suggested roles, got ${count}`);
  // The text is checked, never printed: it quotes skills from the resume.
  if (!/Your resume shows \d+ of its \d+ key skills, like /.test(await suggested.first().innerText())) throw new Error("the first suggestion doesn't say why");
}, { critical: true });

await step("4.1 pick Data Analyst: the gaps, each with a status, and Build my path", async () => {
  await p.locator('a[href$="/gaps/data-analyst"]').first().click();
  await p.waitForURL(/\/gaps\/data-analyst/, { timeout: 90000 });
  await p.waitForLoadState("networkidle");
  await settled();
  await p.getByRole("heading", { name: "Your gaps", exact: true, level: 1 }).waitFor();
  if (!(await p.getByRole("region", { name: "Your gaps", exact: true }).locator("article").count())) throw new Error("no gaps shown");
  await p.getByRole("link", { name: "Build my path", exact: true }).waitFor();
}, { critical: true });

await step("4.2 Build my path: steps with free resources and Works toward", async () => {
  await p.getByRole("link", { name: "Build my path", exact: true }).click();
  await p.waitForURL(/\/path\/data-analyst/, { timeout: 90000 });
  await p.waitForLoadState("networkidle");
  await settled();
  await p.getByRole("heading", { name: "Your path", exact: true, level: 1 }).waitFor();
  await p.getByText(/^Works toward: /).first().waitFor();
  await p.getByText(/^\d+ of \d+ steps done$/).waitFor();
}, { critical: true });

await step("4.3 Mark done on the first step: 1 of N steps done after a reload", async () => {
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/path-steps/") && r.ok()),
    p.getByRole("button", { name: /^Mark done: / }).first().click(),
  ]);
  await reload();
  await p.getByText(/^1 of \d+ steps done$/).waitFor();
});

await step("5.1 Today: this resume's own goals and the first ride", async () => {
  await open("/today");
  const goals = p.locator('section[aria-label="Your goals"]');
  await goals.waitFor();
  goalNames = (await goals.locator("li b").allTextContents()).map((s) => s.trim()).filter(Boolean);
  if (!goalNames.length) throw new Error("no goals listed");
  if (goalNames.includes("SQL window functions")) throw new Error("example goals shown, not this resume's");
  // Day one shows the Welcome card with "Your first ride"; Today's ride takes its place after the first tick.
  await p.locator('section[aria-label="Welcome"], section[aria-label="Today\'s ride"]').first().waitFor();
}, { critical: true });

await step("5.2 Hours a week: 8 h stays pressed after a reload", async () => {
  const hours = p.getByRole("group", { name: "Hours a week", exact: true });
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/today"),
    hours.getByRole("button", { name: "8 h", exact: true }).click(),
  ]);
  await reload();
  await p.getByRole("group", { name: "Hours a week", exact: true }).getByRole("button", { name: "8 h", exact: true, pressed: true }).waitFor();
});

// A box in the ride's task list (a <ul>; the Welcome card's set-up steps, with "Show me in people lists", are an <ol>).
// A task done on another page is a link, and the signal check is locked, so neither counts.
const tickable = 'ul > li > label:has(input[type="checkbox"]:not([disabled])):not(:has-text("Show me in people lists"))';
let ticked = false;
await step("5.3 tick the first ride task: the top bar shows a 1-day streak", async () => {
  const welcome = p.locator('section[aria-label="Welcome"]');
  const ride = (await welcome.count()) ? welcome : p.locator('section[aria-label="Today\'s ride"]');
  const task = ride.locator(`${tickable}:not(:has(input:checked))`).first();
  await task.waitFor();
  await task.click();
  ticked = true;
  await p.locator("header").getByText(/1-day streak/).first().waitFor({ timeout: 15000 });
});

await step("5.3 untick it again: back to the first ride, no streak", async () => {
  if (!ticked) throw new Error("nothing was ticked");
  await settled();
  const box = p.locator(`section[aria-label="Today's ride"] ${tickable}:has(input:checked), section[aria-label="Welcome"] ${tickable}:has(input:checked)`).first();
  await box.waitFor();
  await box.click();
  await p.locator('section[aria-label="Welcome"]').waitFor({ timeout: 15000 });
  await p.locator("header").getByText(/streak/).first().waitFor({ state: "detached", timeout: 15000 });
});

await step("5.4 Map: the line with the same goals as stops", async () => {
  await open("/map");
  await p.locator('[aria-label^="Metro map of your line to "]').first().waitFor();
  // The goal names are compared, never printed.
  const onMap = await p.evaluate(() => {
    const main = document.querySelector("main");
    const labels = [...(main?.querySelectorAll("[aria-label]") ?? [])].map((e) => e.getAttribute("aria-label"));
    return `${main?.textContent ?? ""}\n${labels.join("\n")}`;
  });
  const missing = goalNames.filter((g) => !onMap.includes(g)).length;
  if (missing) throw new Error(`${missing} of ${goalNames.length} goals from Today aren't on the map`);
});

await step("6.1 Settings > Your data > Download: careermetro-data-<date>.json with the account, resume, gaps, path and goals", async () => {
  await open("/settings");
  const link = p.getByRole("region", { name: "Your data", exact: true }).getByRole("link", { name: "Download", exact: true });
  const [download] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), link.click()]);
  try {
    if (!/^careermetro-data-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename())) throw new Error("unexpected file name");
    const file = await download.path();
    // Read and checked here, never printed: it holds the resume profile.
    const data = JSON.parse(readFileSync(file, "utf8"));
    const analyses = (data.resumes ?? []).flatMap((r) => r.profiles ?? []).flatMap((pr) => pr.gapAnalyses ?? []);
    const missing = [
      !data.account && "account",
      !data.resumes?.length && "resume",
      !analyses.length && "gap result",
      !analyses.some((a) => a.paths?.length) && "path",
      !data.goals?.length && "goals",
    ].filter(Boolean);
    if (missing.length) throw new Error(`the file has no ${missing.join(", ")}`);
  } finally {
    await download.delete().catch(() => {});
  }
});

await step("6.2 avatar menu > Sign out: the home page, signed out; /today goes to /sign-in", async () => {
  await open("/today");
  await p.getByRole("button", { name: /open menu$/ }).click();
  await p.getByRole("button", { name: "Sign out", exact: true }).click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  await p.getByRole("link", { name: "Sign in", exact: true }).first().waitFor({ timeout: 15000 });
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/, { timeout: 30000 });
});

await step("6.3 sign in again: straight to Today with the same goals, no name step", async () => {
  const landed = await testSignIn();
  if (!landed.startsWith("/today")) throw new Error(`a returning account should go straight to Today, went to ${landed}`);
  await settled();
  await p.locator('section[aria-label="Your goals"]').waitFor();
  const again = (await p.locator('section[aria-label="Your goals"] li b').allTextContents()).map((s) => s.trim()).filter(Boolean);
  if (goalNames.length && goalNames[0] !== again[0]) throw new Error("the goals changed after signing in again");
});

/** Section 8: Settings > Delete account > Delete, type DELETE, Delete my account. Signs in first when signed out. */
const deleteAccount = async () => {
  await open("/settings");
  if (path().startsWith("/sign-in")) {
    const landed = await testSignIn();
    // Still at the name step: Create my account never finished, so there is no account to delete.
    if (landed.startsWith("/sign-up/finish")) {
      deleted = true;
      return;
    }
    if (!landed.startsWith("/today")) throw new Error(`signing in to delete went to ${landed}`);
    await open("/settings");
  }
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  await p.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");
  await p.getByRole("button", { name: "Delete my account", exact: true }).click();
  await p.waitForURL(/\/account\/deleted/, { timeout: 30000 });
  deleted = true;
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/, { timeout: 30000 });
};

if (!blockedBy) await step("8 delete the test account: /account/deleted, then signed out", deleteAccount);
// After a failure the test account still goes, so a preview never keeps a half-checked one.
if (signedUp && !deleted) {
  blockedBy = "";
  await step("8 clean-up: delete the test account after the failure", deleteAccount);
}

await browser.close();
console.log(failed ? `${failed} step(s) failed on ${BASE}` : `All steps passed on ${BASE}`);
process.exit(failed ? 1 : 0);
