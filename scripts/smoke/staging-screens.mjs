// The signed-in screens the dry run (staging-dry-run.mjs) doesn't reach, on staging or any preview that offers
// "Continue as test user" (docs/staging.md): Network (search, request, accept, and no city on any row), the notification
// bell, the guided resume builder through to Download, Library (Save and "I finished this"), a mock interview round
// started and ended at once, and Departures (save a role and mark it applied). Then the company side: Arrivals, and the
// admin pages' not-found for a member. Two fresh test users, each in its own browser context, so one can ask the other
// to connect. No member's city may reach the other's screen or the page's data (Network rows, Sent, the profile, the
// bell).
//
// With SMOKE_ADMIN_EMAIL (a test-user address the deployment treats as an admin; the workflow sets admin@careermetro.test) the rest
// of the company side runs too, on a careermetro-*.vercel.app preview only (never production, careermetro.vercel.app),
// in a third browser: B sets up a company with the test-mode code, the admin verifies it, B posts a job, A opens Gaps
// for the built resume and sends it with Express apply, B moves A to Offer and A sees it under Offers on Arrivals; A
// reports the job and B reports a Library link, and the admin acknowledges and dismisses both (Reports, Library
// review). Without it, or on any other host, those steps print "skipped: ...". A deployment whose /api/health doesn't
// say "env": "preview" (production on any alias, an older build with no env, an error page) is refused at the first
// step, before any sign-in (T115).
//
//   BASE=https://careermetro-git-staging-career-metro.vercel.app BYPASS=... node scripts/smoke/staging-screens.mjs
//
// The same rules as the dry run: BASE (or the first argument) is the site; BYPASS, when set, is sent as the
// x-vercel-protection-bypass header to that site only, and only when it is a careermetro-*.vercel.app host. The header and
// the test emails (the admin's too) are never printed. One line per step, ok or FAIL; the exit code is 1 on any
// failure. The clean-up runs after any failed step or crash, and when the script's own deadline (SMOKE_DEADLINE_MIN,
// default 18, and never later than 12 minutes before the job's limit counted from JOB_STARTED) passes: A withdraws the application, B closes the job, the admin dismisses any report still open, and both
// test accounts are deleted, as prod-smoke.md section 8 says. On SIGINT or SIGTERM (a cancel) it starts too, but
// GitHub gives a cancelled job only about 10 seconds, so it may not finish then. The company itself can't be deleted in
// the app, and a fresh account can't take over an old one without that company's admin, so each admin run leaves one:
// verified, with no live job, on Company review as "No admin" once B's account is gone. The admin test account is kept
// for the next run.
// AI spend: the builder's "Review my resume" is one build-resume call; the mock round ends with nothing answered, so it
// asks for no feedback; nothing here uploads a resume. With the admin, A's Gaps page is one explain-gaps call.
// /api/health pings Claude once, as in the dry run.
// Run by .github/workflows/smoke-staging.yml after the dry run. Playwright isn't a project dependency:
// `npm install --no-save playwright@1.56.1`.
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
// The test emails' domain: screenshots mask any text with it.
const EMAIL_DOMAIN = "example.com";
// Optional: a folder for a screenshot of each failed step (the workflow keeps them for 3 days).
const SHOTS = process.env.SMOKE_SHOTS || "";

/** Lowercase letters, so a name passes the name rules and its last word is found by Network's name search. */
const letters = (n) => [...randomBytes(n)].map((b) => String.fromCharCode(97 + (b % 26))).join("");
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/**
 * A fresh, unguessable address each run (anyone who types the same one on a preview sees its account), and a last name
 * nobody else on staging has, so B's search finds exactly A's partner. Each user picks a city in Settings that only
 * companies may see; no Network row may show it.
 */
const person = (tag, first, city) => ({
  tag,
  first,
  last: cap(`smoke${letters(7)}`),
  get name() {
    return `${this.first} ${this.last}`;
  },
  email: `smoke-${tag}-${Date.now()}-${randomBytes(6).toString("hex")}@example.com`,
  city,
  ctx: null,
  page: null,
  signedUp: false,
  deleted: false,
});
// Cities no example data or fixture in src/ names (only the Market's place list, which these screens never load), so
// the payload checks can't trip on an example Timetable or job.
const A = person("a", "Asha", "Kohima");
const B = person("b", "Bina", "Itanagar");
// Each user picks a username in Settings too, so the other can open their profile from Network.
for (const u of [A, B]) u.handle = `smoke-${letters(10)}`;

/**
 * Optional: the admin test account (docs/secrets.md). The test sign-in adds ".test" to any address without it, and an
 * admin is a test user whose address Preview's ADMIN_EMAILS lists, or admin@careermetro.test while it is unset
 * (src/lib/admin/access.ts). Never deleted: it is the same account every run.
 */
const ADMIN_EMAIL_SET = (process.env.SMOKE_ADMIN_EMAIL || "").trim();
// On staging that address signs anyone in as the admin, so it is only typed into the project's own preview hosts (the
// bypass's, above), and never into production, whatever BASE says.
const PROD_HOST = "careermetro.vercel.app";
const HOST = new URL(BASE).host;
const ADMIN_HOST_OK = HOST !== PROD_HOST && BYPASS_HOST.test(HOST);
const ADMIN_EMAIL = ADMIN_HOST_OK ? ADMIN_EMAIL_SET : "";
const ADMIN = ADMIN_EMAIL ? { tag: "admin", first: "Smoke", last: "Admin", name: "Smoke Admin", email: ADMIN_EMAIL, ctx: null, page: null, signedUp: false } : null;
const ADMIN_DOMAIN = ADMIN_EMAIL_SET.split("@")[1] ?? "";
const NO_ADMIN = !ADMIN_EMAIL_SET
  ? "skipped: SMOKE_ADMIN_EMAIL is not set, so there is no admin test account"
  : HOST === PROD_HOST
    ? `skipped: SMOKE_ADMIN_EMAIL is never used on production (${PROD_HOST})`
    : `skipped: SMOKE_ADMIN_EMAIL is only used on careermetro-*.vercel.app previews, not ${HOST}, and never on production (${PROD_HOST})`;
if (ADMIN_EMAIL_SET && !ADMIN) console.log(`note: ${NO_ADMIN.replace(/^skipped: /, "")}`);
/** The company B sets up and the job it posts: unique names, so every check finds this run's rows only. */
const CO = { name: `Smoke Labs ${cap(letters(6))}`, domain: `smoke${Date.now()}${letters(4)}.example-labs.test` };
const JOB = { title: `Smoke Data Analyst ${cap(letters(6))}`, posted: false, closed: false };
/** A's built resume (/resume/<id>) and the Library resource B saved, for the company steps. */
let aResume = null;
let libTitle = null;
/** What the clean-up has to undo: A's application, and the two reports. */
const left = { applied: false, withdrawn: false, jobReport: false, jobReportDone: false, linkReport: false, linkReportDone: false };

