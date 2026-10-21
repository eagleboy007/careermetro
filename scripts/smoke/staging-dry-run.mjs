// Dry run of docs/launch/prod-smoke.md on staging, or any preview that offers "Continue as test user" (docs/staging.md).
// It follows sections 3 to 6 and the account deletion in section 8 in a real browser, with the test-user sign-in in
// place of section 2's emailed code (staging has no Supabase keys, so it never sends codes).
//
//   BASE=https://careermetro-git-staging-career-metro.vercel.app BYPASS=... node scripts/smoke/staging-dry-run.mjs
//
// BASE (or the first argument) is the site; BYPASS, when set, is sent as the x-vercel-protection-bypass header to that
// site only, and only when it is a careermetro-*.vercel.app host. The header, the test email and anything from the resume are never printed. One line per step, ok or FAIL;
// the exit code is 1 on any failure. The test account is deleted at the end, as section 8 says, even after a failure.
// A deployment whose /api/health doesn't say "env": "preview" (production on any alias, an older build with no env, an
// error page) is refused at the first step, before any sign-in, as in staging-screens.mjs (T115).
// The script has its own deadline (SMOKE_DRY_RUN_DEADLINE_MIN, default 12, and never later than 12 minutes before the
// job's limit counted from JOB_STARTED, as in staging-screens.mjs), inside the workflow step's 15-minute cap: once it
// passes, the step running gets 15 seconds under short waits and is then given up (T116), the rest are skipped and the
// account is deleted in a fresh browser context within 90 seconds. On SIGINT, SIGTERM or SIGHUP (a cancel, or the step's cap) the
// deletion runs too, then the script exits; GitHub gives a cancelled job only about 10 seconds, so the deadline is the
// dependable path.
// Run by .github/workflows/smoke-staging.yml. Playwright isn't a project dependency: `npm install --no-save playwright@1.56.1`.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
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

// Refused before any sign-in unless the deployment says it is a preview (T107, T115), checked in step 1.1.
const HOST = new URL(BASE).host;

// Playwright's own signal handlers would close the browser before the account deletion below can use it.
const browser = await chromium.launch({
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
// Reduced motion, as in e2e/walk.mjs. The bypass header goes on every request of this context, so requests to any other
// host are refused below: the header never leaves for a third party (the Vercel toolbar, a font host).
// The clean-up gets a context of its own the same way (cleanUp below).
const newContext = async () => {
  const c = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
    ...(BYPASS ? { extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } } : {}),
  });
  await c.route(
    (url) => url.origin !== ORIGIN,
    (route) => route.abort("blockedbyclient"),
  );
  return c;
};
const ctx = await newContext();
/**
 * The page every flow step works on. Never replaced: the clean-up works in its own context and page (cleanUp), which a
 * step given up at the deadline or a signal never references.
 */
const p = await ctx.newPage();
p.setDefaultTimeout(30000);
p.setDefaultNavigationTimeout(60000);

let failed = 0;
// A stray rejection counts as a failure instead of ending the run, so the account is still deleted.
process.on("unhandledRejection", (err) => {
  failed++;
  console.log(`FAIL unhandled: ${redact(err?.message ?? err)}`);
});
let blockedBy = "";
/** Set by a signal or the deadline: from then on only the account deletion runs. */
let interrupted = false;
/** The step running now, settled or not, so a signal can let it finish before the deletion starts. */
let current = Promise.resolve();
/** Its name, for the screenshot taken when it is given up, and whether it is the clean-up's own step. */
let currentName = "";
let currentIsCleanup = false;
/** Set once the step in flight has been given up: the flow page's helpers then stop at their next call (T116). */
let givenUp = false;
/**
 * The cap on any one wait once the deadline or a signal has come (0 before): the step in flight and the deletion must
 * fit in the minutes left inside the workflow step's cap.
 */
let capMs = 0;
const CLEAN_ACTION_MS = 15000;
/** The whole account deletion after the deadline or a signal, signing in again included (T116). */
const CLEAN_PART_MS = 90000;
const upTo = (ms) => (capMs ? Math.min(ms, capMs) : ms);
const capPage = (pg) => {
  pg.setDefaultTimeout(CLEAN_ACTION_MS);
  pg.setDefaultNavigationTimeout(CLEAN_ACTION_MS);
};
let n = 0;
const path = (pg = p) => {
  try {
    return new URL(pg.url()).pathname;
  } catch {
    return "?";
  }
};
/** With SMOKE_SHOTS, a screenshot of a failed step. The email field and any line with the test address are masked; the resume is synthetic. */
const shoot = async (pg, name) => {
  if (!SHOTS || pg.isClosed()) return;
  const mask = [pg.locator('input[type="email"], input[name="email"]'), pg.getByText(EMAIL_DOMAIN, { exact: false })];
  await pg.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9.-]+/gi, "-")}.png`, fullPage: true, mask, timeout: upTo(30000) }).catch(() => {});
};
/**
 * Rejects the step in flight once the deadline or a signal gives up on it (giveUpStep below). Every flow step races
 * against it (T116), so a long wait (a 90-second waitForURL, the 60-second health request) can't hold the account
 * deletion past the workflow step's cap. Clean-up steps don't: they have their own limit, CLEAN_PART_MS.
 */
let abandon = () => {};
const abandoned = new Promise((_, reject) => (abandon = reject));
abandoned.catch(() => {});
/**
 * One line per step. A failed `critical` step skips the rest of the flow, since each later step needs it. After a
 * signal or the deadline only `cleanup` steps run.
 */
const step = async (name, fn, { critical = false, cleanup = false, page = p } = {}) => {
  if (interrupted && !cleanup) {
    console.log("FAIL", name, "(skipped: the run was interrupted)");
    return false;
  }
  if (blockedBy) {
    failed++;
    console.log("FAIL", name, `(skipped: "${blockedBy}" failed)`);
    return false;
  }
  try {
    const run = fn();
    current = run.catch(() => {});
    currentName = name;
    currentIsCleanup = cleanup;
    await (cleanup ? run : Promise.race([run, abandoned]));
    console.log("ok  ", name, "->", path(page));
    return true;
  } catch (e) {
    failed++;
    console.log("FAIL", name, "@", path(page), redact(e?.message ?? e).split("\n")[0].slice(0, 300));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Staging dry run::${redact(name)}`);
    // A step that was given up had its screenshot taken before its page was closed (giveUpStep).
    if (!e?.givenUp) await shoot(page, name);
    if (critical) blockedBy = name;
    return false;
  }
};
/** A flow helper called after its step was given up stops here, before it touches anything (T116). */
const stillOurs = (pg) => {
  if (givenUp && pg === p) throw Object.assign(new Error("the step was given up"), { givenUp: true });
};
// The same wait as the walk: the gaps and path pages stream in behind these words. A closed page is an error, so a step
// given up (its page closed) stops instead of going on as if the page had settled.
const settled = (pg = p) =>
  pg
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: upTo(90000) })
    .catch((e) => {
      if (pg.isClosed()) throw e;
    });
const reload = async (pg = p) => {
  stillOurs(pg);
  await pg.reload();
  await pg.waitForLoadState("networkidle");
  await settled(pg);
};
const open = async (route, pg = p) => {
  stillOurs(pg);
  await pg.goto(BASE + route);
  await pg.waitForLoadState("networkidle");
  await settled(pg);
};
/** The app's own error line on the page (role=alert), for a failure message. App copy only, never resume text. */
const alertText = async () => {
  const alert = p.getByRole("alert").first();
  return (await alert.count()) ? ` (page says: ${(await alert.innerText()).slice(0, 160)})` : "";
};
/** "Continue as test user" with the test name and email; returns the path it lands on. */
const testSignIn = async (pg = p) => {
  stillOurs(pg);
  await open("/sign-in", pg);
  const button = pg.getByRole("button", { name: "Continue as test user", exact: true });
  if (!(await button.count())) {
    throw new Error("no \"Continue as test user\" here: real sign-in is on, so run prod-smoke.md section 2 by hand instead");
  }
  await pg.getByRole("textbox", { name: "Name", exact: true }).fill(NAME);
  await pg.getByRole("textbox", { name: "Email", exact: true }).fill(EMAIL);
  await button.click();
  await pg.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: upTo(30000) });
  await pg.waitForLoadState("networkidle");
  return path(pg);
};