/** Never lets the bypass value or a test email reach the log, whatever an error message carries. */
const redact = (s) => {
  let out = String(s);
  for (const secret of [BYPASS, A.email, A.email.toLowerCase(), B.email, B.email.toLowerCase(), ADMIN_EMAIL_SET, ADMIN_EMAIL_SET.toLowerCase()]) if (secret) out = out.split(secret).join("[hidden]");
  return out;
};

if (!/^https?:\/\//.test(BASE)) {
  console.log("FAIL setup: BASE must be an http(s) URL");
  process.exit(1);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Every city a member can pick (PERSON_CITIES), read from the checkout, so the row check catches any of them; the two
// picked here are always in it.
const CITIES = (() => {
  const picked = [A.city, B.city];
  try {
    const src = readFileSync(new URL("../../src/lib/schemas/constants.ts", import.meta.url), "utf8");
    const list = /export const PERSON_CITIES = \[([\s\S]*?)\]/.exec(src)?.[1] ?? "";
    return [...new Set([...picked, ...[...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])])];
  } catch {
    return picked;
  }
})();
const cityPattern = new RegExp(`\\b(${CITIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);

// Playwright's own signal handlers would close the browser before the clean-up below can use it.
const browser = await chromium.launch({
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
/**
 * One browser context per test user, as in the dry run: reduced motion, and the bypass header on every request of the
 * context, so requests to any other host are refused: the header never leaves for a third party (the Vercel toolbar, a
 * font host, a company's job post opened by Apply).
 */
for (const u of [A, B, ...(ADMIN ? [ADMIN] : [])]) {
  u.ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
    ...(BYPASS ? { extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } } : {}),
  });
  await u.ctx.route(
    (url) => url.origin !== ORIGIN,
    (route) => route.abort("blockedbyclient"),
  );
  u.page = await u.ctx.newPage();
  u.page.setDefaultTimeout(30000);
  u.page.setDefaultNavigationTimeout(60000);
}

let failed = 0;
// A stray rejection counts as a failure instead of ending the run, so the clean-up below still deletes both accounts.
process.on("unhandledRejection", (err) => {
  failed++;
  console.log(`FAIL unhandled: ${redact(err?.message ?? err)}`);
});
let blockedBy = "";
/** Set by SIGINT, SIGTERM or the deadline: from then on only the clean-up runs. */
let interrupted = false;
/** The step running now, settled or not, so a signal can let it finish before the clean-up starts. */
let current = Promise.resolve();
/** Set when that step didn't finish in time after a signal: the clean-up then works on fresh pages. */
let freshPages = false;
let n = 0;
const failedSteps = new Set();
const path = (p) => {
  try {
    return new URL(p.url()).pathname;
  } catch {
    return "?";
  }
};
/** With SMOKE_SHOTS, a screenshot of a failed step. The email field and any line with a test address (the admin's domain too) are masked. */
const shoot = async (p, name) => {
  if (!SHOTS) return;
  const mask = [p.locator('input[type="email"], input[name="email"]'), ...[EMAIL_DOMAIN, ADMIN_DOMAIN].filter(Boolean).map((d) => p.getByText(d, { exact: false }))];
  await p.screenshot({ path: `${SHOTS}/screens-${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9.-]+/gi, "-")}.png`, fullPage: true, mask }).catch(() => {});
};
/**
 * One line per step, on one user's page (its path is printed and, on a failure, its screenshot kept). A failed
 * `critical` step skips everything after it; `needs` names earlier steps this one can't run without. A step may return
 * a note (such as "skipped: no posts"), printed after its path. After a signal or the deadline only `cleanup` steps run.
 */
const step = async (name, u, fn, { critical = false, needs = [], cleanup = false } = {}) => {
  if (interrupted && !cleanup) {
    console.log("FAIL", name, "(skipped: the run was interrupted)");
    return false;
  }
  const missing = blockedBy || needs.find((s) => failedSteps.has(s));
  if (missing) {
    failed++;
    failedSteps.add(name);
    console.log("FAIL", name, `(skipped: "${missing}" failed)`);
    return false;
  }
  const p = u.page;
  try {
    const run = fn(p);
    current = run.catch(() => {});
    const note = await run;
    console.log("ok  ", name, "->", path(p), ...(note ? [`(${note})`] : []));
    return true;
  } catch (e) {
    failed++;
    failedSteps.add(name);
    console.log("FAIL", name, "@", path(p), redact(e?.message ?? e).split("\n")[0].slice(0, 300));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Staging screens::${redact(name)}`);
    // A clean-up part that ran out of time took its screenshot before its page was closed (cleanStep).
    if (!p.isClosed()) await shoot(p, name);
    if (critical) blockedBy = name;
    return false;
  }
};
/**
 * The clean-up's cap on any one wait (0 before it starts): its parts must fit in a few minutes after the deadline, inside
 * the workflow step's timeout.
 */
let cleanupMs = 0;
const upTo = (ms) => (cleanupMs ? Math.min(ms, cleanupMs) : ms);
// The same wait as the walk and the dry run.
const settled = (p) =>
  p
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: upTo(90000) })
    .catch(() => {});
const open = async (p, route) => {
  await p.goto(BASE + route);
  await p.waitForLoadState("networkidle");
  await settled(p);
};
/** A toast or status line with these words (the Library and Departures toasts are role=status). */
const toast = (p, text) => p.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: upTo(15000) });
/** "Continue as test user" with this user's name and email; returns the path it lands on. */
const testSignIn = async (u) => {
  const p = u.page;
  await open(p, "/sign-in");
  const button = p.getByRole("button", { name: "Continue as test user", exact: true });
  if (!(await button.count())) {
    throw new Error("no \"Continue as test user\" here: real sign-in is on, so these screens can't be checked with test users");
  }
  await p.getByRole("textbox", { name: "Name", exact: true }).fill(u.name);
  await p.getByRole("textbox", { name: "Email", exact: true }).fill(u.email);
  await button.click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: upTo(30000) });
  await p.waitForLoadState("networkidle");
  return path(p);
};
/** Sign up as a new test user: Create your account with the name, then Today. */
const signUp = async (u) => {
  const landed = await testSignIn(u);
  if (!landed.startsWith("/sign-up/finish")) throw new Error(`a new address should go to Create your account, went to ${landed}`);
  await finishSignUp(u);
};
/** Create your account: the name, the age and terms tick, then Today. */
const finishSignUp = async (u) => {
  const p = u.page;
  await p.getByRole("heading", { name: "Create your account", exact: true }).waitFor();
  if ((await p.getByLabel("First name", { exact: true }).inputValue()) !== u.first) await p.getByLabel("First name", { exact: true }).fill(u.first);
  if ((await p.getByLabel("Last name", { exact: true }).inputValue()) !== u.last) await p.getByLabel("Last name", { exact: true }).fill(u.last);
  await p.getByRole("checkbox", { name: "I am 18 or older and agree to the terms and privacy policy.", exact: true }).check();
  await p.getByRole("button", { name: "Create my account", exact: true }).click();
  // From here an account may exist, so the clean-up deletes it even if Today never loads.
  u.signedUp = true;
  await p.waitForURL(/\/today/, { timeout: 30000 });
};
/** Fails when any Network row on the page names a city. The rows must be there, or the check proves nothing. */
const noCityOnRows = async (p, min = 1) => {
  const rows = await p.locator("main li[data-person]").allInnerTexts();
  if (rows.length < min) throw new Error(`expected at least ${min} Network row(s), found ${rows.length}`);
  for (const text of rows) {
    const city = cityPattern.exec(text)?.[1];
    if (city) throw new Error(`a Network row shows a city (${city}); members never see one`);
  }
};
/**
 * Every same-origin page, RSC and fetch body this user's browser reads while `fn` runs, plus the page's HTML at the
 * end, as one string: a city can travel in the data without being drawn on a row.
 */