let signedUp = false;
let deleted = false;
let goalNames = [];

/**
 * Section 8: Settings > Delete account > Delete, type DELETE, Delete my account. Signs in first when signed out, as it
 * always is in the clean-up's own context.
 */
const deleteAccount = async (pg = p) => {
  await open("/settings", pg);
  if (path(pg).startsWith("/sign-in")) {
    const landed = await testSignIn(pg);
    // Still at the name step: Create my account never finished, so there is no account to delete.
    if (landed.startsWith("/sign-up/finish")) {
      deleted = true;
      return;
    }
    if (!landed.startsWith("/today")) throw new Error(`signing in to delete went to ${landed}`);
    await open("/settings", pg);
  }
  await pg.getByRole("button", { name: "Delete", exact: true }).click();
  await pg.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");
  await pg.getByRole("button", { name: "Delete my account", exact: true }).click();
  await pg.waitForURL(/\/account\/deleted/, { timeout: upTo(30000) });
  deleted = true;
  await pg.goto(BASE + "/today");
  await pg.waitForURL(/\/sign-in/, { timeout: upTo(30000) });
};

/**
 * The step in flight after the deadline or a signal (T116): it gets `graceMs` to finish under the short waits. If it
 * hasn't, its screenshot is taken, it is given up (its step() call fails at once, whatever it is waiting for, and the
 * flow helpers refuse to go on), and the flow page is closed, which ends its waits. The clean-up never waits for this
 * and never shares that page: it has its own context. The clean-up's own step is never given up here; it has
 * CLEAN_PART_MS. Runs once.
 */
let givingUp = null;
const giveUpStep = (why, graceMs) =>
  (givingUp ??= (async () => {
    // The step in flight now: a clean-up step started during the grace is never the one given up.
    const flow = current;
    const name = currentName;
    const done = await Promise.race([flow.then(() => true), new Promise((r) => setTimeout(() => r(false), graceMs))]);
    if (done || (currentIsCleanup && current === flow)) {
      if (!p.isClosed()) capPage(p);
      return;
    }
    await shoot(p, `${name} (given up at the ${why})`);
    givenUp = true;
    abandon(Object.assign(new Error(`still running ${graceMs / 1000} seconds after the ${why}; given up so the test account can be deleted in time`), { givenUp: true }));
    await p.close().catch(() => {});
  })());