const payloadDuring = async (u, fn) => {
  const bodies = [];
  const reads = [];
  let unread = 0;
  const onResponse = (res) => {
    let origin = "";
    try {
      origin = new URL(res.url()).origin;
    } catch {}
    if (origin !== ORIGIN || !/html|x-component|json|text\/plain/.test(res.headers()["content-type"] ?? "")) return;
    reads.push(res.text().then((t) => bodies.push(t), () => unread++));
  };
  u.ctx.on("response", onResponse);
  try {
    await fn(u.page);
  } finally {
    u.ctx.off("response", onResponse);
  }
  await Promise.all(reads);
  // A run whose bodies all failed to read would check only the HTML, and pass on data it never saw.
  if (!bodies.length) throw new Error(`read no page, RSC or fetch body (${unread} failed to read), so the data can't be checked`);
  bodies.push(await u.page.content().catch(() => ""));
  return bodies.join("\n");
};
/** Fails when the data this user's browser got carries the other user's city (their own city is theirs to see). */
const noCityIn = (payload, other) => {
  if (new RegExp(`\\b${other.city}\\b`).test(payload)) throw new Error(`the page's data carries ${other.tag.toUpperCase()}'s city (${other.city}); members never get one`);
};
/** The step that sets the user's city: the no-city checks prove nothing without it. */
const cityStep = (u) => `network 1 ${u.tag.toUpperCase()} picks a Current city and a username in Settings (only companies see the city)`;
const cityNeeds = [cityStep(A), cityStep(B)];
/**
 * A checkbox or switch whose state follows the server (the Switch flips only once its action answers): click it,
 * wait for the words the page says, then for the state.
 */
const clickUntil = async (p, box, words, want = true) => {
  await box.click({ force: true });
  await toast(p, words);
  for (let t = 0; (await box.isChecked()) !== want; t++) {
    if (t >= 40) throw new Error(`still ${want ? "off" : "on"} after "${words}"`);
    await p.waitForTimeout(250);
  }
};
const row = (p, u) => p.locator("main li[data-person]").filter({ hasText: u.name });
const bell = (p) => p.locator("header button[data-bell]");
/** The words a server action announces in a status line. */
const said = (p, text) => p.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: upTo(15000) });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A step that needs the admin test account prints why it didn't run, the way an empty board does. */
const AS_ADMIN = ADMIN ?? A;

// The company side's rows, for its steps and the clean-up.
const jobCard = (p) => p.getByRole("article").filter({ has: p.getByRole("heading", { name: JOB.title }) });
const reportRow = (p) => p.locator("article", { hasText: JOB.title });
/** Library review's row for B's link, dismissed. */
const dismissLink = async (p) => {
  await open(p, "/admin/library");
  await p.getByRole("heading", { name: "Library review", level: 1 }).waitFor({ timeout: upTo(15000) });
  const link = p.locator("article").filter({ has: p.getByRole("heading", { name: libTitle, exact: true, level: 3 }) });
  await link.waitFor({ timeout: upTo(15000) });
  // Dismiss closes every open report on the link. On staging and previews they are all synthetic (earlier runs' among
  // them), so it is pressed whatever the count, and reports never pile up.
  await link.getByText(/Link is broken · \d+/).first().waitFor();
  await link.getByRole("button", { name: `Dismiss reports: ${libTitle}`, exact: true }).click();
  await said(p, "Reports dismissed. The link stays as it is.");
  left.linkReportDone = true;
};

// ---- Clean-up, defined first so a crash or a signal can run it -------------------------------------------------------
/** Section 8: Settings > Delete account > Delete, type DELETE, Delete my account. Signs in first when signed out. */
const deleteAccount = async (u) => {
  const p = u.page;
  await open(p, "/settings");
  if (path(p).startsWith("/sign-in")) {
    const landed = await testSignIn(u);
    // Still at the name step: Create my account never finished, so there is no account to delete.
    if (landed.startsWith("/sign-up/finish")) {
      u.deleted = true;
      return;
    }
    if (!landed.startsWith("/today")) throw new Error(`signing in to delete went to ${landed}`);
    await open(p, "/settings");
  }
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  await p.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");
  await p.getByRole("button", { name: "Delete my account", exact: true }).click();
  await p.waitForURL(/\/account\/deleted/, { timeout: upTo(30000) });
  u.deleted = true;
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/, { timeout: upTo(30000) });
};

/**
 * The clean-up's budget: 15 seconds for any one action or wait, 40 for a whole part. A part runs at most once (one that
 * failed is not tried again), so its six parts (four company ones, two accounts) end within 4 minutes, inside the 7
 * between the deadline and the workflow step's timeout, with time left for the step in flight at the deadline (capped
 * there the same way).
 */
const CLEAN_ACTION_MS = 15000;
const CLEAN_PART_MS = 40000;
const capPage = (pg) => {
  pg.setDefaultTimeout(CLEAN_ACTION_MS);
  pg.setDefaultNavigationTimeout(CLEAN_ACTION_MS);
};
/**
 * A fresh page for the user, or their old one if the browser doesn't give one within CLEAN_ACTION_MS (T108): a hung
 * newPage() must not hold the clean-up past the job's limit.
 */
const freshPage = async (u) => {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("no new page")), CLEAN_ACTION_MS);
  });
  return Promise.race([u.ctx.newPage(), late])
    .catch(() => u.page)
    .finally(() => clearTimeout(timer));
};
/**
 * One clean-up part as a step. Past CLEAN_PART_MS it fails: its screenshot is taken, then the user's page is closed
 * (stopping whatever it was waiting for) and replaced with a fresh one for the next part.
 */
const cleanStep = async (name, u, fn) => {
  if (failedSteps.has(name)) return;
  await step(name, u, (p) => {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        await shoot(p, name);
        u.page = await freshPage(u);
        if (u.page !== p) {
          capPage(u.page);
          await p.close().catch(() => {});
        }
        reject(new Error(`clean-up part took over ${CLEAN_PART_MS / 1000} seconds`));
      }, CLEAN_PART_MS);
    });
    return Promise.race([fn(p), limit]).finally(() => clearTimeout(timer));
  }, { cleanup: true });
};
/**
 * Undoes what the run made, whatever failed before it, so a preview never keeps a half-checked account or a live test
 * job: A's application, B's job, any report still open, then both accounts. Each part runs only when its thing exists.
 * Runs once: a signal during the clean-up waits for the same run.
 */