/** At most `ms` for `run`: the clean-up must end inside the workflow step's cap whatever it waits for. */
const within = (run, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} seconds`)), ms)));
  return Promise.race([run, limit]).finally(() => clearTimeout(timer));
};

/**
 * After a failure, the deadline or a signal the test account still goes, so a preview never keeps a half-checked one.
 * It runs in a fresh browser context with its own page (signing in again as the test user), so a step given up at the
 * deadline, still running on the flow page, can never act on the deletion's page (T116). The new context and page get
 * CLEAN_ACTION_MS together and the deletion CLEAN_PART_MS. Runs once: a signal during it waits for the same run.
 */
let cleaning = null;
const cleanUp = () =>
  (cleaning ??= (async () => {
    if (!signedUp || deleted) return;
    blockedBy = "";
    const name = "8 clean-up: delete the test account after the failure";
    let cleanCtx = null;
    let page = null;
    try {
      // One CLEAN_ACTION_MS for both, so the whole clean-up stays inside the step's cap.
      const made = newContext().then(async (c) => ((cleanCtx = c), await c.newPage()));
      page = await within(made, CLEAN_ACTION_MS, "a new browser context and page");
    } catch (e) {
      failed++;
      console.log("FAIL", name, `(no fresh page: ${redact(e?.message ?? e)})`);
      return;
    }
    capPage(page);
    await step(name, () => within(deleteAccount(page), CLEAN_PART_MS, "the account deletion"), { cleanup: true, page });
    await within(cleanCtx.close(), CLEAN_ACTION_MS, "closing the clean-up context").catch(() => {});
  })());

// A cancel (SIGINT), a kill (SIGTERM, as at the step's cap) or a hang-up: the step running gets 3 seconds to finish,
// then it is given up, the account is deleted in a fresh context and the script exits. A signal during the deadline's
// 15-second grace waits at most 3 seconds of it too, then goes on to the clean-up.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, async () => {
    failed++;
    interrupted = true;
    console.log(`FAIL interrupted by ${signal}: deleting the test account before exiting`);
    capMs = CLEAN_ACTION_MS;
    await Promise.race([giveUpStep(signal, 3000), new Promise((r) => setTimeout(r, 3000))]);
    await cleanUp().catch((e) => console.log(`FAIL clean-up: ${redact(e?.message ?? e)}`));
    await browser.close().catch(() => {});
    process.exit(1);
  });
}

// The script's own deadline, 3 minutes inside the workflow step's 15-minute cap: once it passes, the step running gets
// 15 seconds under short waits and is then given up, the rest are skipped, and the account is deleted within 90 seconds
// in a fresh browser context, so it all ends within about 2.5 minutes of the deadline (15 s grace, 15 s screenshot,
// 15 s for the new context, 90 s deletion, 15 s to close it). T116: as in staging-screens.mjs, it is also never
// later than 12 minutes before the job's own limit, counted from the job's start (JOB_STARTED, epoch seconds, and
// SMOKE_JOB_LIMIT_MIN, both set in GITHUB_ENV by the workflow), with a floor of a minute.
const DEADLINE_MIN = Number(process.env.SMOKE_DRY_RUN_DEADLINE_MIN) || 12;
const JOB_STARTED_MS = Number(process.env.JOB_STARTED) * 1000;
const JOB_LIMIT_MIN = Number(process.env.SMOKE_JOB_LIMIT_MIN) || 45;
const JOB_MARGIN_MIN = 12;
const deadlineMs = Math.max(
  60_000,
  Math.min(DEADLINE_MIN * 60_000, JOB_STARTED_MS > 0 ? JOB_STARTED_MS + (JOB_LIMIT_MIN - JOB_MARGIN_MIN) * 60_000 - Date.now() : Infinity),
);
if (deadlineMs < DEADLINE_MIN * 60_000) console.log(`note: the deadline is ${Math.round(deadlineMs / 60_000)} minutes from now, ${JOB_MARGIN_MIN} before the job's ${JOB_LIMIT_MIN}-minute limit`);
setTimeout(() => {
  if (interrupted) return;
  failed++;
  interrupted = true;
  console.log(`FAIL deadline: ${Math.round(deadlineMs / 60_000)} minutes passed; skipping the rest and deleting the test account`);
  capMs = CLEAN_ACTION_MS;
  if (!p.isClosed()) capPage(p);
  giveUpStep("deadline", CLEAN_ACTION_MS);
}, deadlineMs).unref();

await step("1.1 health answers ok", async () => {
  const res = await ctx.request.get(BASE + "/api/health", { timeout: 60000 });
  if (res.status() === 401 || res.status() === 403) throw new Error(`HTTP ${res.status()}: Deployment Protection blocked it; BYPASS is missing or wrong`);
  const body = await res.json().catch(() => ({}));
  // T107: production also answers on careermetro-<team>.vercel.app aliases that pass the bypass host check, so the
  // deployment says what it is: on production nothing runs and no test user is made.
  // T115: fail closed. Only an answer that says "preview" goes on: a missing env (an older build, an error page, a
  // body that isn't JSON) or any other value is refused, so nothing here ever runs on production by mistake.
  if (body.env !== "preview") {
    throw new Error(
      body.env === "production"
        ? `refused: ${HOST} is production; this script only runs on previews`
        : `refused: /api/health on ${HOST} says env ${body.env === undefined ? "nothing" : JSON.stringify(String(body.env)).slice(0, 40)}, not "preview" (HTTP ${res.status()}); this script only runs where it says "preview"`,
    );
  }
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
  await p.waitForURL(/\/today/, { timeout: upTo(30000) });
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
    await p.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: upTo(90000) });
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
  await p.waitForURL(/\/gaps\/data-analyst/, { timeout: upTo(90000) });
  await p.waitForLoadState("networkidle");
  await settled();
  await p.getByRole("heading", { name: "Your gaps", exact: true, level: 1 }).waitFor();
  if (!(await p.getByRole("region", { name: "Your gaps", exact: true }).locator("article").count())) throw new Error("no gaps shown");
  await p.getByRole("link", { name: "Build my path", exact: true }).waitFor();
}, { critical: true });

await step("4.2 Build my path: steps with free resources and Works toward", async () => {
  await p.getByRole("link", { name: "Build my path", exact: true }).click();
  await p.waitForURL(/\/path\/data-analyst/, { timeout: upTo(90000) });
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
  await p.locator("header").getByText(/1-day streak/).first().waitFor({ timeout: upTo(15000) });
});

await step("5.3 untick it again: back to the first ride, no streak", async () => {
  if (!ticked) throw new Error("nothing was ticked");
  await settled();
  const box = p.locator(`section[aria-label="Today's ride"] ${tickable}:has(input:checked), section[aria-label="Welcome"] ${tickable}:has(input:checked)`).first();
  await box.waitFor();
  await box.click();
  await p.locator('section[aria-label="Welcome"]').waitFor({ timeout: upTo(15000) });
  await p.locator("header").getByText(/streak/).first().waitFor({ state: "detached", timeout: upTo(15000) });
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
  // The link's own click is covered by the e2e walk's smoke 6. Behind Deployment Protection a browser download isn't
  // reliably sent with the bypass header, so the file is fetched with the page's cookies and the same headers instead.
  if ((await link.getAttribute("href")) !== "/api/account/export") throw new Error("the Download link doesn't point at /api/account/export");
  const res = await p.request.get(BASE + "/api/account/export");
  {
    if (res.status() !== 200) throw new Error(`the export answered HTTP ${res.status()}`);
    const name = /filename="([^"]+)"/.exec(res.headers()["content-disposition"] ?? "")?.[1] ?? "";
    if (!/^careermetro-data-\d{4}-\d{2}-\d{2}\.json$/.test(name)) throw new Error("unexpected file name");
    // Read and checked here, never printed: it holds the resume profile.
    const data = await res.json();
    const analyses = (data.resumes ?? []).flatMap((r) => r.profiles ?? []).flatMap((pr) => pr.gapAnalyses ?? []);
    const missing = [
      !data.account && "account",
      !data.resumes?.length && "resume",
      !analyses.length && "gap result",
      !analyses.some((a) => a.paths?.length) && "path",
      !data.goals?.length && "goals",
    ].filter(Boolean);
    if (missing.length) throw new Error(`the file has no ${missing.join(", ")}`);
  }
});

await step("6.2 avatar menu > Sign out: the home page, signed out; /today goes to /sign-in", async () => {
  await open("/today");
  await p.getByRole("button", { name: /open menu$/ }).click();
  await p.getByRole("button", { name: "Sign out", exact: true }).click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: upTo(30000) });
  await p.waitForLoadState("networkidle");
  await p.getByRole("link", { name: "Sign in", exact: true }).first().waitFor({ timeout: upTo(15000) });
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/, { timeout: upTo(30000) });
});

await step("6.3 sign in again: straight to Today with the same goals, no name step", async () => {
  const landed = await testSignIn();
  if (!landed.startsWith("/today")) throw new Error(`a returning account should go straight to Today, went to ${landed}`);
  await settled();
  await p.locator('section[aria-label="Your goals"]').waitFor();
  const again = (await p.locator('section[aria-label="Your goals"] li b').allTextContents()).map((s) => s.trim()).filter(Boolean);
  if (goalNames.length && goalNames[0] !== again[0]) throw new Error("the goals changed after signing in again");
});

if (!blockedBy) await step("8 delete the test account: /account/deleted, then signed out", deleteAccount);
await cleanUp();

await browser.close();
console.log(failed ? `${failed} step(s) failed on ${BASE}` : `All steps passed on ${BASE}`);
process.exit(failed ? 1 : 0);