let cleaning = null;
const cleanUp = () =>
  (cleaning ??= (async () => {
    blockedBy = "";
    cleanupMs = CLEAN_ACTION_MS;
    for (const u of [A, B, ...(ADMIN ? [ADMIN] : [])]) {
      // After a signal, a step that didn't finish may still hold the old pages: each user gets a fresh one.
      if (freshPages) u.page = await freshPage(u);
      capPage(u.page);
    }
    await undoCompany();
    // Once more, for anything a step still running at a signal made meanwhile. A part already done is not repeated, and
    // nor is one that failed: cleanStep skips it.
    await undoCompany();
    for (const u of [B, A]) {
      if (u.signedUp && !u.deleted) await cleanStep(`8 delete test user ${u.tag.toUpperCase()}: /account/deleted, then signed out`, u, () => deleteAccount(u));
    }
  })());
/** The company side's part of the clean-up: A's application, B's job, the reports still open. */
const undoCompany = async () => {
  if (left.applied && !left.withdrawn && A.signedUp && !A.deleted) {
    await cleanStep("clean-up 1 A withdraws the application on Arrivals", A, async (p) => {
      await open(p, "/arrivals");
      await p.getByRole("button", { name: `Withdraw ${JOB.title} at ${CO.name}`, exact: true }).click();
      await p.getByRole("button", { name: "Withdraw application", exact: true }).click();
      await said(p, `Withdrawn: ${JOB.title} at ${CO.name}.`);
      left.withdrawn = true;
    });
  }
  if (JOB.posted && !JOB.closed && B.signedUp && !B.deleted) {
    // Closed, not paused: deleting B's account leaves a verified company's open job live otherwise.
    await cleanStep("clean-up 2 B closes the job: Close, Close job, so it leaves Departures for good", B, async (p) => {
      await open(p, "/corporate");
      await p.getByRole("button", { name: `Close ${JOB.title}`, exact: true }).click();
      await p.getByRole("button", { name: "Close job", exact: true }).click();
      await said(p, "Closed. It stays here for your records.");
      JOB.closed = true;
    });
  }
  if (ADMIN && left.jobReport && !left.jobReportDone) {
    await cleanStep("clean-up 3 the admin dismisses the job report still open", ADMIN, async (p) => {
      await open(p, "/admin/reports");
      await reportRow(p).getByRole("button", { name: /^Dismiss: / }).click();
      await said(p, "Dismissed. It leaves the list.");
      left.jobReportDone = true;
    });
  }
  if (ADMIN && left.linkReport && !left.linkReportDone) {
    await cleanStep("clean-up 4 the admin dismisses B's link report still open", ADMIN, async (p) => {
      await dismissLink(p);
    });
  }
};

// A cancel (SIGINT) or a kill (SIGTERM): the step running gets 3 seconds to finish, then the clean-up starts. GitHub
// gives a cancelled job about 10 seconds, so it may not finish: the deadline below is the dependable path.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    failed++;
    interrupted = true;
    console.log(`FAIL interrupted by ${signal}: cleaning up before exiting`);
    const done = await Promise.race([current.then(() => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
    if (!done) freshPages = true;
    await cleanUp().catch((e) => console.log(`FAIL clean-up: ${redact(e?.message ?? e)}`));
    await browser.close().catch(() => {});
    process.exit(1);
  });
}
// The script's own deadline, 7 minutes inside the workflow step's timeout: once it passes, the step running finishes
// under the clean-up's caps (set on every open page here), the rest are skipped and the clean-up runs with time to spare.
// T108: it is also never later than 12 minutes before the job's own limit, counted from the job's start (JOB_STARTED,
// epoch seconds, and SMOKE_JOB_LIMIT_MIN from the workflow), so a slow install or dry run can't push the clean-up past
// the point where GitHub kills the job.
const DEADLINE_MIN = Number(process.env.SMOKE_DEADLINE_MIN) || 18;
const JOB_STARTED_MS = Number(process.env.JOB_STARTED) * 1000;
const JOB_LIMIT_MIN = Number(process.env.SMOKE_JOB_LIMIT_MIN) || 45;
const CLEANUP_MARGIN_MIN = 12;
const deadlineMs = Math.max(
  60_000,
  Math.min(DEADLINE_MIN * 60_000, JOB_STARTED_MS > 0 ? JOB_STARTED_MS + (JOB_LIMIT_MIN - CLEANUP_MARGIN_MIN) * 60_000 - Date.now() : Infinity),
);
if (deadlineMs < DEADLINE_MIN * 60_000) console.log(`note: the deadline is ${Math.round(deadlineMs / 60_000)} minutes from now, ${CLEANUP_MARGIN_MIN} before the job's ${JOB_LIMIT_MIN}-minute limit`);
setTimeout(() => {
  if (interrupted) return;
  failed++;
  interrupted = true;
  console.log(`FAIL deadline: ${Math.round(deadlineMs / 60_000)} minutes passed; skipping the rest and cleaning up`);
  // The step in flight gets the clean-up's caps too: its next waits end within CLEAN_ACTION_MS.
  cleanupMs = CLEAN_ACTION_MS;
  for (const u of [A, B, ...(ADMIN ? [ADMIN] : [])]) if (u.page && !u.page.isClosed()) capPage(u.page);
}, deadlineMs).unref();

try {
  await step("1.1 health answers ok", A, async () => {
    const res = await A.ctx.request.get(BASE + "/api/health", { timeout: 60000 });
    if (res.status() === 401 || res.status() === 403) throw new Error(`HTTP ${res.status()}: Deployment Protection blocked it; BYPASS is missing or wrong`);
    const body = await res.json().catch(() => ({}));
    // T107: production also answers on careermetro-<team>.vercel.app aliases that pass the preview host check, so the
    // deployment says what it is: on production nothing runs, the admin address is never typed, no test user is made.
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

  await step("sign up test user A: Create your account, then Today", A, () => signUp(A), { critical: true });
  await step("sign up test user B in a second browser: Create your account, then Today", B, () => signUp(B), { critical: true });

  // ---- Network, and the bell -------------------------------------------------------------------------------------------
  for (const u of [A, B]) {
    await step(cityStep(u), u, async (p) => {
      await open(p, "/settings");
      await p.getByRole("combobox", { name: /^Current city/ }).selectOption(u.city);
      await p.getByLabel("Username").fill(u.handle);
      await p.getByText(/^Available\. After you save/).waitFor({ timeout: 10000 });
      await p.getByRole("button", { name: "Save changes", exact: true }).click();
      await p.getByText("Settings saved.", { exact: true }).waitFor({ state: "attached", timeout: 15000 });
      // "Saved" is the page's word; a reload shows what the server kept.
      await open(p, "/settings");
      const city = await p.getByRole("combobox", { name: /^Current city/ }).inputValue();
      if (city !== u.city) throw new Error(`after a reload Current city is "${city}", not ${u.city}: the city wasn't saved`);
      if ((await p.getByLabel("Username").inputValue()) !== u.handle) throw new Error("after a reload the username isn't the one saved");
    });
  }

  await step("network 2 B turns on Let people find me", B, async (p) => {
    await open(p, "/network");
    await p.getByRole("tablist", { name: "Your network", exact: true }).waitFor();
    const findMe = p.getByRole("checkbox", { name: "Let people find me", exact: true });
    await findMe.waitFor({ state: "attached" });
    // Controlled: it flips only once the server answers.
    if (!(await findMe.isChecked())) await clickUntil(p, findMe, "People can now find you by name.");
  });

  // Each no-city check also reads the page's HTML and the RSC and fetch bodies behind it, so a city sent but not drawn
  // still fails.
  await step("network 3 A finds B by name in Find people, with no city on the row", A, async (p) => {
    const payload = await payloadDuring(A, async () => {
      await open(p, "/network");
      await p.getByRole("tablist", { name: "Your network", exact: true }).getByRole("tab", { name: /^Find/ }).click();
      await p.getByRole("searchbox", { name: "Find people by name or @handle", exact: true }).fill(B.last);
      await p.getByRole("button", { name: "Search", exact: true }).click();
      await row(p, B).waitFor({ timeout: 15000 });
    });
    await noCityOnRows(p);
    noCityIn(payload, B);
  }, { needs: [...cityNeeds, "network 2 B turns on Let people find me"] });

  await step("network 4 A sends B a request: Connect, How do you know them, Send request; Sent shows B with no city", A, async (p) => {
    await row(p, B).getByRole("button", { name: `Connect with ${B.name}`, exact: true }).click();
    await p.getByRole("group", { name: `How you know ${B.name}`, exact: true }).getByRole("button", { name: "Send request", exact: true }).click();
    await p.getByText(`Request sent to ${B.first}. It shows under Sent until they answer.`, { exact: true }).waitFor({ timeout: 15000 });
    const payload = await payloadDuring(A, async () => {
      await open(p, "/network");
      await p.getByRole("tablist", { name: "Your network", exact: true }).getByRole("tab", { name: /^Sent/ }).click();
      await row(p, B).waitFor({ timeout: 15000 });
    });
    await noCityOnRows(p);
    noCityIn(payload, B);
  }, { needs: [...cityNeeds, "network 3 A finds B by name in Find people, with no city on the row"] });

  await step("bell 1 B's bell rings, its list has A's request with no city, and the row opens Network on Requests", B, async (p) => {
    const payload = await payloadDuring(B, async () => {
      await open(p, "/today");
      await bell(p).waitFor();
      const label = await bell(p).getAttribute("aria-label");
      if (!/^Notifications, \d+ new$/.test(label ?? "")) throw new Error(`the bell reads "${label}", not "Notifications, N new"`);
      await bell(p).click();
      const item = p.getByRole("link", { name: `${A.name} asked to connect.`, exact: false });
      await item.waitFor({ timeout: 15000 });
      if (cityPattern.test(await item.innerText())) throw new Error("the bell's row shows a city");
      await item.click();
      await p.waitForURL(/\/network\?tab=requests/, { timeout: 15000 });
    });
    noCityIn(payload, A);
  }, { needs: [...cityNeeds, "network 4 A sends B a request: Connect, How do you know them, Send request; Sent shows B with no city"] });

  await step("network 5 B accepts on Requests; A's row shows no city before or after", B, async (p) => {
    const payload = await payloadDuring(B, async () => {
      if (!path(p).startsWith("/network")) await open(p, "/network?tab=requests");
      await p.waitForLoadState("networkidle");
      await p.getByRole("tab", { name: /^Requests/, selected: true }).waitFor({ timeout: 15000 });
      await row(p, A).waitFor({ timeout: 15000 });
      await noCityOnRows(p);
      await row(p, A).getByRole("button", { name: `Accept ${A.name}`, exact: true }).click();
      await p.getByText(`You and ${A.first} are connected.`, { exact: true }).waitFor({ timeout: 15000 });
      await open(p, "/network");
      await p.getByRole("tab", { name: /^Connections/, selected: true }).waitFor({ timeout: 15000 });
      await row(p, A).waitFor({ timeout: 15000 });
    });
    await noCityOnRows(p);
    noCityIn(payload, A);
  }, { needs: [...cityNeeds, "network 4 A sends B a request: Connect, How do you know them, Send request; Sent shows B with no city"] });

  await step("bell 2 A's bell lists B's accept; A's Connections show B with no city", A, async (p) => {
    const payload = await payloadDuring(A, async () => {
      await open(p, "/today");
      await bell(p).click();
      await p.getByRole("link", { name: `${B.name} accepted your request.`, exact: false }).waitFor({ timeout: 15000 });
      await p.keyboard.press("Escape");
      await open(p, "/network");
      await p.getByRole("tab", { name: /^Connections/, selected: true }).waitFor({ timeout: 15000 });
      await row(p, B).waitFor({ timeout: 15000 });
    });
    await noCityOnRows(p);
    noCityIn(payload, B);
  }, { needs: [...cityNeeds, "network 5 B accepts on Requests; A's row shows no city before or after"] });

  await step("network 6 A opens B's profile from Connections: no city on the page or in its data", A, async (p) => {
    const payload = await payloadDuring(A, async () => {
      await row(p, B).getByRole("link", { name: B.name, exact: true }).click();
      await p.waitForURL(new RegExp(`/u/${escapeRe(B.handle)}$`), { timeout: 15000 });
      await p.waitForLoadState("networkidle");
      await p.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    });
    const city = cityPattern.exec(await p.locator("main").first().innerText())?.[1];
    if (city) throw new Error(`B's profile shows a city (${city}); members never see one`);
    noCityIn(payload, B);
  }, { needs: [...cityNeeds, "bell 2 A's bell lists B's accept; A's Connections show B with no city"] });

  // ---- Build your resume, through to Download -------------------------------------------------------------------------
  await step("builder: A answers the seven sections, Review my resume, then Download gives a PDF", A, async (p) => {
    await open(p, "/builder");
    const section = (name) => p.getByRole("heading", { name, level: 2, exact: true });
    const next = async (name) => {
      await p.getByRole("button", { name: "Next", exact: true }).click();
      await section(name).waitFor({ timeout: 10000 });
    };
    await section("Role").waitFor({ timeout: 15000 });
    await p.getByLabel("Target role").selectOption("data-analyst");
    await p.getByText("Just graduated", { exact: true }).click();
    await next("Education");
    await p.getByRole("button", { name: "Add degree" }).click();
    await p.getByLabel("Degree", { exact: true }).fill("B.Com.");
    await p.getByLabel("College", { exact: true }).fill("Example College, Indore");
    await p.getByLabel("Start year").fill("2021");
    await p.getByLabel("End year").fill("2024");
    await next("Projects");
    await p.getByRole("button", { name: "Add project" }).click();
    await p.getByLabel("Project name").fill("Shop sales dashboard");
    await p.getByLabel("What did you build or do?").fill("Built a sales dashboard in Excel for 3 shops.");
    await next("Internships and jobs");
    await p.getByRole("checkbox", { name: /haven.t worked yet/ }).check();
    await next("Tools");
    const tools = p.getByRole("list", { name: "Tools" });
    if (!(await tools.getByRole("button", { pressed: true }).count())) {
      await p.getByLabel("Add your own").fill("Excel");
      await p.getByRole("button", { name: "Add", exact: true }).click();
    }
    await tools.getByRole("button", { pressed: true }).first().waitFor({ timeout: 10000 });
    await next("Certificates");
    await p.getByRole("checkbox", { name: "None yet" }).check();
    await next("Links");
    await p.getByLabel("GitHub").fill("github.com/smoke-builder");
    // The one AI call of this script: the build-resume reword.
    await p.getByRole("button", { name: "Review my resume" }).click();
    await p.getByRole("heading", { name: "Your resume", level: 1 }).waitFor({ timeout: 90000 });
    await p.getByRole("article", { name: "Resume preview" }).waitFor();
    // Download goes through the confirm step: the file is made only from a confirmed profile (FR-20).
    await p.getByRole("checkbox", { name: "Everything here is true and mine." }).check();
    await p.getByRole("button", { name: "Download PDF or DOCX" }).click();
    await p.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: 30000 });
    await p.waitForLoadState("networkidle");
    // Kept for Express apply, which needs gaps for a confirmed resume.
    aResume = path(p);
    await p.getByRole("button", { name: "Looks right", exact: true }).click();
    await p.getByRole("heading", { name: "Download your resume" }).waitFor({ timeout: 15000 });
    // Fetched with the page's cookies and headers, as the dry run fetches its export (a browser download isn't reliably
    // sent with the bypass header). Checked, never printed.
    const href = await p.getByRole("link", { name: "PDF", exact: true }).getAttribute("href");
    if (!href) throw new Error("no PDF link");
    const pdf = await p.request.get(new URL(href, BASE).href);
    if (pdf.status() !== 200 || !(await pdf.body()).subarray(0, 5).toString("latin1").startsWith("%PDF-")) throw new Error(`the PDF download gave HTTP ${pdf.status()}, not a PDF`);
  });

  // ---- Library ---------------------------------------------------------------------------------------------------------
  await step("library: B searches, opens a resource, Saves it and ticks I finished this", B, async (p) => {
    await open(p, "/library");
    const main = p.locator("main").first();
    await main.getByRole("heading", { name: "Library", level: 1 }).waitFor({ timeout: 15000 });
    // B has no resume, so no goal cards: a search lists the catalog.
    await p.getByRole("searchbox", { name: "Search the Library" }).fill("SQL");
    const rows = main.locator("li button[aria-controls]");
    await rows.first().waitFor({ timeout: 15000 });
    const title = (await rows.first().innerText()).trim();
    await rows.first().click();
    const panel = p.getByRole("complementary", { name: "Resource details" });
    await panel.getByRole("heading", { name: title, exact: true, level: 3 }).waitFor({ timeout: 10000 });
    await panel.getByRole("button", { name: `Save ${title}`, exact: true }).click();
    await toast(p, "Saved to your Library.");
    await panel.getByRole("button", { name: `Save ${title}`, exact: true, pressed: true }).waitFor({ timeout: 10000 });
    libTitle = title;
    // Ticked once the server has it.
    await clickUntil(p, panel.getByRole("checkbox", { name: "I finished this" }), "Marked finished.");
  });

  // ---- Mock interview (Elite, free in the beta) -----------------------------------------------------------------------
  await step("mock: B turns on Elite, starts a Quick round and ends it at once (no answers, so no AI feedback call)", B, async (p) => {
    await open(p, "/elite");
    const main = p.locator("main");
    const on = main.getByRole("button", { name: "Elite is on, free in the beta", exact: true });
    if (!(await on.count())) {
      await main.getByRole("button", { name: "Turn on Elite, free in the beta", exact: true }).click();
      await on.waitFor({ timeout: 15000 });
    }
    await open(p, "/mock?role=data-analyst");
    const mode = main.getByRole("group", { name: "Mode" });
    const tab = mode.getByRole("button", { name: "Mock interview", exact: true });
    await tab.waitFor({ timeout: 15000 });
    if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
    const setup = main.getByRole("region", { name: "Set up your mock interview" });
    await setup.waitFor({ timeout: 15000 });
    await setup.getByText("Quick round", { exact: true }).click();
    if (!(await setup.getByRole("radio", { name: /Quick round/ }).isChecked())) throw new Error("Quick round isn't picked");
    await setup.getByRole("button", { name: "Start mock interview", exact: true }).click();
    await main.getByRole("timer").waitFor({ timeout: 15000 });
    await main.getByText(/^Question 1 of 4 · /).waitFor();
    await main.getByRole("button", { name: "End and get feedback", exact: true }).click();
    await main.getByRole("heading", { name: "Feedback on your round", exact: true }).waitFor({ timeout: 30000 });
    await main.getByText(/0 of 4 answered/).waitFor();
    await main.getByText("Nothing answered this round, so there is no feedback.", { exact: false }).waitFor();
  });

  // ---- Departures ------------------------------------------------------------------------------------------------------
  await step("departures: A opens the board, saves a role and marks it applied", A, async (p) => {
    await open(p, "/departures");
    if (await p.getByRole("region", { name: "Job search is off" }).count()) throw new Error("Departures is paused: Looking for a job is off for a new account");
    // A live row: its title opens the details, and its bookmark is "Save <role>". CareerMetro's own posts are another list.
    const rows = p
      .locator("main li")
      .filter({ has: p.locator("button[aria-controls]") })
      .filter({ has: p.locator('button[aria-label^="Save "]') });
    const empty = p.getByText("No roles from company job boards yet.", { exact: false });
    await rows.first().or(empty).first().waitFor({ timeout: 20000 });
    if (!(await rows.count())) return "skipped: no posts";
    const first = rows.first();
    const save = first.locator('button[aria-label^="Save "]');
    const role = (await save.getAttribute("aria-label")).replace(/^Save /, "");
    await first.locator("button[aria-controls]").click();
    const detail = p.getByRole("complementary", { name: "Role details" });
    await detail.getByRole("heading", { name: role }).first().waitFor({ timeout: 10000 });
    if ((await save.getAttribute("aria-pressed")) !== "true") {
      await save.click();
      await toast(p, "Saved.");
    }
    const saveButton = (opts = {}) => p.getByRole("button", { name: `Save ${role}`, exact: true, ...opts });
    await saveButton({ pressed: true }).first().waitFor({ timeout: 10000 });
    // The company's post opens in a new tab, which this context refuses to load (no other host gets the header).
    const [popup] = await Promise.all([
      p.waitForEvent("popup", { timeout: 15000 }),
      detail.getByRole("link", { name: /^Apply on company site: .+ \(opens in a new tab\)$/ }).click(),
    ]);
    await popup.close().catch(() => {});
    await detail.getByRole("group", { name: "Did you apply?" }).getByRole("button", { name: "Yes, I applied", exact: true }).click();
    await toast(p, "Marked as applied to ");
    await detail.getByRole("heading", { name: "Your application" }).waitFor({ timeout: 10000 });
    // Both lists keep it after a reload.
    await p.reload();
    await p.waitForLoadState("networkidle");
    await settled(p);
    const tabs = p.getByRole("group", { name: "Show" });
    const kept = p.locator("main li").filter({ has: saveButton() }).first();
    await tabs.getByRole("button", { name: /^Saved/ }).click();
    await kept.waitFor({ timeout: 10000 });
    await tabs.getByRole("button", { name: /^Applied/ }).click();
    await kept.getByText("Applied", { exact: true }).waitFor({ timeout: 10000 });
  });

  // ---- The company side: Arrivals, Offers, Reports and Library review --------------------------------------------------
  await step("arrivals 1 A opens Arrivals before applying: Your applications, No applications yet", A, async (p) => {
    await open(p, "/arrivals");
    await p.getByRole("heading", { name: "Your applications", level: 1, exact: true }).waitFor({ timeout: 15000 });
    await p.getByText("No applications yet.", { exact: true }).waitFor();
    await p.locator("main").getByRole("link", { name: "Open Departures", exact: true }).waitFor();
  });

  await step("admin 1 A, not an admin, gets the not-found page with a 404 on Company review, Reports and Library review", A, async (p) => {
    for (const route of ["/admin/companies", "/admin/reports", "/admin/library"]) {
      const res = await p.goto(BASE + route);
      if (res?.status() !== 404) throw new Error(`${route} answered ${res?.status()}, not 404`);
      await p.getByRole("heading", { name: "We can't find that page" }).waitFor();
    }
  });

  await step("admin 2 the admin test account signs in, and its menu shows Admin", AS_ADMIN, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    // The same account every run: only the first run lands on Create your account.
    if ((await testSignIn(ADMIN)).startsWith("/sign-up/finish")) await finishSignUp(ADMIN);
    await open(p, "/today");
    await p.getByRole("button", { name: /open menu$/ }).click();
    if (!(await p.getByRole("link", { name: "Admin", exact: true }).count())) {
      throw new Error("SMOKE_ADMIN_EMAIL is not an admin here: Preview's ADMIN_EMAILS must list it (ending in .test), or be unset for admin@careermetro.test");
    }
    await p.keyboard.press("Escape");
  });

  await step("corporate 1 B sets up a company: work email on an example domain, the test-mode code, Send for review, Waiting for verification", B, async (p) => {
    // Only with the admin: nothing after this step can run without a verified company, and the app can't delete one.
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/corporate");
    const setUp = p.getByRole("link", { name: "Set up your company", exact: true });
    if (!(await setUp.count())) throw new Error("company sign-up is closed here: no Set up your company (codes need NAME_HASH_KEY or the test sign-in)");
    await setUp.click();
    await p.waitForURL(/\/corporate\/new/);
    await p.getByRole("heading", { name: "Set up your company on CareerMetro" }).waitFor();
    const workEmail = `smoke.${letters(6)}@${CO.domain}`;
    await p.getByLabel("Registered name").fill(`${CO.name} Private Limited`);
    await p.getByLabel("Name candidates see").fill(CO.name);
    await p.getByLabel("Website").fill(CO.domain);
    await p.getByLabel("Your work email").fill(workEmail);
    await p.getByLabel("Company size").selectOption("51 to 200");
    await p.getByLabel("Head office city").fill("Pune");
    await p.getByRole("button", { name: "Continue" }).click();
    // Test mode (previews with the test sign-in): the code shows on screen, no email is sent.
    const box = p.locator("[data-test-code]");
    await box.waitFor({ timeout: 15000 });
    await p.getByRole("status").filter({ hasText: "Test mode" }).waitFor();
    await p.getByLabel("Code", { exact: true }).fill(await box.getAttribute("data-test-code"));
    await p.getByRole("button", { name: "Verify" }).click();
    await p.getByLabel("About the company").waitFor({ timeout: 15000 });
    await p.getByLabel("About the company").fill("Synthetic company for the staging dry run.");
    await p.getByRole("button", { name: "Send for review" }).click();
    await p.getByRole("heading", { name: /We check every new company by hand/ }).waitFor({ timeout: 15000 });
    await p.getByRole("link", { name: "Open Corporate" }).click();
    await p.waitForURL(/\/corporate$/);
    await p.getByText("Waiting for verification").first().waitFor({ timeout: 15000 });
    if ((await p.locator("body").innerText()).includes(workEmail)) throw new Error("the work email is shown on Corporate");
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin"] });

  await step("corporate 2 the admin verifies B's company on Company review", AS_ADMIN, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/admin/companies");
    await p.getByRole("heading", { name: "Company review", level: 1 }).waitFor({ timeout: 15000 });
    const company = p.locator("article", { hasText: CO.domain });
    await company.getByText("Waiting for verification").waitFor({ timeout: 15000 });
    await company.getByRole("button", { name: `Verify ${CO.name}`, exact: true }).click();
    await said(p, `${CO.name} is verified.`);
    await company.waitFor({ state: "detached", timeout: 15000 });
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin", "corporate 1 B sets up a company: work email on an example domain, the test-mode code, Send for review, Waiting for verification"] });

  await step("corporate 3 B posts a Data Analyst job and opens it after the three checks: Live on Departures", B, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/corporate");
    await p.getByText("Verified company").first().waitFor({ timeout: 15000 });
    await p.getByRole("link", { name: "Post a job" }).click();
    await p.waitForURL(/\/corporate\/jobs\/new$/);
    await p.getByRole("heading", { name: "Post a job", level: 1 }).waitFor({ timeout: 15000 });
    await p.getByLabel("Role profile").selectOption("data-analyst");
    await p.getByLabel("Job title as you post it").fill(JOB.title);
    await p.getByLabel("City").fill("Pune");
    for (const name of ["This job is real and open now.", "We never ask candidates for a fee, deposit or paid training.", /don't screen people out/]) await p.getByRole("checkbox", { name }).check();
    await p.getByRole("button", { name: "Open job" }).click();
    JOB.posted = true;
    await p.waitForURL(/\/corporate(#jobs)?$/, { timeout: 15000 });
    await p.getByRole("listitem").filter({ has: p.getByRole("heading", { name: JOB.title }) }).getByText("Live on Departures").waitFor({ timeout: 15000 });
  }, { needs: ["corporate 2 the admin verifies B's company on Company review"] });

  await step("arrivals 2 A opens Gaps for the built resume (one explain-gaps call), so Express apply has gaps to send", A, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    if (!aResume) throw new Error("the builder step saved no resume");
    await open(p, `${aResume}/gaps/data-analyst`);
    await p.getByRole("heading", { name: "Your gaps", exact: true, level: 1 }).waitFor({ timeout: 90000 });
  }, { needs: ["builder: A answers the seven sections, Review my resume, then Download gives a PDF", "corporate 3 B posts a Data Analyst job and opens it after the three checks: Live on Departures"] });

  await step("arrivals 3 A sends the job with Express apply: the preview, Within 30 days, the consent tick; Arrivals waits with Offers empty", A, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/departures");
    const card = jobCard(p);
    await card.waitFor({ timeout: 15000 });
    await card.getByRole("button", { name: `Express apply: ${JOB.title}` }).click();
    const preview = p.getByRole("dialog", { name: `What ${CO.name} receives` });
    await preview.getByRole("heading", { name: "Match to this job" }).waitFor({ timeout: 15000 });
    if ((await preview.innerText()).includes(A.email)) throw new Error("the email is shown in the preview");
    await preview.getByLabel("When can you join?").selectOption({ label: "Within 30 days" });
    await preview.getByRole("checkbox", { name: `I agree to send this to ${CO.name} for this job.`, exact: false }).check();
    await preview.getByRole("button", { name: "Send application" }).click();
    await preview.waitFor({ state: "hidden", timeout: 15000 });
    left.applied = true;
    await card.getByRole("status").getByText("Applied · Applied").waitFor({ timeout: 15000 });
    await open(p, "/arrivals");
    const waiting = p.locator("section", { has: p.getByRole("heading", { name: "Waiting to hear", exact: true, level: 2 }) });
    await waiting.getByRole("heading", { name: JOB.title }).waitFor({ timeout: 15000 });
    const offers = p.locator("section", { has: p.getByRole("heading", { name: "Offers", exact: true, level: 2 }) });
    await offers.getByText("Offers land here. Your line keeps going while you wait.").waitFor();
  }, { needs: ["arrivals 2 A opens Gaps for the built resume (one explain-gaps call), so Express apply has gaps to send"] });

  await step("offers 1 B opens the job's board, finds A under Applied with no email, and moves A to Offer", B, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/corporate");
    await p.getByRole("link", { name: `Board for ${JOB.title}, 1 open application` }).click();
    await p.waitForURL(/\/corporate\/jobs\/board\?id=/);
    await p.getByRole("heading", { name: JOB.title, level: 1 }).waitFor({ timeout: 15000 });
    const lane = (name) => p.locator("section", { has: p.getByRole("heading", { name, exact: true, level: 2 }) });
    await lane("Applied").getByRole("button", { name: new RegExp(`^${escapeRe(A.name)}`) }).click();
    const drawer = p.getByRole("dialog", { name: A.name });
    await drawer.getByText("Never shown to companies", { exact: false }).waitFor({ timeout: 15000 });
    if ((await p.locator("body").innerText()).includes(A.email.split("@")[0])) throw new Error("A's email is shown on the board");
    await drawer.getByLabel("Move to").selectOption("offer");
    await drawer.getByRole("button", { name: "Move", exact: true }).click();
    await said(p, `Moved ${A.name} to Offer`);
  }, { needs: ["arrivals 3 A sends the job with Express apply: the preview, Within 30 days, the consent tick; Arrivals waits with Offers empty"] });

  await step("offers 2 A sees it under Offers on Arrivals, with the company's step", A, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/arrivals");
    const offers = p.locator("section", { has: p.getByRole("heading", { name: "Offers", exact: true, level: 2 }) });
    const mine = offers.getByRole("article").filter({ has: p.getByRole("heading", { name: JOB.title }) });
    await mine.waitFor({ timeout: 15000 });
    await mine.getByText(`${CO.name} moved you to Offer`).waitFor();
    await mine.getByText("Offer", { exact: true }).first().waitFor();
  }, { needs: ["offers 1 B opens the job's board, finds A under Applied with no email, and moves A to Offer"] });

  await step("reports 1 A reports the job from Departures: Fake job, scam or spam, Send report", A, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/departures");
    const card = jobCard(p);
    await card.getByRole("button", { name: `Report this job: ${JOB.title}` }).click();
    await card.getByRole("radio", { name: "Fake job, scam or spam" }).check();
    await card.getByRole("button", { name: "Send report" }).click();
    await card.getByRole("status").getByText(/Reported/).waitFor({ timeout: 15000 });
    left.jobReport = true;
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin", "corporate 3 B posts a Data Analyst job and opens it after the three checks: Live on Departures"] });

  await step("reports 2 the admin finds A's report on Reports (Job at the company, A's first name and initial), acknowledges it, then dismisses it", AS_ADMIN, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/admin/reports");
    await p.getByRole("heading", { name: "Reports", level: 1 }).waitFor({ timeout: 15000 });
    const rep = reportRow(p);
    await rep.getByText(`Job at ${CO.name}`).waitFor({ timeout: 15000 });
    await rep.getByText(`${A.first} ${A.last[0]}.`, { exact: true }).waitFor();
    const text = await rep.innerText();
    if (text.includes(A.last) || /@/.test(text)) throw new Error("the report shows the reporter's last name or an email");
    await rep.getByRole("button", { name: /^Acknowledge: / }).click();
    await said(p, "Acknowledged.");
    await rep.getByRole("button", { name: /^Dismiss: / }).click();
    await said(p, "Dismissed. It leaves the list.");
    left.jobReportDone = true;
    await rep.waitFor({ state: "detached", timeout: 15000 });
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin", "reports 1 A reports the job from Departures: Fake job, scam or spam, Send report"] });

  const LIB_STEP = "library: B searches, opens a resource, Saves it and ticks I finished this";
  await step("library 2 B reports the saved resource's link: Link broken or out of date?, Link is broken", B, async (p) => {
    // Only with the admin, who dismisses it after; otherwise it would sit open on Library review.
    if (!ADMIN) return NO_ADMIN;
    await open(p, "/library");
    await p.getByRole("searchbox", { name: "Search the Library" }).fill(libTitle);
    await p.locator("main").first().getByRole("button", { name: libTitle, exact: true }).first().click();
    const panel = p.getByRole("complementary", { name: "Resource details" });
    await panel.getByRole("heading", { name: libTitle, exact: true, level: 3 }).waitFor({ timeout: 15000 });
    await panel.getByRole("button", { name: "Link broken or out of date?" }).click();
    await panel.getByRole("group", { name: `Report ${libTitle}` }).getByRole("button", { name: "Link is broken", exact: true }).click();
    await toast(p, "Thanks. A reviewer will check this link.");
    left.linkReport = true;
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin", LIB_STEP] });

  await step("library 3 the admin sees B's broken-link report on Library review and dismisses it; the link stays", AS_ADMIN, async (p) => {
    if (!ADMIN) return NO_ADMIN;
    await dismissLink(p);
  }, { needs: ["admin 2 the admin test account signs in, and its menu shows Admin", "library 2 B reports the saved resource's link: Link broken or out of date?, Link is broken"] });
} finally {
  // The clean-up runs whatever failed before it, a crash included.
  await cleanUp();
}

await browser.close();
console.log(failed ? `${failed} step(s) failed on ${BASE}` : `All steps passed on ${BASE}`);
process.exit(failed ? 1 : 0);
