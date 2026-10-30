// End-to-end walk of the main flow against a running build (see e2e/README.md). Exits non-zero on any failed step,
// browser console error, page error or 5xx response. Screenshots go to e2e/results/.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3211";
const OUT = new URL("./results/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
// Nearby lines the walk expects, worked out by src/lib/nearby/build.ts and pinned in its test (keep the two in step).
const NEARBY_WALK_EMPTY =
  "None of our other roles shares at least half its key skills with you yet. The closest, BI Developer (Power BI), shares 2 of its 7.";
const NEARBY_WALK_SWITCHER = [
  ["Data Analyst", 4, 7],
  ["Senior Data Scientist", 5, 7],
];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// Reduced motion: axe reads colours mid fade-in otherwise and reports contrast the finished page doesn't have.
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const p = await ctx.newPage();
const problems = [];
// The browser logs the 404 the not-found step asks for on purpose; any other console error is a problem.
const expected404 = "/no-such-page";
const testEmail = `e2e-${Date.now()}@example.com`;
// True only while a step makes a request fail on purpose.
let failingOnPurpose = false;
// The browser's "Failed to load resource" message doesn't name the resource, so keep the last 404s to name it.
const recent404 = [];
p.on("response", (r) => r.status() === 404 && recent404.push(`${r.request().method()} ${new URL(r.url()).pathname}`) && recent404.splice(0, recent404.length - 3));
p.on(
  "console",
  (m) =>
    m.type() === "error" &&
    !failingOnPurpose &&
    !(new URL(p.url()).pathname === expected404 && m.text().includes("404")) &&
    problems.push(`console@${p.url()}: ${m.text().slice(0, 200)}${m.text().includes("404") ? ` (resource: ${m.location()?.url ?? "?"}; recent 404s: ${recent404.join(", ")})` : ""}`),
);
p.on("pageerror", (e) => problems.push(`pageerror@${p.url()}: ${e.message.slice(0, 200)}`));
p.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
// WCAG 2.1 AA check with axe on each main screen (engineering-standards.md, section 6). Serious and critical
// violations fail the walk; moderate and minor ones are printed so they can be fixed without blocking.
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const a11yNotes = [];
/**
 * axe on any page. A server action's refresh() can still be landing when the check starts, and for that moment the head
 * has no <title> (seen in CI on inbox-report and me-certifications-held, never locally), so every check first waits for
 * the title; a page that never gets one still fails on document-title.
 */
const axeOn = async (q, name) => {
  if (!(await q.evaluate(() => document.title))) {
    const back = await q.waitForFunction(() => document.title !== "", null, { timeout: 5000 }).then(() => true, () => false);
    if (back) a11yNotes.push(`${name}: title was empty mid-refresh, then came back`);
  }
  await q.addScriptTag({ content: AXE });
  const result = await q.evaluate(() =>
    axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  for (const v of result.violations) {
    const line = `${name}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}${v.nodes[0]?.any?.[0]?.message ? ` — ${v.nodes[0].any[0].message.slice(0, 160)}` : ""}`;
    if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${line}`);
    else a11yNotes.push(line);
  }
};
const a11y = (name) => axeOn(p, name);
/** The same check on another page (a second signed-in context). */
const a11yOn = axeOn;
let i = 0;
const settled = () =>
  p
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: 60000 })
    .catch(() => {});
// File names without characters the CI artifact upload refuses (: " < > | * ? and line breaks).
const shot = async (name) => p.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-${name.replace(/[:"<>|*?\r\n\\/]/g, "-")}.png`, fullPage: true });
const step = async (name, fn) => {
  try {
    await fn();
    console.log("ok  ", name, "->", new URL(p.url()).pathname);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "@", p.url(), e.message.split("\n")[0]);
    // Job logs aren't readable from every place we debug CI, but annotations are.
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=e2e step failed::${name}: ${e.message.split("\n")[0]}`);
    await shot("fail-" + name);
  }
};
await step("home", async () => {
  await p.goto(BASE + "/");
  await p.getByRole("heading", { name: "Paste the job you're applying for and see what it asks that you don't have." }).waitFor({ timeout: 10000 });
  await shot("home");
  await a11y("home");
});
await step("roles list", async () => {
  await p.goto(BASE + "/roles");
  await shot("roles");
  await a11y("roles");
});
await step("signed out: the header offers Sign in, and it fits a phone", async () => {
  await p.goto(BASE + "/");
  // The header's Sign in link streams in after the page shell (#107); wait for it and for hydration before clicking.
  await p.waitForLoadState("networkidle");
  const signIn = p.getByRole("link", { name: "Sign in", exact: true });
  await signIn.waitFor({ timeout: 15000 });
  await signIn.click();
  await p.waitForURL(/\/sign-in/, { timeout: 15000 });
  await p.goto(BASE + "/");
  await p.setViewportSize({ width: 360, height: 780 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await shot("home-phone");
  await p.setViewportSize({ width: 1280, height: 900 });
  if (overflow) throw new Error("home page scrolls sideways at 360px");
});
await step("upload", async () => {
  await p.goto(BASE + "/start");
  await p.locator('input[type="file"]').setInputFiles(new URL("../fixtures/resumes/priya-sharma.pdf", import.meta.url).pathname);
  const consent = p.locator('input[type="checkbox"]');
  for (const c of await consent.all()) await c.check().catch(() => {});
  await p.locator('button[type="submit"]').click();
  await p.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  await shot("review");
  await a11y("review");
});
await step("confirm profile", async () => {
  await p.getByRole("button", { name: "Looks right", exact: true }).click();
  const next = p.locator('main a[href$="/role"], a[href$="/role"]:not(header a)').first();
  await next.waitFor({ timeout: 15000 });
  await shot("confirmed");
  await next.click();
  await p.waitForURL(/\/role/, { timeout: 15000 });
  // The roles the resume covers best come first, each saying why (role-suggest-plan.md part A).
  await p.getByRole("heading", { name: "Closest to your resume" }).waitFor({ timeout: 5000 });
  const suggested = p.locator('section[aria-labelledby="suggested-roles"] li');
  const count = await suggested.count();
  if (count < 1 || count > 3) throw new Error(`expected 1 to 3 suggested roles, got ${count}`);
  if (!/Your resume shows \d+ of its \d+ key skills, like /.test(await suggested.first().innerText())) throw new Error("suggestion doesn't say why");
  await shot("role");
  await a11y("role");
});
await step("download the confirmed resume as PDF and Word", async () => {
  const rolePage = p.url();
  await p.goto(rolePage.replace(/\/role$/, ""));
  await p.getByRole("heading", { name: "Download your resume" }).waitFor({ timeout: 10000 });
  await a11y("resume-download");
  for (const [label, type, magic] of [["PDF", "application/pdf", "%PDF-"], ["Word", "wordprocessingml", "PK"]]) {
    const href = await p.getByRole("link", { name: label, exact: true }).getAttribute("href");
    const res = await p.request.get(BASE + href);
    if (res.status() !== 200 || !res.headers()["content-type"].includes(type)) throw new Error(`${label}: ${res.status()} ${res.headers()["content-type"]}`);
    const body = await res.body();
    if (!body.subarray(0, magic.length).toString("latin1").startsWith(magic)) throw new Error(`${label} isn't a ${label} file`);
  }
  await p.goto(rolePage);
});
await step("pick role", async () => {
  await p.locator('a[href$="/gaps/data-analyst"]').first().click();
  await p.waitForURL(/\/gaps\//, { timeout: 60000 });
  await settled();
  await shot("gaps");
  await a11y("gaps");
});
await step("rate gaps", async () => {
  await p.getByRole("button", { name: /^4:/ }).click();
  await p.getByText("Thanks, saved.").waitFor({ timeout: 10000 });
});
await step("a failed rating goes back to the saved one", async () => {
  failingOnPurpose = true;
  await p.route("**/api/gaps/*/rating", (route) => route.abort("failed"));
  try {
    await p.getByRole("button", { name: /^1:/ }).click();
    await p.getByRole("alert").filter({ hasText: "try again" }).waitFor({ timeout: 10000 });
    await p.getByRole("button", { name: /^4:/, pressed: true }).waitFor({ timeout: 5000 });
    if (await p.getByRole("button", { name: /^1:/, pressed: true }).count()) throw new Error("unsaved rating still shown");
  } finally {
    // Even if this step fails, later steps must see real errors again.
    await p.unroute("**/api/gaps/*/rating");
    failingOnPurpose = false;
  }
});
await step("check against a job: the groups show, and the gaps stay as they were", async () => {
  const posting = JSON.parse(readFileSync(new URL("../fixtures/job-postings/example-analytics-data-analyst.json", import.meta.url), "utf8"));
  const gapsBefore = await p.locator("article").allInnerTexts();
  const fill = async () => {
    await p.getByLabel("Company", { exact: true }).fill(posting.company);
    await p.getByLabel("Job title", { exact: true }).fill(posting.title);
    await p.getByLabel("Job posting", { exact: true }).fill(posting.text);
    await p.getByRole("button", { name: "Check this job" }).click();
  };
  await fill();
  const result = p.getByRole("heading", { name: `${posting.title} at ${posting.company}` });
  await result.waitFor({ timeout: 60000 });
  // Focus moves to the new result once it shows.
  await p.waitForFunction(() => document.activeElement?.id?.startsWith("job-check-"), null, { timeout: 10000 });
  for (const group of ["Covered", "Your goals this job also asks for", "Only for this job", "Not asked for this job", "Good to have", "Not in our skill list yet"]) {
    await p.getByRole("heading", { level: 4, name: new RegExp(`^${group} \\(\\d+\\)$`) }).waitFor({ timeout: 5000 });
  }
  const text = await p.locator(`[id^="job-check-"]`).first().locator("..").locator("..").innerText();
  if (!text.includes("Alteryx")) throw new Error("unknown skill not listed");
  if (/Kubernetes/.test(text)) throw new Error("a skill with an invented quote was kept");
  // The same posting again reuses the saved check: no second result.
  await fill();
  await p.getByRole("status").filter({ hasText: "You checked this posting before" }).waitFor({ timeout: 30000 });
  if ((await result.count()) !== 1) throw new Error(`expected one saved check, got ${await result.count()}`);
  await p.reload();
  await settled();
  if (JSON.stringify(await p.locator("article").allInnerTexts()) !== JSON.stringify(gapsBefore)) throw new Error("a job check changed the gaps");
  // Not signed in: goals are kept for an account, so "Only for this job" asks to sign in instead of adding.
  if (!(await p.getByRole("link", { name: "Sign in to keep goals" }).count())) throw new Error("no sign-in link on Only for this job");
  if (await p.getByRole("button", { name: /^Add as my goal/ }).count()) throw new Error("Add as my goal shown while signed out");
  // The first check before sign-up (handoff 12m, C19): keep it in My jobs by signing up.
  const keep = p.getByRole("region", { name: "Keep it in My jobs" });
  await keep.getByRole("heading", { name: "Sign up to keep it in My jobs and prepare for the interview." }).waitFor({ timeout: 5000 });
  if ((await keep.getByRole("link", { name: "Sign up with email" }).getAttribute("href")) !== "/sign-in?next=%2Fdepartures%3Ftab%3Dmine")
    throw new Error("Sign up with email doesn't lead to My jobs");
  await shot("job-check");
  await a11y("job-check");
  await p.emulateMedia({ colorScheme: "dark" });
  // Reload so every colour is drawn dark from the start, as a visitor in dark mode sees it.
  await p.reload();
  await settled();
  await a11y("job-check-dark");
  await p.emulateMedia({ colorScheme: "light" });
});
await step("gaps say how often postings ask for a skill, where we measured it", async () => {
  // Data Analyst was measured on public postings (data/jd-snapshots), so its gaps carry the number.
  const labels = await p.locator("article").getByText(/^Asked in (\d+|fewer than 1) of 10 postings$/).count();
  if (labels < 1) throw new Error("no gap says how often postings ask for it");
});
await step("screening check: keywords, layout and headings for the uploaded PDF, and nothing added without a yes", async () => {
  // FR-34 (dev/resume-check-plan.md). The walk uploaded a one-column PDF with standard headings.
  const check = p.locator('section[aria-labelledby="screening-check"]');
  await check.waitFor({ timeout: 10000 });
  const text = await check.innerText();
  // The labels are set in capitals by CSS, which innerText follows.
  for (const label of ["KEYWORDS", "LAYOUT", "HEADINGS"]) if (!text.includes(label)) throw new Error(`summary has no ${label} line`);
  if (/%|score/i.test(text)) throw new Error("screening readiness shown as a number");
  if (!text.includes("We found nothing in your PDF that screening software reads badly.")) throw new Error("layout of the uploaded PDF not checked");
  if (!text.includes("Your headings use names screening software knows")) throw new Error("headings not checked");
  if (!/A PDF doesn't tell us about tables, text boxes and headers and footers/.test(text)) throw new Error("PDF limits not said");
  const href = await check.getByRole("link", { name: "Download Word" }).getAttribute("href");
  if (!/\/api\/resume\/[0-9a-f-]+\/export\?format=docx$/.test(href ?? "")) throw new Error("fix-up doesn't link to the download: " + href);
  const keywords = check.getByRole("button", { name: /^I have this: / });
  if ((await keywords.count()) < 1) throw new Error("no missing keyword to confirm");
  // Opening and cancelling saves nothing: the gaps stay as they were.
  const gapsBefore = await p.locator("article").allInnerTexts();
  await keywords.first().click();
  await check.getByText("We add only the skill's name. It stays a goal until you prove it.").waitFor({ timeout: 5000 });
  await a11y("screening-confirm-open");
  await check.getByRole("button", { name: "Cancel" }).click();
  await p.reload();
  await settled();
  if (JSON.stringify(await p.locator("article").allInnerTexts()) !== JSON.stringify(gapsBefore)) throw new Error("cancelling a keyword changed the gaps");
  await check.scrollIntoViewIfNeeded();
  await shot("screening-check");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.reload();
  await settled();
  await a11y("screening-check-dark");
  await p.setViewportSize({ width: 360, height: 780 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await check.scrollIntoViewIfNeeded();
  await shot("screening-check-phone-dark");
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.emulateMedia({ colorScheme: "light" });
  if (overflow > 1) throw new Error("gaps with the screening check scroll sideways at 360px: " + overflow + "px");
});
// A role our library doesn't have (role-suggest-plan.md part B, point 4): the search counts it, and a posting stands in.
let roleGapsUrl = "";
await step("my role isn't listed: the search counts it, and a posting stands in as the target", async () => {
  const posting = JSON.parse(readFileSync(new URL("../fixtures/job-postings/example-freight-supply-chain-analyst.json", import.meta.url), "utf8"));
  roleGapsUrl = p.url().split("?")[0];
  await p.goto(roleGapsUrl.replace(/\/gaps\/[^/]+$/, "/role"));
  const search = p.getByRole("searchbox", { name: "Search roles or skills" });
  // Typing, pausing and leaving the box count nothing: only Enter or the "My role isn't listed" link does.
  let sentEarly = 0;
  const watch = (r) => r.method() === "POST" && r.url().includes("/api/role-requests") && sentEarly++;
  p.on("request", watch);
  await search.pressSequentially(posting.title, { delay: 20 });
  await p.getByText(/^No role matches/).waitFor({ timeout: 5000 });
  await p.waitForTimeout(3500);
  await p.getByRole("heading", { name: "All roles" }).click();
  await p.waitForTimeout(500);
  p.off("request", watch);
  if (sentEarly) throw new Error(`typing alone sent ${sentEarly} role requests`);
  await search.focus();
  const [counted] = await Promise.all([
    p.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/role-requests"), { timeout: 10000 }),
    search.press("Enter"),
  ]);
  if (counted.status() !== 200) throw new Error(`role request answered ${counted.status()}`);
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [row] = await sql`select count from role_requests where title = ${posting.title.toLowerCase()}`;
      if (!row || row.count < 1) throw new Error("the missing role wasn't counted");
    } finally {
      await sql.end();
    }
  }
  await shot("role-not-listed");
  await a11y("role-not-listed");

  await p.getByRole("link", { name: /My role isn't listed/ }).click();
  await p.waitForURL(/\/role\/other$/, { timeout: 15000 });
  if (/title|supply/i.test(p.url())) throw new Error("the typed title is in the address");
  await p.getByLabel("Job title", { exact: true }).waitFor({ timeout: 10000 });
  // Carried in sessionStorage, read once the page is in the browser.
  const carried = await p
    .waitForFunction((t) => document.querySelector('input[name="title"]')?.value === t, posting.title, { timeout: 10000 })
    .then(() => true, () => false);
  if (!carried) throw new Error("typed title not carried over");
  await a11y("stand-in-form");
  await p.getByLabel("Company", { exact: true }).fill(posting.company);
  await p.getByLabel("Job posting", { exact: true }).fill(posting.text);
  await p.getByRole("button", { name: "Check my gaps for this job" }).click();
  await p.waitForURL(/\/job\/[0-9a-f-]+$/, { timeout: 60000 });
  await settled();
  await p.getByRole("heading", { level: 1, name: "Your gaps for this job" }).waitFor({ timeout: 10000 });
  await p.getByRole("note").getByText("This job posting stands in until we add the role").waitFor();
  const text = await p.locator("body").innerText();
  if ((await p.locator("article").count()) < 1) throw new Error("no gaps shown for the posting");
  if (!/You cover \d+ of the \d+ skills this job asks for\./.test(text)) throw new Error("readiness not in words about this job");
  if (/Kubernetes/.test(text)) throw new Error("a skill with an invented quote was kept");
  if (/Asked in/.test(text)) throw new Error("a posting's gaps claim how common a skill is");
  if (!text.includes("Not in our skill list yet")) throw new Error("unknown skills not listed");
  if (!/Screening check[\s\S]*asks for/i.test(text)) throw new Error("no screening check against the posting");
  await shot("stand-in-gaps");
  await a11y("stand-in-gaps");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.reload();
  await settled();
  await a11y("stand-in-gaps-dark");
  await p.setViewportSize({ width: 360, height: 780 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot("stand-in-gaps-phone-dark");
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.emulateMedia({ colorScheme: "light" });
  if (overflow > 1) throw new Error("stand-in gaps scroll sideways at 360px: " + overflow + "px");

  // The role list now offers it again, and the role's own Gaps page is as it was.
  await p.goto(roleGapsUrl.replace(/\/gaps\/[^/]+$/, "/role"));
  await p.getByRole("link", { name: new RegExp(`${posting.title} at ${posting.company}`) }).waitFor({ timeout: 10000 });
  await p.setViewportSize({ width: 360, height: 780 });
  const roleOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await p.setViewportSize({ width: 1280, height: 900 });
  if (roleOverflow > 1) throw new Error("role list scrolls sideways at 360px: " + roleOverflow + "px");
});
await step("back to the role's gaps", async () => {
  await p.goto(roleGapsUrl);
  await settled();
  await p.getByRole("link", { name: /build my path/i }).waitFor({ timeout: 10000 });
});
let pathUrl = "";
await step("path", async () => {
  await p.getByRole("link", { name: /build my path/i }).click();
  await p.waitForURL(/\/path\//, { timeout: 30000 });
  await settled();
  pathUrl = p.url().split("?")[0];
  if (await p.getByText(/Works toward: (Missing skill|Skill with weak evidence|Outdated skill)$/).count()) throw new Error("jargon status on a step");
  // The way on is there before any step is done (Milin, 2026-10-25): signed out, it is the sign-in of the path's end.
  await p.getByRole("heading", { name: "You don't need to finish every step first" }).waitFor({ timeout: 10000 });
  await p.getByRole("link", { name: "Sign in to keep your path" }).waitFor();
  if (await p.getByRole("heading", { name: "Every step done" }).count()) throw new Error("finished card before any step is done");
  await shot("path");
  await a11y("path");
});
await step("path hours", async () => {
  const h = p.locator('a[href*="hours="]');
  if (await h.count()) {
    await h.last().click();
    await p.waitForURL(/hours=/);
    await settled();
    await shot("path-hours");
  }
});
await step("mark path step done", async () => {
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/path-steps/")),
    p
      .getByRole("button", { name: /^Mark done: / })
      .first()
      .click(),
  ]);
  await p.reload();
  await settled();
  await p.getByText(/1 of \d+ steps done/).waitFor({ timeout: 10000 });
  await shot("path-done");
});
await step("sign in as test user (claims the anonymous resume)", async () => {
  await p.goto(BASE + "/today");
  await p.locator('input[name="name"]').fill("Priya Sharma");
  await p.locator('input[name="email"]').fill(testEmail);
  await p.locator('form button[type="submit"]').last().click();
  await p.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
  await p.locator('input[type="checkbox"]').first().check();
  await p
    .getByRole("button")
    .filter({ hasText: /continue|finish|start|create/i })
    .first()
    .click();
  await p.waitForURL(/\/today/, { timeout: 20000 });
  await settled();
  await shot("today-first");
  await a11y("today-first");
});
await step("signed in: the public top bar leads to Today, not Sign in", async () => {
  const r = await p.context().newPage();
  try {
    await r.goto(BASE + "/roles");
    await r.getByRole("link", { name: "Today", exact: true }).waitFor({ timeout: 10000 });
    if (await r.getByRole("link", { name: "Sign in", exact: true }).count()) throw new Error("Sign in shown while signed in");
  } finally {
    await r.close();
  }
});
await step("today shows the person's own goals", async () => {
  await p.locator('section[aria-label="Your goals"]').waitFor();
  const names = await p.locator('section[aria-label="Your goals"] li b').allTextContents();
  console.log("     goals:", names.join(", "));
  if (names.includes("SQL window functions")) throw new Error("example goals shown");
});
await step("hours a week is saved", async () => {
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/today")),
    p.getByRole("group", { name: "Hours a week" }).getByRole("button", { name: "8 h" }).click(),
  ]);
  await p.reload();
  await settled();
  await p.getByRole("group", { name: "Hours a week" }).getByRole("button", { name: "8 h", pressed: true }).waitFor({ timeout: 10000 });
});
await step("tick a ride task -> returning + streak", async () => {
  const task = p.locator('section[aria-label="Welcome"] li label').first();
  await task.click();
  await p
    .locator("header")
    .getByText(/1-day streak/)
    .waitFor({ timeout: 10000 });
  await settled();
  await shot("today-returning");
  await a11y("today-returning");
});
await step("add a certificate: the form opens, and a name that isn't yours is refused", async () => {
  const prove = p.locator('section[aria-label^="Pitstop"]');
  await prove.getByRole("button", { name: /^(Add certificate|Renew)$/ }).click();
  const form = p.getByRole("form", { name: /^Add a certificate for / });
  if (!(await form.count())) {
    await prove.getByRole("status").getByText(/No certificate on our list/).waitFor({ timeout: 5000 });
    console.log("     no certificate covers this goal; form not shown");
    return;
  }
  await a11y("certificate-form");
  await form.getByLabel("Certificate", { exact: true }).selectOption({ index: 1 });
  await form.getByLabel("Credential ID").fill(`WALK-${Date.now()}`);
  await form.getByLabel("Your name as printed").fill("Amit Verma");
  await form.getByLabel("Date issued").fill("2025-03-01");
  await form.getByLabel("It never expires").check();
  await form.getByLabel("Verify link").fill("https://www.credly.com/badges/c4ed1100-0000-4000-8000-0000000000f1");
  await form.getByLabel(/This certificate is mine/).check();
  await form.getByRole("button", { name: "Save certificate" }).click();
  await form.getByText(/doesn't match your account/).waitFor({ timeout: 10000 });
  await shot("certificate-refused");
  await form.getByRole("button", { name: "Cancel" }).click();
  if (await form.count()) throw new Error("form still open after Cancel");
});
await step("design page: the certificate form says example data is never saved", async () => {
  await p.goto(BASE + "/design");
  const form = p.getByRole("form", { name: "Add a certificate for SQL window functions" }).first();
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Certificate", { exact: true }).selectOption({ index: 1 });
  await form.getByLabel("Credential ID").fill("EXAMPLE-1");
  await form.getByLabel("Your name as printed").fill("Priya Sharma");
  await form.getByLabel("Date issued").fill("2025-03-01");
  await form.getByLabel("Expiry date").fill("2028-03-01");
  await form.getByLabel("Verify link").fill("https://www.credly.com/badges/c4ed1100-0000-4000-8000-0000000000f2");
  await form.getByLabel(/This certificate is mine/).check();
  await form.getByRole("button", { name: "Save certificate" }).click();
  await form.getByText(/example data, so nothing is saved/).waitFor({ timeout: 5000 });
  // A refused save keeps what the person typed.
  if ((await form.getByLabel("Credential ID").inputValue()) !== "EXAMPLE-1") throw new Error("the form was emptied after a refused save");
  await shot("certificate-form");
  await a11y("design-certificate-form");
  await p.goto(BASE + "/today");
  await settled();
});
await step("static pages still load after a tick", async () => {
  // A tick once threw away every cached page, and /roles/[slug] then failed to rebuild (500).
  for (const path of ["/roles/data-analyst", "/roles", "/"]) {
    const r = await p.request.get(BASE + path);
    if (r.status() !== 200) throw new Error(`${path} status ${r.status()}`);
  }
});
await step("untick -> back to first, no streak", async () => {
  await p.locator('section[aria-label="Today\'s ride"] li label').first().click();
  await p.locator('section[aria-label="Welcome"]').waitFor({ timeout: 10000 });
  if (
    await p
      .locator("header")
      .getByText(/streak/)
      .count()
  )
    throw new Error("streak still shown");
});
// Signed in now, with the job check made before signing in (it came with the resume).
let choiceSkill = "";
await step("job check: add as my goal, remove it and add it again, see it as Your choice on Today and the map, plan for this job, remove the check", async () => {
  const gapsUrl = pathUrl.replace("/path/", "/gaps/");
  const before = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  await p.goto(gapsUrl);
  await settled();
  const add = p.getByRole("button", { name: /^Add as my goal: / }).first();
  await add.waitFor({ timeout: 10000 });
  const skill = (await add.getAttribute("aria-label")).replace(/^Add as my goal: /, "");
  choiceSkill = skill;
  const addIt = async () => {
    const button = p.getByRole("button", { name: `Add as my goal: ${skill}` }).first();
    await Promise.all([p.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/goals")), button.click()]);
    await p.getByRole("status").filter({ hasText: "On your goals" }).first().waitFor({ timeout: 10000 });
  };
  await addIt();
  // Remove from my goals: the Add button comes back and takes focus; then add it again.
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/api/goals/")),
    p.getByRole("button", { name: `Remove from my goals: ${skill}` }).first().click(),
  ]);
  await p.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === `Add as my goal: ${name}`, skill, { timeout: 10000 });
  await addIt();
  // The gaps and the match don't move.
  const after = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  const analyses = (d) => JSON.stringify(d.resumes.flatMap((r) => r.profiles.flatMap((x) => x.gapAnalyses.map((a) => a.result))));
  if (analyses(after) !== analyses(before)) throw new Error("adding a goal changed the gap analysis");
  const goal = after.goals.find((g) => g.source === "user");
  if (!goal?.jobCheckId || goal.jobCompany !== "Example Analytics Pvt Ltd") throw new Error("the download lacks the goal's job check");

  // Today: in its own Your choice list, not on the ride.
  await p.goto(BASE + "/today");
  await settled();
  const choiceList = p.locator('section[aria-label="Your goals"]').getByRole("region", { name: "Your choice" });
  await choiceList.getByText(skill, { exact: true }).waitFor({ timeout: 10000 });
  await choiceList.getByText("Your choice · for Example Analytics Pvt Ltd").first().waitFor();
  if ((await p.locator('section[aria-label="Today\'s ride"], section[aria-label="Welcome"]').first().innerText()).includes(skill)) throw new Error("a Your choice goal is on the ride");
  await shot("today-your-choice");
  await a11y("today-your-choice");
  // The map: off the line, in its own list; no station for it.
  await p.goto(BASE + "/map");
  await settled();
  const mapChoice = p.getByRole("region", { name: "Your choice" });
  await mapChoice.getByText("Your choice · for Example Analytics Pvt Ltd").waitFor({ timeout: 10000 });
  if (await p.locator(`g[role="button"][aria-label*="${skill}"]`).count()) throw new Error("a Your choice goal is a station on the line");
  await shot("map-your-choice");
  await a11y("map-your-choice");

  await p.goto(gapsUrl);
  await settled();
  await p.getByRole("link", { name: "Plan for this job" }).first().click();
  await p.waitForURL(/\/path\/.*[?&]job=/, { timeout: 30000 });
  await settled();
  await p.getByRole("heading", { name: "To apply here, close these first" }).waitFor({ timeout: 10000 });
  await p.getByRole("status").filter({ hasText: "On your goals" }).first().waitFor({ timeout: 5000 });
  await shot("plan-for-job");
  await a11y("plan-for-job");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.reload();
  await settled();
  await a11y("plan-for-job-dark");
  await p.emulateMedia({ colorScheme: "light" });
  // Someone else's id, or a made-up one, shows the normal path.
  await p.goto(pathUrl + "?job=00000000-0000-4000-8000-000000000000");
  await settled();
  if (await p.getByRole("heading", { name: "To apply here, close these first" }).count()) throw new Error("a made-up job id showed a plan");

  await p.goto(gapsUrl);
  await settled();
  const heading = p.getByRole("heading", { name: "Data Analyst at Example Analytics Pvt Ltd" });
  await p.getByRole("button", { name: /^Remove this check: / }).first().click();
  await p.getByRole("button", { name: "Yes, remove it" }).click();
  await heading.waitFor({ state: "detached", timeout: 10000 });
  // Focus goes to the section's heading (no check is left) and the removal is said.
  await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Check against a job", null, { timeout: 10000 });
  await p.getByRole("status").filter({ hasText: "Check removed. Goals you added from it stay." }).waitFor({ timeout: 5000 });
  // The goal stays; it only loses the job's tag.
  await p.goto(BASE + "/map");
  await settled();
  await p.getByRole("region", { name: "Your choice" }).locator("li").getByText("Your choice", { exact: true }).waitFor({ timeout: 10000 });
});
await step("loading frame shows the header at once", async () => {
  await p.goto(BASE + "/map", { waitUntil: "commit" });
  await p.locator("header").first().waitFor({ timeout: 3000 });
  await settled();
});
// Not for me (FR-48): the pitstop the person is at offers "Skip anyway" on a required goal. Skipped, it stays on the line
// and focus moves to the section's heading; Bring back restores it.
await step("not for me: skip the current goal on the Map, then bring it back", async () => {
  await p.goto(BASE + "/map");
  await settled();
  const section = p.getByRole("region", { name: "Not for me" });
  await section.waitFor({ timeout: 10000 });
  await section.getByRole("button", { name: "Skip anyway" }).click();
  await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Skipped", null, { timeout: 15000 });
  const skipped = p.getByRole("region", { name: "Skipped" });
  await skipped.getByText(/^You skipped .* It stays a gap/).waitFor({ timeout: 5000 });
  await shot("map-goal-skipped");
  await a11y("map-goal-skipped");
  await skipped.getByRole("button", { name: "Bring back" }).click();
  await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Not for me", null, { timeout: 15000 });
  await p.getByRole("region", { name: "Not for me" }).getByRole("button", { name: "Skip anyway" }).waitFor({ timeout: 5000 });
});
// Today's live cards (v44 gap items 8 to 10): no example data for a signed-in person. The signal check, when the bank
// has a question for today's goal or the next, is checked on the server and ticks the ride's signal task (a ride day);
// the board shows live rows or says why it has none; On your line shows only with three people who can be counted.
await step("today: live signal check, board and On your line, no example data", async () => {
  await p.goto(BASE + "/today");
  await settled();
  await p.getByText("Everything here is your own except the Timetable, which is example data until we build it.", { exact: true }).waitFor({ timeout: 10000 });
  const board = p.locator("[data-board]");
  await board.waitFor({ timeout: 10000 });
  if ((await board.innerText()).toUpperCase().includes("MIS EXECUTIVE")) throw new Error("Today shows the example board");
  if (await p.getByText(/Arjun Mehta met the/).count()) throw new Error("Today shows the example tip");
  const signal = p.getByRole("region", { name: "Signal check", exact: true });
  if (!(await signal.count())) {
    console.log("     no question in the bank for this goal or the next; card hidden");
    return;
  }
  if (await signal.getByText(/sales next to its rank/).count()) throw new Error("Today shows the example question");
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/today")),
    signal.getByRole("group", { name: "Answers" }).getByRole("button").first().click(),
  ]);
  await signal.getByRole("status").getByText(/^(Right\.|Not quite: it's [A-D]\.)/).waitFor({ timeout: 10000 });
  await p
    .locator("header")
    .getByText(/1-day streak/)
    .waitFor({ timeout: 10000 });
  await shot("today-signal-answered");
  await a11y("today-signal-answered");
});
// The same on Today: skip from an open goal (it leaves the list, focus moves to the card's heading), then bring it back
// from its pitstop on the Map.
await step("not for me: skip a goal on Today, bring it back from the Map", async () => {
  await p.goto(BASE + "/today");
  await settled();
  const card = p.locator('section[aria-label="Your goals"]');
  const row = card.locator("li").filter({ has: p.getByRole("button", { name: "Skip anyway" }) }).first();
  const toggle = card.locator("ul > li > button[aria-expanded]").first();
  const name = (await toggle.locator("b").innerText()).trim();
  await toggle.click();
  await row.getByRole("button", { name: "Skip anyway" }).click();
  await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Your goals", null, { timeout: 15000 });
  if (await card.locator("ul > li > button b").getByText(name, { exact: true }).count()) throw new Error("a skipped goal is still on Today");
  await a11y("today-goal-skipped");
  await p.goto(BASE + "/map");
  await settled();
  // The skipped goal's pitstop: the one whose sheet says Skipped.
  const stations = p.locator('svg g[role="button"]:not([data-crossing])');
  const skipped = p.getByRole("region", { name: "Skipped" });
  for (let k = 0, n = await stations.count(); k < n && !(await skipped.count()); k++) await stations.nth(k).click();
  await skipped.getByText(new RegExp(`^You skipped ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`)).waitFor({ timeout: 5000 });
  await skipped.getByRole("button", { name: "Bring back" }).click();
  await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Not for me", null, { timeout: 15000 });
});
// Tracks (docs/plans/tracks-plan.md, local and preview only until reviewed): the Track chip opens the picker, Cancel
// puts focus back on the option, Switch track works the goals out again and keeps the choice after a reload, and
// Escape closes it with focus on the chip. The track the person had is put back in `finally`, so later steps see the
// same line.
await step("tracks: the Track chip opens the picker and switching works the goals out again", async () => {
  await p.goto(BASE + "/today");
  await settled();
  const card = p.locator('section[aria-label="Your goals"]');
  const chip = card.getByRole("button", { name: /^Track / });
  const panel = card.locator("div[id]").filter({ hasText: "What kind of work do you want there?" });
  const optionName = (o) => o.locator("b").innerText().then((t) => t.trim());
  const choose = async (name) => {
    if (!(await panel.isVisible())) await chip.click();
    const option = panel.getByRole("button").filter({ has: p.locator("b").getByText(name, { exact: true }) });
    if ((await option.getAttribute("aria-pressed")) === "true") return;
    await option.click();
    await panel.getByRole("button", { name: "Switch track" }).click();
    await card.getByRole("button", { name: `Track ${name}`, exact: true }).waitFor({ timeout: 15000 });
  };
  await chip.click();
  await panel.getByText("What kind of work do you want there? Your goals come from the track you pick.", { exact: false }).waitFor({ timeout: 5000 });
  const original = await optionName(panel.getByRole("button", { pressed: true }));
  const other = panel.getByRole("button", { pressed: false }).first();
  const target = await optionName(other);
  try {
    if (!/ goals?(, \d+ met)?$/.test((await other.locator("small").innerText()).trim())) throw new Error("no goal count on a track");
    await a11y("today-tracks-open");
    // Picking previews the track and moves focus to Switch track; Cancel puts it back on the option.
    await other.click();
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Switch track", null, { timeout: 5000 });
    await panel.getByText(/Your goals become |Your resume and proof already cover/).waitFor({ timeout: 5000 });
    await panel.getByRole("button", { name: "Cancel" }).click();
    await p.waitForFunction((n) => document.activeElement?.getAttribute("aria-pressed") === "false" && document.activeElement?.textContent?.includes(n), target, { timeout: 5000 });
    if (await panel.getByRole("button", { name: "Switch track" }).count()) throw new Error("preview still open after Cancel");
    // Switch: the chip names the track, focus stays on it, and the choice is kept after a reload.
    await choose(target);
    await p.waitForFunction((n) => document.activeElement?.getAttribute("aria-label") === `Track ${n}`, target, { timeout: 15000 });
    await settled();
    await p.reload();
    await settled();
    await card.getByRole("button", { name: `Track ${target}`, exact: true }).waitFor({ timeout: 10000 });
    await shot("today-tracks-switched");
    await a11y("today-tracks-switched");
    await p.emulateMedia({ colorScheme: "dark" });
    await p.reload();
    await settled();
    await chip.click();
    await a11y("today-tracks-dark");
    await p.emulateMedia({ colorScheme: "light" });
    // Escape closes the picker and puts focus on the chip.
    if (!(await panel.isVisible())) await chip.click();
    await panel.getByRole("button").first().focus();
    await p.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout: 5000 });
    await p.waitForFunction((n) => document.activeElement?.getAttribute("aria-label") === `Track ${n}`, target, { timeout: 5000 });
  } finally {
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/today");
    await settled();
    await choose(original);
    await settled();
  }
});
for (const path of ["/map", "/match", "/practice", "/me", "/departures", "/settings", "/inbox", "/network", "/library", "/builder", "/grievances", "/privacy", "/terms"]) {
  await step("open " + path, async () => {
    const r = await p.goto(BASE + path);
    if (!r.ok()) throw new Error("status " + r.status());
    await settled();
    await shot(path.slice(1));
    await a11y(path.slice(1));
  });
}
// Match (handoff 12i). Signed in, with a confirmed resume and goals: Ready now heads the list (or the empty state shows
// when nothing is within 26 weeks), the hours select regroups the roles in place, and axe passes.
await step("match: ready now and within N weeks, regrouped by the hours select", async () => {
  await p.goto(BASE + "/match");
  await settled();
  const ready = p.getByRole("heading", { name: "Ready now", level: 2 });
  const empty = p.getByRole("heading", { name: "No roles to show yet", level: 2 });
  await ready.or(empty).first().waitFor({ timeout: 10000 });
  if (await ready.count()) {
    const hours = p.getByLabel("I can give");
    await hours.selectOption("10");
    await p.getByText("at 10 hours a week", { exact: true }).waitFor({ timeout: 5000 });
  }
  await a11y("match");
});
// Practice (handoff 12h). Signed in, with goals from the walk's resume (the data-analyst gaps, such as statistics and Excel, have bank questions):
// pick a skill, answer in 5 or more words, get feedback from the stand-in model (e2e/mock-ai.mjs), rate it, and axe
// passes. One answer with feedback uses one of the day's 10. Me then shows Practice confidence, which View as others hides.
await step("practice: answer a bank question, get feedback in words, rate it, and Me shows the trend", async () => {
  await p.goto(BASE + "/practice");
  await settled();
  const skillsPicker = p.getByRole("group", { name: "Pick a skill" }).getByRole("button");
  const none = p.getByRole("heading", { name: "No practice questions for your goals yet", level: 2 });
  await skillsPicker.first().or(none).first().waitFor({ timeout: 10000 });
  if (await none.count()) throw new Error("the walk's goals have no practice questions");
  await skillsPicker.first().click();
  const leftNow = async () => Number(((await p.getByText(/ of 10 answers left today/).first().textContent()) ?? "").match(/(\d+) of 10/)?.[1] ?? NaN);
  const before = await leftNow();
  const send = p.getByRole("button", { name: "Get feedback" });
  await p.getByLabel("Your answer").fill("Too short");
  if ((await send.getAttribute("aria-disabled")) !== "true") throw new Error("Get feedback works with under 5 words");
  await p.getByLabel("Your answer").fill("I would start with the simplest version that works and test it on a small example first.");
  await send.click();
  await p.getByText("A stronger answer", { exact: true }).waitFor({ timeout: 30000 });
  for (const name of ["Structure", "Specificity", "Correctness"]) await p.getByText(name, { exact: true }).first().waitFor();
  await p.getByRole("button", { name: "Fairly" }).click();
  await p.getByRole("button", { name: "Fairly", pressed: true }).waitFor({ timeout: 5000 });
  const after = await leftNow();
  if (after !== before - 1) throw new Error(`answers left went from ${before} to ${after}`);
  await a11y("practice");
  await p.goto(BASE + "/me");
  await settled();
  await p.getByRole("heading", { name: "Practice confidence" }).waitFor({ timeout: 10000 });
  await p.getByText(/Fairly · \d+ sessions?/).first().waitFor({ timeout: 5000 });
  await p.getByRole("button", { name: "View as others" }).click();
  await p.getByText("You are seeing your profile the way other people will", { exact: false }).waitFor();
  if (await p.getByRole("heading", { name: "Practice confidence" }).count()) throw new Error("View as others shows Practice confidence");
});
// Library (FR-51, handoff 12a). Signed in, with the walk's goals: one card per open goal with Learn or Brush up and
// Prove; a resource opens in the details panel with its source link in a new tab and no referrer; a search for nothing
// says so; the Hindi filter is pressed and let go; Finished and Saved say what they hold. The Elite tab is locked on
// Free: Turn on Elite opens /elite and no card links out (Elite part 5). axe passes on each tab.
// Library part 2 (docs/plans/library-part-2-plan.md): from the details panel the walk saves a resource, ticks "I
// finished this", adds one for a goal to its rides (On your rides) and takes it off again, and reports a
// broken link; an empty suggestion moves focus back to the box, and a link is sent for review. Saved lists the saved
// one until its bookmark is pressed again. The reported link is hidden by the admin in the Library review step below.
let libraryReported = null;
const suggestedLink = `https://learn.example.org/e2e-walk-${Date.now()}`;
await step("library: goal cards, the details panel, search and filters, Finished and Saved", async () => {
  await p.goto(BASE + "/library");
  await settled();
  const main = p.locator("main").first();
  await main.getByRole("heading", { name: "Library", level: 1 }).waitFor({ timeout: 10000 });
  const cards = main.getByRole("region").filter({ has: p.getByText("Skill check", { exact: true }) });
  if (!(await cards.count())) throw new Error("no goal cards for the walk's goals");
  await a11y("library");
  const rows = main.locator("li button[aria-controls]");
  if (await rows.count()) {
    const title = (await rows.first().innerText()).trim();
    await rows.first().click();
    const panel = p.getByRole("complementary", { name: "Resource details" });
    await panel.getByRole("heading", { name: title, exact: true, level: 3 }).waitFor({ timeout: 5000 });
    const source = panel.getByRole("link", { name: /^Open on .+ \(opens in a new tab\)$/ });
    if ((await source.getAttribute("target")) !== "_blank" || !(await source.getAttribute("rel"))?.includes("noreferrer")) throw new Error("the source link doesn't open in a new tab without a referrer");
    if (!(await source.getAttribute("href"))?.startsWith("https://")) throw new Error("the source link isn't https");
  }
  const panel = p.getByRole("complementary", { name: "Resource details" });
  const toast = (text) => p.getByRole("status").filter({ hasText: text }).waitFor({ timeout: 10000 });
  const savedTitle = (await rows.first().innerText()).trim();
  await rows.first().click();
  await panel.getByRole("heading", { name: savedTitle, exact: true, level: 3 }).waitFor({ timeout: 5000 });
  await panel.getByRole("button", { name: `Save ${savedTitle}`, exact: true }).click();
  await toast("Saved to your Library.");
  await panel.getByRole("button", { name: `Save ${savedTitle}`, exact: true, pressed: true }).waitFor({ timeout: 5000 });
  // "I finished this" is the person's own tick, and says what proves the goal next.
  const tick = panel.getByRole("checkbox", { name: "I finished this" });
  await tick.check();
  await toast("Marked finished.");
  await tick.uncheck();
  await toast(/^(No longer marked finished|Unticked)\./);
  // Report a broken link: a small menu of fixed reasons, no note.
  await panel.getByRole("button", { name: "Link broken or out of date?" }).click();
  await panel.getByRole("group", { name: `Report ${savedTitle}` }).getByRole("button", { name: "Link is broken", exact: true }).click();
  await toast("Thanks. A reviewer will check this link.");
  libraryReported = savedTitle;
  // Add to my rides, on a resource of a goal that isn't on today's ride; then take it off again.
  let added = false;
  for (let k = 0, n = Math.min(await rows.count(), 24); k < n && !added; k++) {
    const name = (await rows.nth(k).innerText()).trim();
    await rows.nth(k).click();
    await panel.getByRole("heading", { name, exact: true, level: 3 }).waitFor({ timeout: 5000 });
    const add = panel.getByRole("button", { name: "Add to my rides", exact: true });
    if (!(await add.count())) continue;
    await add.click();
    await toast(/^Added/);
    await panel.getByRole("button", { name: "On your rides", exact: true }).waitFor({ timeout: 5000 });
    await panel.getByRole("button", { name: "Take it off my rides", exact: true }).click();
    await toast("Taken off your rides.");
    await panel.getByRole("button", { name: "Add to my rides", exact: true }).waitFor({ timeout: 5000 });
    added = true;
  }
  if (!added) throw new Error("no resource in the Library offers Add to my rides");
  // Suggest a free resource: an empty link moves focus back to the box, then a link goes for review.
  const suggest = p.getByRole("region", { name: "Suggest a free resource" });
  const box = suggest.getByRole("textbox", { name: "Link to a free resource" });
  await suggest.getByRole("button", { name: "Send for review" }).click();
  await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Link to a free resource", null, { timeout: 5000 });
  await box.fill(suggestedLink);
  await suggest.getByRole("button", { name: "Other", exact: true }).click();
  await suggest.getByRole("button", { name: "Send for review" }).click();
  await toast("Thanks. A reviewer will check it before it goes in the Library.");
  if (await box.inputValue()) throw new Error("the suggest box kept the sent link");
  await a11y("library-part-2");
  const search = p.getByRole("searchbox", { name: "Search the Library" });
  await search.fill("zzqx nothing like this");
  await main.getByText("Nothing matches. Try another word or clear a filter.").waitFor({ timeout: 5000 });
  await search.fill("");
  await cards.first().waitFor({ timeout: 5000 });
  const language = p.getByRole("group", { name: "Language" });
  await language.getByRole("button", { name: "Hindi", exact: true }).click();
  await language.getByRole("button", { name: "Hindi", pressed: true }).waitFor({ timeout: 5000 });
  await language.getByRole("button", { name: "Any language" }).click();
  const show = p.getByRole("group", { name: "Show" });
  await show.getByRole("button", { name: /^Finished/ }).click();
  await main.getByText(/^Nothing finished yet\.|^Ready to prove /).or(main.getByRole("region", { name: "Finished" })).first().waitFor({ timeout: 5000 });
  await a11y("library-finished");
  await show.getByRole("button", { name: /^Saved/ }).click();
  const savedList = main.getByRole("region", { name: "Saved", exact: true });
  await savedList.getByRole("button", { name: savedTitle, exact: true }).waitFor({ timeout: 5000 });
  await savedList.getByRole("button", { name: `Save ${savedTitle}`, exact: true }).click();
  await toast("Removed from saved.");
  await main.getByText("Nothing saved yet. Tap the bookmark on anything you want to come back to.").waitFor({ timeout: 5000 });
  await show.getByRole("button", { name: "Your interests" }).click();
  await main.getByText("From the interests on your profile.", { exact: false }).waitFor({ timeout: 5000 });
  await a11y("library-interests");
  await show.getByRole("button", { name: "Elite", exact: true }).click();
  const shelf = main.getByRole("region", { name: "Elite shelf", exact: true });
  const unlock = shelf.getByRole("link", { name: "Turn on Elite", exact: true });
  await unlock.waitFor({ timeout: 5000 });
  if ((await unlock.getAttribute("href")) !== "/elite") throw new Error("the shelf's Turn on Elite doesn't open /elite");
  if (!(await shelf.locator('[data-shelf-card="slot"]').count())) throw new Error("no Coming soon slot for paid courses");
  if (await shelf.locator("[data-shelf-card] a, [data-shelf-card] details").count()) throw new Error("a locked shelf card opens");
  await a11y("library-elite-free");
});
// Live Departures (docs/plans/departures-live-plan.md): a feed run and two posts seeded as the daily feed writes them.
// The header says Updated with the time; the walk's resume shows its fit; Save says "Saved."; Apply on company site
// opens the post in a new tab and asks "Did you apply?", and Yes starts the tracker. After a reload both lists still
// have the role. Once the role closes on its board it leaves All and stays in Saved with "Closed on the company's
// board". The other post stays open and unapplied, so the Express apply step later still finds Apply on company site.
await step("hardening: the Library's broken-link menu opens with Enter and closes with Escape", async () => {
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/library");
    await settled();
    const main = p.locator("main").first();
    await main.getByRole("heading", { name: "Library", level: 1 }).waitFor({ timeout: 10000 });
    await p.waitForLoadState("networkidle");
    const panel = p.getByRole("complementary", { name: "Resource details" });
    const toggle = panel.getByRole("button", { name: "Link broken or out of date?" });
    if (!(await toggle.count())) {
      const rows = main.locator("li button[aria-controls]");
      if (!(await rows.count())) throw new Error("the Library lists nothing to open");
      await rows.first().click();
      await toggle.waitFor({ timeout: 5000 });
    }
    await toggle.focus();
    await p.keyboard.press("Enter");
    const reasons = panel.getByRole("group", { name: /^Report / });
    await reasons.waitFor({ timeout: 5000 });
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.closest('[role="group"]')?.getAttribute("aria-label")?.startsWith("Report ") === true, null, { timeout: 5000 });
    await p.keyboard.press("Escape");
    await reasons.waitFor({ state: "detached", timeout: 5000 });
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Link broken or out of date?", null, { timeout: 5000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "false") throw new Error("the menu button still says it is open");
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
  }
});
await step("departures: live roles, Updated, save, apply on the company site, My jobs after a reload, a closed role", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to seed the feed");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const ROLE = "Junior data analyst (e2e)";
  try {
    await sql`insert into job_feed_runs (started_at, finished_at, boards_ok, posts_open) values (now(), now(), 1, 2)`;
    for (const [id, title, city] of [
      ["e2e-1", ROLE, "Pune"],
      ["e2e-2", "Reporting analyst (e2e)", "Remote"],
    ]) {
      await sql`
        insert into job_posts (ats, board_token, external_id, url, title, company, city, experience_note, role_slug, required_skill_ids, nice_skill_ids, posted_at)
        values ('greenhouse', 'e2e-example', ${id}, ${`https://example.com/jobs/${id}`}, ${title}, 'Example Labs', ${city}, '2 to 4 years', 'data-analyst',
          '{sql,excel,statistics}'::text[], '{tableau}'::text[], now())
        on conflict (ats, board_token, external_id) do update set closed_at = null, last_seen_at = now()`;
    }
    await sql`delete from job_saves where job_post_id in (select id from job_posts where board_token = 'e2e-example')`;
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/departures");
    await settled();
    await p.locator("[data-departures-clock]").getByText(/^Updated \d\d:\d\d · \d+ roles?$/).waitFor({ timeout: 10000 });
    if (await p.getByText(/Example roles for now/).count()) throw new Error("the example-data note still shows signed in");
    const row = p.getByRole("listitem").filter({ has: p.getByRole("button", { name: `${ROLE} at Example Labs` }) });
    await row.getByRole("button", { name: `${ROLE} at Example Labs` }).click();
    const detail = p.getByRole("complementary", { name: "Role details" });
    await detail.getByRole("heading", { name: ROLE }).waitFor({ timeout: 10000 });
    // Fit from the walk's resume, by the plain-code matcher: the post asks for SQL and Excel, which the resume shows.
    await detail.getByText(/^You have · [1-9]/).waitFor();
    await row.getByRole("button", { name: `Save ${ROLE}` }).click();
    await p.getByText("Saved.", { exact: true }).waitFor({ timeout: 10000 });
    const popup = p.waitForEvent("popup");
    await detail.getByRole("link", { name: "Apply on company site: Example Labs (opens in a new tab)" }).click();
    await (await popup).close();
    const ask = detail.getByRole("group", { name: "Did you apply?" });
    await ask.getByRole("button", { name: "Yes, I applied" }).click();
    await p.getByText("Marked as applied to Example Labs.", { exact: true }).waitFor({ timeout: 10000 });
    await detail.getByRole("heading", { name: "Your application" }).waitFor();
    await shot("departures-live");
    await a11y("departures-live");
    const [saved] = await sql`select s.stage, s.saved_at from job_saves s join job_posts j on j.id = s.job_post_id where j.external_id = 'e2e-1' and j.board_token = 'e2e-example'`;
    if (saved?.stage !== 1 || !saved.saved_at) throw new Error("the save and Applied were not kept");

    await p.reload();
    await settled();
    // Saved and Applied are one My jobs tab now (handoff 12m): the role is there as Applied, from a company job board.
    const tabs = p.getByRole("group", { name: "Show" });
    const mine = p.getByRole("region", { name: "My jobs" });
    const mineRow = mine.getByRole("listitem").filter({ hasText: ROLE });
    await tabs.getByRole("button", { name: /^My jobs/ }).click();
    await mineRow.getByRole("button", { name: /^Status: Applied/ }).waitFor({ timeout: 10000 });
    await mineRow.getByText("Company job board", { exact: true }).waitFor();

    // The role leaves its board: off All, still in My jobs with its status.
    await sql`update job_posts set closed_at = now() where board_token = 'e2e-example' and external_id = 'e2e-1'`;
    await p.reload();
    await settled();
    await p.getByRole("button", { name: "Reporting analyst (e2e) at Example Labs" }).waitFor({ timeout: 10000 });
    if (await row.count()) throw new Error("a closed role still shows on All");
    await tabs.getByRole("button", { name: /^My jobs/ }).click();
    await mineRow.getByText("Closed on the company's board", { exact: true }).waitFor({ timeout: 10000 });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    // Reload so every colour is drawn dark from the start, as on the other dark checks; the reload goes back to All.
    await p.reload();
    await settled();
    await tabs.getByRole("button", { name: /^My jobs/ }).click();
    await mineRow.getByText("Closed on the company's board", { exact: true }).waitFor({ timeout: 10000 });
    if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("Departures scrolls sideways at 390px (dark)");
    await a11y("departures-live-closed-phone-dark");
    await shot("departures-live-closed-phone-dark");
    await tabs.getByRole("button", { name: /^All/ }).click();
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await sql.end();
  }
});
// My jobs (docs/plans/application-tracker-plan.md, handoff 12m): "Add a job you found" with a pasted description and a
// link that is only kept, "Check these, then save" with the company and title the stand-in API read, Save to My jobs,
// the status menu, a private note in the edit sheet, the kept description under "Read the job again", and Delete.
await step("my jobs: add a job you found, save it, move its status, keep a note, read it again, delete it", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check what is kept");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const posting = JSON.parse(readFileSync(new URL("../fixtures/job-postings/example-analytics-data-analyst.json", import.meta.url), "utf8"));
  const NOTE = "Round 1 is a SQL test (e2e).";
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/departures?tab=mine");
    await settled();
    // Signing in claimed the resume, and the newest job checked before it (the stand-in posting) waits here, Saved.
    const claimed = p.getByRole("region", { name: "My jobs" }).getByRole("listitem").filter({ hasText: "Supply Chain Analyst" }).filter({ hasText: "Example Freight Pvt Ltd" });
    await claimed.getByRole("button", { name: /^Status: Saved/ }).waitFor({ timeout: 10000 });
    const box = p.getByRole("region", { name: "Add a job you found" });
    const link = box.getByLabel("Link to the job");
    await link.fill("https://jobs.lever.co/example/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69");
    await box.getByText("A company job board. We read the posting from there: nothing to paste.").waitFor({ timeout: 5000 });
    await link.fill("https://careers.example.com/data-analyst");
    await box.getByText(/^We keep this link to open the original\./).waitFor({ timeout: 5000 });
    await box.getByLabel("Job description").fill(posting.text);
    await box.getByRole("button", { name: "Add and check my gaps" }).click();
    const result = box.locator("[data-added-job]");
    await result.getByRole("heading", { name: "Check these, then save" }).waitFor({ timeout: 60000 });
    if ((await result.getByLabel(/^Company/).inputValue()) !== posting.company) throw new Error("the company read from the description isn't shown");
    if ((await result.getByLabel(/^Title/).inputValue()) !== posting.title) throw new Error("the title read from the description isn't shown");
    if ((await result.getByLabel(/^City/).inputValue()) !== posting.city) throw new Error("the city read from the description isn't shown");
    if (await result.getByText("Kubernetes").count()) throw new Error("a skill with an invented quote was kept");
    await a11y("my-jobs-added");
    await result.getByRole("button", { name: "Save to My jobs" }).click();
    const list = p.getByRole("region", { name: "My jobs" });
    const row = list.getByRole("listitem").filter({ hasText: posting.title }).filter({ hasText: posting.company });
    await row.getByText("You added", { exact: true }).waitFor({ timeout: 10000 });
    await row.getByRole("link", { name: /^Open the original/ }).waitFor();

    await row.getByRole("button", { name: /^Status: Saved/ }).click();
    await row.getByRole("menu").getByRole("menuitemradio", { name: /^Applied/ }).click();
    await row.getByRole("button", { name: /^Status: Applied/ }).waitFor({ timeout: 10000 });
    await row.getByRole("button", { name: `Edit ${posting.title} at ${posting.company}` }).click();
    const sheet = p.getByRole("dialog", { name: posting.title });
    await sheet.getByLabel("Private note").fill(NOTE);
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await p.getByText("Saved. Only you see it.", { exact: true }).waitFor({ timeout: 10000 });
    await row.getByText(NOTE).waitFor();
    await shot("my-jobs");
    await a11y("my-jobs");

    // An interview date three India days out moves Applied to Interview, and Today counts down to it (handoff 12m).
    const inThree = new Date(Date.now() + 5.5 * 3600_000 + 3 * 86_400_000).toISOString().slice(0, 10);
    await row.getByRole("button", { name: `Edit ${posting.title} at ${posting.company}` }).click();
    await sheet.getByLabel("Interview · date and time, IST").fill(`${inThree}T10:30`);
    await sheet.getByRole("button", { name: /^Add to calendar/ }).waitFor({ timeout: 5000 });
    await a11y("my-jobs-edit-sheet-interview");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await row.getByRole("button", { name: /^Status: Interview/ }).waitFor({ timeout: 10000 });
    await row.getByText(/, 10:30$/).first().waitFor({ timeout: 10000 });
    const [kept0] = await sql`select s.stage, s.interview_at from job_saves s where s.note = ${NOTE}`;
    if (kept0?.stage !== 3 || new Date(kept0.interview_at).toISOString() !== new Date(`${inThree}T10:30:00+05:30`).toISOString())
      throw new Error("the interview date or the Interview status was not kept");
    await p.goto(BASE + "/today");
    await settled();
    const card = p.getByRole("region", { name: "Next interview" });
    await card.getByRole("heading", { name: "Interview in 3 days" }).waitFor({ timeout: 15000 });
    await card.getByText(posting.company, { exact: false }).first().waitFor();
    await a11y("today-next-interview");
    await shot("today-next-interview");
    await p.goto(BASE + "/departures?tab=mine");
    await settled();

    const [kept] = await sql`
      select s.stage, s.note, s.applied_at, c.url, c.source, c.city, c.description
      from job_saves s join job_checks c on c.id = s.job_check_id where s.note = ${NOTE}`;
    if (kept?.stage !== 3 || !kept.applied_at || kept.url !== "https://careers.example.com/data-analyst" || kept.source !== "pasted" || kept.city !== "Pune")
      throw new Error("the added job's status, link or city were not kept");
    if (!kept.description?.includes("Example Analytics Pvt Ltd helps retail brands")) throw new Error("the person's copy of the description was not kept");

    // After a reload, ?tab=mine opens on My jobs, with the note; "Read the job again" shows the person's own copy.
    await p.reload();
    await settled();
    await row.getByText(NOTE).waitFor({ timeout: 10000 });

    // Prepare for this job: Practice opens on this job's skills, and the mock link carries the job in the address.
    await row.getByRole("button", { name: "Prepare for this job" }).click();
    const prepare = row.getByRole("menu", { name: `Prepare for ${posting.title}` });
    const mockHref = await prepare.getByRole("menuitem", { name: /^Mock interview for this job/ }).getAttribute("href");
    if (!/^\/mock\?tab=interview&job=check%3A[0-9a-f-]{36}$/.test(mockHref ?? "")) throw new Error("the mock interview link doesn't name the job");
    await a11y("my-jobs-prepare-menu");
    await prepare.getByRole("menuitem", { name: /^Practice on this job's skills/ }).click();
    await p.getByText(`For one job: ${posting.company}, ${posting.title}.`, { exact: false }).waitFor({ timeout: 15000 });
    await settled();
    await a11y("practice-for-a-job");
    await shot("practice-for-a-job");
    await p.goto(BASE + "/departures?tab=mine");
    await settled();
    await row.getByText(NOTE).waitFor({ timeout: 10000 });

    await row.getByRole("button", { name: `Edit ${posting.title} at ${posting.company}` }).click();
    await sheet.getByText("Read the job again").click();
    await sheet.getByText(/Example Analytics Pvt Ltd helps retail brands/).waitFor({ timeout: 10000 });
    await a11y("my-jobs-edit-sheet");
    await shot("my-jobs-edit-sheet");
    await sheet.getByRole("button", { name: "Delete this job" }).click();
    await p.getByText("Deleted. Nothing is kept.", { exact: true }).waitFor({ timeout: 10000 });
    if (await row.count()) throw new Error("a deleted job still shows in My jobs");
    if ((await sql`select 1 from job_checks where description like ${"%" + "helps retail brands" + "%"} and id in (select job_check_id from job_saves)`).length)
      throw new Error("a deleted job's description is still kept");

    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.reload();
    await settled();
    await list.waitFor({ timeout: 10000 });
    if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("My jobs scrolls sideways at 390px (dark)");
    await a11y("my-jobs-phone-dark");
    await shot("my-jobs-phone-dark");
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await sql.end();
  }
});
// Share from the phone (C21, docs/plans/application-tracker-plan.md section 5): the share sheet posts a form to /share,
// which holds it and sends the person to My jobs with "Add a job you found" filled under the banner; the check runs at
// once and nothing is kept until Save. The hold opens once. A GET is refused. Settings explains Android and iPhone.
await step("share from the phone: the shared job fills the add box, checks at once, opens once; Settings shows how", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check what is kept");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const posting = JSON.parse(readFileSync(new URL("../fixtures/job-postings/example-analytics-data-analyst.json", import.meta.url), "utf8"));
  try {
    const get = await p.request.get(BASE + "/share", { maxRedirects: 0 });
    if (get.status() !== 405) throw new Error(`GET /share answered ${get.status()}, not 405`);
    await p.goto(BASE + "/today");
    await settled();
    // What Android's share sheet does: a form POST to the manifest's share_target.
    await Promise.all([
      p.waitForURL(/\/departures\?tab=mine/, { timeout: 15000 }),
      p.evaluate(
        ({ text, url }) => {
          const form = Object.assign(document.createElement("form"), { method: "post", action: "/share" });
          for (const [name, value] of Object.entries({ title: "", text, url })) form.append(Object.assign(document.createElement("input"), { type: "hidden", name, value }));
          document.body.append(form);
          form.submit();
        },
        { text: posting.text, url: "https://careers.example.com/data-analyst" },
      ),
    ]);
    const box = p.getByRole("region", { name: "Add a job you found" });
    await box.getByText("Shared from your phone.", { exact: false }).waitFor({ timeout: 15000 });
    if (!(await box.getByLabel("Job description").inputValue()).includes("Example Analytics Pvt Ltd helps retail brands")) throw new Error("the shared text didn't fill the box");
    if ((await box.getByLabel("Link to the job").inputValue()) !== "https://careers.example.com/data-analyst") throw new Error("the shared link didn't fill the box");
    if (p.url().includes("shared=")) throw new Error("the hold's id stayed in the address");
    await box.locator("[data-added-job]").getByRole("heading", { name: "Check these, then save" }).waitFor({ timeout: 60000 });
    await a11y("my-jobs-shared");
    await shot("my-jobs-shared");
    const [{ n }] = await sql`select count(*)::int as n from shared_job_holds`;
    if (n !== 0) throw new Error("the hold was kept after it was opened");
    await box.getByRole("button", { name: "Clear" }).click();
    if (await box.getByText("Shared from your phone.", { exact: false }).count()) throw new Error("Clear left the banner");
    if (await box.getByLabel("Job description").inputValue()) throw new Error("Clear left the shared text");

    // A hold opens once: the same address again says it has gone.
    await sql`insert into shared_job_holds (id, text) values ('6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', 'old share (e2e)')`;
    await sql`update shared_job_holds set created_at = now() - interval '2 hours' where id = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'`;
    await p.goto(BASE + "/departures?tab=mine&shared=6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    await box.getByText(/^That shared job has gone/).waitFor({ timeout: 15000 });
    await sql`delete from shared_job_holds where id = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'`;

    await p.goto(BASE + "/settings#acc-share");
    await settled();
    const share = p.getByRole("region", { name: "Add from your phone" });
    await share.getByText("We never read your clipboard or other apps on our own.", { exact: false }).waitFor({ timeout: 10000 });
    await share.getByText("copy, then paste").waitFor();
    await a11y("settings-add-from-phone");
  } finally {
    await sql.end();
  }
});
// The weekly My jobs email (C22, docs/plans/application-tracker-plan.md section 6): Settings shows the switch with its
// words and "See this week's", which sends nothing. The email's "Turn it off" needs no sign-in: opening the link
// changes nothing, the button turns it off and replaces the token, and an unknown token gets the same page.
await step("weekly My jobs email: Settings preview, and the one-tap turn-off without sign-in", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check what is kept");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const TOKEN = "e2eWeeklyOffToken".padEnd(43, "x");
  let madeFor = null;
  try {
    await p.goto(BASE + "/settings#acc-notif");
    await settled();
    const notif = p.getByRole("region", { name: "Notifications" });
    // The switch's words and its hint share one label, so the check box is found by the label's start.
    await notif.getByRole("checkbox", { name: /^Weekly My jobs email/ }).waitFor({ state: "attached", timeout: 10000 });
    await notif.getByText(/^Mondays at 8:00 IST: jobs waiting on a reply/).waitFor();
    await notif.getByRole("button", { name: "See this week's" }).click();
    await notif.getByText(/Nothing is moving this week|your week on My jobs\./).first().waitFor({ timeout: 5000 });
    await a11y("settings-weekly-preview");
    await shot("settings-weekly-preview");

    const [me] = await sql`select id from users where email like ${testEmail + "%"} order by created_at desc limit 1`;
    // A row made here takes the table's defaults, not the app's (later steps check a new user's defaults), so it goes again.
    const [had] = await sql`select 1 as one from user_settings where user_id = ${me.id}`;
    madeFor = had ? null : me.id;
    await sql`insert into user_settings (user_id, email_weekly_summary, email_off_token) values (${me.id}, true, ${TOKEN})
      on conflict (user_id) do update set email_weekly_summary = true, email_off_token = ${TOKEN}`;
    // Signed out, as from a mail app: a fresh browser context with no cookies.
    const mail = await b.newContext({ viewport: { width: 390, height: 844 } });
    const q = await mail.newPage();
    try {
      await q.goto(`${BASE}/api/email/off?t=${TOKEN}`);
      await q.getByRole("heading", { name: "Turn off the weekly My jobs email?" }).waitFor({ timeout: 10000 });
      const [still] = await sql`select email_weekly_summary as on from user_settings where user_id = ${me.id}`;
      if (!still.on) throw new Error("opening the link turned the email off");
      await a11yOn(q, "email-off");
      await q.getByRole("button", { name: "Turn it off" }).click();
      await q.getByRole("heading", { name: "The weekly My jobs email is off" }).waitFor({ timeout: 10000 });
      const [after] = await sql`select email_weekly_summary as on, email_off_token as token from user_settings where user_id = ${me.id}`;
      if (after.on || after.token === TOKEN) throw new Error("the button didn't turn the email off and replace the token");
      // An unknown token gets the same page.
      await q.goto(`${BASE}/api/email/off?t=${"n".repeat(43)}`);
      await q.getByRole("heading", { name: "Turn off the weekly My jobs email?" }).waitFor({ timeout: 10000 });
    } finally {
      await mail.close();
    }
  } finally {
    if (madeFor) await sql`delete from user_settings where user_id = ${madeFor}`;
    await sql.end();
  }
});
// Job search switch and notice period (docs/plans/job-search-plan.md, handoff 6). "Looking for a job" off on Departures
// shows the off card and the toast, keeps focus on the switch and is saved; Today shows its card in the board's place;
// Me says "Working at" the resume's current employer; Arrivals is paused too, and its Turn on job search brings it back.
// Then the private notice card on Arrivals: 60 days, I have resigned 10 days ago, Start countdown shows 50 days left and
// the last working day, the download has it, and Stop the countdown clears the date (so later applying isn't prefilled).
await step("job search: off pauses Departures, Arrivals and Today's board, back on, then the notice countdown", async () => {
  await p.goto(BASE + "/departures");
  await settled();
  const sw = p.getByRole("checkbox", { name: "Looking for a job", exact: true });
  await sw.waitFor({ state: "attached", timeout: 10000 });
  if (!(await sw.isChecked())) throw new Error("job search starts off");
  // A click, not uncheck(): the switch pressed goes away with the page it was on, and the paused page's switch takes focus.
  await sw.click({ force: true });
  const off = p.getByRole("region", { name: "Job search is off" });
  await off.getByText(/Departures and Arrivals are paused: no Express apply, and companies can.t find you/).waitFor({ timeout: 10000 });
  await p.getByText("Job search is off. Your rides and map keep going.", { exact: true }).waitFor({ timeout: 10000 });
  await p.waitForFunction(() => document.activeElement?.closest("[data-job-search]") != null, null, { timeout: 5000 });
  if (await p.getByRole("searchbox", { name: "Search roles" }).count()) throw new Error("Departures lists roles with job search off");
  await shot("departures-search-off");
  await a11y("departures-search-off");
  await p.reload();
  await settled();
  await off.waitFor({ timeout: 10000 });
  await p.goto(BASE + "/today");
  await settled();
  await p.getByRole("region", { name: "Job search is off" }).getByText(/Your ride keeps going/).waitFor({ timeout: 10000 });
  if (await p.locator("[data-board]").count()) throw new Error("Today shows the Departures board with job search off");
  await a11y("today-search-off");
  await p.goto(BASE + "/me");
  await settled();
  await p.getByText("Working at Example Retail Pvt Ltd", { exact: true }).waitFor({ timeout: 10000 });
  await p.goto(BASE + "/arrivals");
  await settled();
  const paused = p.getByRole("region", { name: "Job search is off" });
  await paused.waitFor({ timeout: 10000 });
  if (await p.getByRole("region", { name: "Notice period" }).count()) throw new Error("Arrivals shows the notice card with job search off");
  await paused.getByRole("button", { name: "Turn on job search" }).click();
  await p.getByText("Job search is on. Departures and Arrivals are back.", { exact: true }).waitFor({ timeout: 10000 });
  await p.waitForFunction(() => document.activeElement?.closest("[data-job-search]") != null, null, { timeout: 5000 });

  const notice = p.getByRole("region", { name: "Notice period" });
  await notice.getByText("only you see this", { exact: true }).waitFor({ timeout: 10000 });
  await notice.getByRole("button", { name: "60 days" }).click();
  await notice.getByRole("button", { name: "60 days", pressed: true }).waitFor();
  // The days save at once; while that runs the card's buttons are aria-disabled and ignore presses.
  const ready = (name) => notice.locator("button:not([aria-disabled])", { hasText: name });
  await ready("I have resigned").waitFor({ timeout: 10000 });
  await notice.getByRole("button", { name: "I have resigned" }).click();
  await p.waitForFunction(() => document.activeElement?.getAttribute("type") === "date", null, { timeout: 5000 });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const resigned = new Date(Date.parse(`${today}T00:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
  await notice.getByLabel("When did you hand in your resignation?").fill(resigned);
  await ready("Start countdown").waitFor({ timeout: 10000 });
  await notice.getByRole("button", { name: "Start countdown" }).click();
  await notice.getByText("days left", { exact: true }).waitFor({ timeout: 10000 });
  await notice.getByText("50", { exact: true }).waitFor();
  await notice.getByText(/^Last working day: /).waitFor();
  await notice.getByText(/^Free to join from /).waitFor();
  await notice.getByRole("progressbar", { name: "Notice period served" }).waitFor();
  await shot("arrivals-notice-countdown");
  await a11y("arrivals-notice-countdown");
  await p.reload();
  await settled();
  await notice.getByText(/^Last working day: /).waitFor({ timeout: 10000 });
  const data = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  const js = data.jobSearch;
  if (data.exportVersion !== 36 || js?.lookingForAJob !== true || js?.noticeDays !== 60 || js?.resignedOn !== resigned) throw new Error("the download lacks the job search values");
  await ready("Change").waitFor({ timeout: 10000 });
  await notice.getByRole("button", { name: "Change", exact: true }).click();
  await ready("Stop the countdown").waitFor({ timeout: 10000 });
  await notice.getByRole("button", { name: "Stop the countdown" }).click();
  await notice.getByRole("button", { name: "I have resigned" }).waitFor({ timeout: 10000 });
});
// The current job checked by work email (FR-47, dev/current-job-check-plan.md). The walk's resume is a Data Analyst at
// Example Retail Pvt Ltd since 2022-06. No verified company owns exampleretail.test, so a right code goes to an admin
// (T53): the owner sees it's being checked, everyone else sees Not verified.
await step("current job: free mail is refused, a code to the work email waits for review, and others see Not verified", async () => {
  await p.goto(BASE + "/me");
  await settled();
  await p.getByText("Not verified", { exact: true }).first().waitFor({ timeout: 10000 });
  await p.getByText("Verify with your work email").click();
  await p.getByLabel("Work email").fill("priya.sharma@gmail.com");
  await p.getByRole("button", { name: "Send code" }).click();
  await p.getByRole("alert").getByText(/Personal addresses like Gmail/).waitFor({ timeout: 10000 });
  await p.getByLabel("Work email").fill(`priya.sharma@mail${Date.now()}.exampleretail.test`);
  await p.getByRole("button", { name: "Send code" }).click();
  const box = p.locator("[data-test-code]");
  await box.waitFor({ timeout: 10000 });
  await p.getByLabel("Code", { exact: true }).fill(await box.getAttribute("data-test-code"));
  await p.getByRole("button", { name: "Confirm" }).click();
  await p.getByText("Work email received · we're checking the domain", { exact: true }).first().waitFor({ timeout: 15000 });
  if (await p.getByText("Verify with your work email").count()) throw new Error("the form stays after the code was confirmed");
  if (await p.getByText(/^Verified with work email/).count()) throw new Error("a domain no verified company owns got the badge");
  await p.getByRole("button", { name: "View as others" }).click();
  await p.getByText("You are seeing your profile the way other people will", { exact: false }).waitFor();
  if (await p.getByText(/checking the domain|^Verified with work email/).count()) throw new Error("others see more than Not verified");
  const data = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  const check = data.jobEmailChecks?.[0];
  if (check?.status !== "review" || JSON.stringify(data.jobEmailChecks).includes("priya.sharma@")) throw new Error("download lacks the check, or has the address");
  await a11y("me-job-check");
});
// Nearby lines (dev/nearby-lines-plan.md). The walk's resume shares under half the key skills of every other role, so
// Me shows the plain empty state with the closest role's real counts (pinned in src/lib/nearby/build.test.ts).
await step("nearby lines: the walk's resume gets the plain empty state with the closest role's counts", async () => {
  await p.goto(BASE + "/me");
  await settled();
  const section = p.getByRole("region", { name: "Nearby lines" });
  await section.getByText(NEARBY_WALK_EMPTY, { exact: true }).waitFor({ timeout: 10000 });
  if (await section.locator("li").count()) throw new Error("the walk's resume should have no Nearby line");
  // Looking changes no goal: the Map still has the same goals.
  await p.goto(BASE + "/map");
  await settled();
  await p.getByRole("region", { name: "Nearby lines" }).getByText(NEARBY_WALK_EMPTY, { exact: true }).waitFor({ timeout: 10000 });
  if (await p.locator("g[data-crossing]").evaluateAll((gs) => gs.some((g) => g.getAttribute("aria-label").includes("nearby")))) throw new Error("an interchange without a Nearby line");
});
// A second person, switching from analytics to Data Scientist: a synthetic eval persona (the mock parse returns its
// profile), uploaded as a Word file made here. Me lists the Nearby lines with the counts the unit test pins; the Map
// draws the interchange, reachable by keyboard, with axe passing in light and dark at phone width.
await step("nearby lines: a switcher sees them on Me and as an interchange on the Map", async () => {
  const persona = JSON.parse(readFileSync(new URL("../fixtures/evals/data-scientist-analyst-upskilling.json", import.meta.url), "utf8"));
  const { Document, Packer, Paragraph } = await import("docx");
  const doc = new Document({ sections: [{ children: persona.resumeText.split("\n").map((t) => new Paragraph(t)) }] });
  const dir = new URL("./results/", import.meta.url).pathname;
  const file = `${dir}nearby-switcher.docx`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, await Packer.toBuffer(doc));
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctx2.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  const qSettled = () => q.getByText(/Comparing your resume|Building your path|Loading…/).first().waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
  try {
    await q.goto(BASE + "/today");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill(persona.resumeText.split("|")[0].trim());
    await q.locator('input[name="email"]').fill(`nearby-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/sign-up\/finish/, { timeout: 15000 });
    await q.locator('input[name="age"]').check();
    await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
    await q.waitForURL(/\/today/, { timeout: 15000 });
    await q.goto(BASE + "/start");
    await q.locator('input[type="file"]').setInputFiles(file);
    for (const c of await q.locator('input[type="checkbox"]').all()) await c.check().catch(() => {});
    await q.locator('button[type="submit"]').click();
    await q.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: 30000 });
    await q.getByRole("button", { name: "Looks right", exact: true }).click();
    const next = q.locator('main a[href$="/role"]').first();
    await next.waitFor({ timeout: 15000 });
    await next.click();
    await q.waitForURL(/\/role/, { timeout: 15000 });
    await q.locator('a[href$="/gaps/data-scientist"]').first().click();
    await q.waitForURL(/\/gaps\//, { timeout: 60000 });
    await qSettled();

    // Me: the lines and their counts, in order.
    await q.goto(BASE + "/me");
    await qSettled();
    const section = q.getByRole("region", { name: "Nearby lines" });
    await section.locator("li").first().waitFor({ timeout: 10000 });
    const shown = await section.locator("li").evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent ?? ""));
    const want = NEARBY_WALK_SWITCHER.map(([title, shared, total]) => `${title} shares ${shared} of its ${total} key skills with you.`);
    if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`Me shows ${JSON.stringify(shown)}, expected ${JSON.stringify(want)}`);
    await section.getByText("On your resume, not yet shown in work: Data visualization").waitFor();
    await section.getByRole("link", { name: "Change your target role" }).waitFor();
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-me-nearby.png`, fullPage: true });
    await a11yOn(q, "me-nearby");

    // Map: the interchange is reached with Tab alone and opens its panel with Enter; it never moves the train.
    await q.goto(BASE + "/map");
    await qSettled();
    const trainBefore = await q.locator('g[aria-label="You are here"]').getAttribute("transform");
    const crossing = q.locator('g[data-crossing="senior-data-scientist"]');
    const label = await crossing.getAttribute("aria-label");
    if (!label?.startsWith("Senior Data Scientist line · nearby, interchange at Pitstop") || !label.includes("Shares 5 of its 7 key skills")) throw new Error(`interchange label: ${label}`);
    let reached = false;
    for (let t = 0; t < 120 && !reached; t++) {
      await q.keyboard.press("Tab");
      reached = await q.evaluate(() => document.activeElement?.getAttribute("data-crossing") === "senior-data-scientist");
    }
    if (!reached) throw new Error("the interchange can't be reached with Tab");
    await q.keyboard.press("Enter");
    const panel = q.getByRole("complementary", { name: "Pitstop details" });
    await panel.getByText("Nearby line · interchange").waitFor({ timeout: 5000 });
    await panel.getByText("Senior Data Scientist shares 5 of its 7 key skills with you.", { exact: false }).waitFor();
    if ((await q.locator('g[aria-label="You are here"]').getAttribute("transform")) !== trainBefore) throw new Error("the interchange moved the train");
    // The text list under the map says the same, and its button takes keyboard focus to the interchange.
    const list = q.getByRole("region", { name: "Nearby lines" });
    await list.getByText(/Shares 4 of its 7 key skills · no interchange on your line/).waitFor();
    await list.getByRole("button", { name: /^Show on map\s*:\s*Senior Data Scientist line$/ }).focus();
    await q.keyboard.press("Enter");
    await q.waitForFunction(() => document.activeElement?.getAttribute("data-crossing") === "senior-data-scientist", null, { timeout: 5000 });
    await a11yOn(q, "map-nearby");
    // Phone width, light then dark: no sideways page scroll and axe passes.
    await q.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ["light", "dark"]) {
      await q.emulateMedia({ colorScheme: scheme });
      await q.reload();
      await qSettled();
      await q.locator('g[data-crossing="senior-data-scientist"]').waitFor();
      if (await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`map scrolls sideways at 390px (${scheme})`);
      await a11yOn(q, `map-nearby-phone-${scheme}`);
      await q.goto(BASE + "/me");
      await qSettled();
      if (await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`Me scrolls sideways at 390px (${scheme})`);
      await a11yOn(q, `me-nearby-phone-${scheme}`);
      await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-me-nearby-phone-${scheme}.png`, fullPage: true });
      await q.goto(BASE + "/map");
      await qSettled();
      await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-map-nearby-phone-${scheme}.png`, fullPage: true });
    }
  } finally {
    await ctx2.close();
  }
});
// Market (handoff C6, dev/market-plan.md, docs/plans/market-trends-plan.md): from the top nav. Signed in it reads live
// counts: no EXAMPLE DATA label and no pay figure anywhere, the header names the boards, the day and the undercount
// note, each card names its source, the pay card says "Pay comes later" and the trend says when counting began. CI's
// database has few or no posts, so most figures read "Not enough data", which is what the checks below rely on.
// Search a city and a role (Enter takes the first match); open a state from the map; a thin state says "Not enough
// data" instead of figures; Market is in the avatar menu; axe passes in light and dark, with no sideways scroll at 360px.
const LIVE_HEADLINE = /^Open roles on public company job boards \(Greenhouse, Lever, Ashby, SmartRecruiters\)/;
const marketIsLive = async () => {
  const main = p.locator("main");
  if (await main.getByText("The live counts can't be read right now.").count()) throw new Error("the Market couldn't read its live counts");
  await main.getByText(LIVE_HEADLINE).first().waitFor();
  const text = await main.innerText();
  if (/EXAMPLE DATA|Example data|made up to show the design/i.test(text)) throw new Error("the live Market says example data");
  if (/₹|lakh/i.test(text) || /\d(\.\d)?\s?L\b/.test(text)) throw new Error("the live Market shows a pay figure");
  if (await main.getByRole("link", { name: "Median pay" }).count()) throw new Error("the live Market offers the Median pay map");
  await main.getByText(/undercount the market/).first().waitFor();
  // Map, trend, top cities and compare each name the boards and a day or month; pay says it has no source yet.
  const sources = await main.locator("p").filter({ hasText: /^Source: (Open on|New each month on) public company job boards \(.*\) · ((\d{1,2} [A-Z][a-z]{2} \d{4})|(counting since [A-Z][a-z]{2} \d{4})|not read yet|not counted yet)$/ }).count();
  if (sources < 4) throw new Error(`only ${sources} cards name the job boards with a day or month`);
  await main.locator("p").filter({ hasText: /^Source: none yet$/ }).first().waitFor();
  await main.getByText("Pay comes later: company job boards in India rarely state pay.").first().waitFor();
  // Until the trend has 12 months it says when counting began and when the trend shows (a database with a year of
  // rollups gets the floor instead).
  await main
    .getByText(/Counting since [A-Z][a-z]{2} \d{4}; the trend shows from [A-Z][a-z]{2} \d{4}\.|Counting hasn't started yet; the trend shows 13 months after it starts\.|A trend needs at least 15 new roles/)
    .first()
    .waitFor();
};
await step("market: live counts, no example label or pay, search, open a state, a thin one says Not enough data", async () => {
  await p.goto(BASE + "/today");
  await settled();
  await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Market" }).click();
  await p.waitForURL(/\/market/, { timeout: 15000 });
  await settled();
  await p.getByRole("heading", { name: "Market", level: 1 }).waitFor();
  await marketIsLive();
  // The walk's target role is Data Analyst, so the Market opens on it.
  await p.getByRole("heading", { name: "India · Data Analyst" }).waitFor();
  const box = p.getByRole("combobox", { name: "Search a role, state or city" });
  await box.fill("pune");
  await p.getByRole("listbox", { name: "Matches" }).getByRole("option", { name: /^Pune/ }).click();
  await p.waitForURL(/place=MH%3APune/, { timeout: 15000 });
  await p.getByRole("heading", { name: "Pune · Data Analyst" }).waitFor();
  await box.fill("machine learn");
  await box.press("Enter");
  await p.waitForURL(/role=ml-engineer/, { timeout: 15000 });
  await p.getByRole("heading", { name: "Pune · Machine Learning Engineer" }).waitFor();
  // A state from the map: its panel names top roles and cities.
  await p.locator('main a[data-state="KA"]').click();
  await p.waitForURL(/place=KA&/, { timeout: 15000 });
  await p.getByRole("heading", { name: "Karnataka · Machine Learning Engineer" }).waitFor();
  await p.getByRole("heading", { name: "Top roles in Karnataka" }).waitFor();
  // A thin state: no figures, "Not enough data" on the tile, in the panel and on the cards.
  const mz = p.locator('main a[data-state="MZ"]');
  if (!(await mz.textContent()).includes("Mizoram: Not enough data")) throw new Error("the Mizoram tile should say Not enough data");
  await mz.focus();
  await p.keyboard.press("Enter");
  await p.waitForURL(/place=MZ&/, { timeout: 15000 });
  const panel = p.getByRole("heading", { name: "Mizoram · Machine Learning Engineer" });
  await panel.waitFor();
  await p.locator("main").getByText("Not enough data.").first().waitFor();
  if (await p.locator("main").getByText(/^(openings a month|open now)$/).count()) throw new Error("a thin place shows a figure");
  await shot("market");
  // "Show all of India" goes away once India shows, so focus lands on the panel's heading, never the page.
  await p.getByRole("link", { name: "Show all of India" }).focus();
  await p.keyboard.press("Enter");
  await p.waitForURL(/place=IN&/, { timeout: 15000 });
  await p.waitForFunction(() => document.activeElement?.textContent === "India · Machine Learning Engineer", null, { timeout: 10000 });
  // "Skip the map" takes keyboard users past the 36 squares to the same heading.
  const skip = p.getByRole("link", { name: "Skip the map" });
  await skip.focus();
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.activeElement?.textContent === "India · Machine Learning Engineer", null, { timeout: 5000 });
  // The Place select: pick Karnataka, go back to India, and picking Karnataka again still goes there.
  const placeSelect = p.getByLabel("Place", { exact: true });
  for (const round of [1, 2]) {
    await placeSelect.selectOption("KA");
    await p.waitForURL(/place=KA&/, { timeout: 15000 }).catch(() => {
      throw new Error(`picking Karnataka in the Place select (round ${round}) didn't open it`);
    });
    await p.getByRole("heading", { name: "Karnataka · Machine Learning Engineer" }).waitFor();
    if (round === 1) {
      await p.getByRole("link", { name: "Show all of India" }).click();
      await p.waitForURL(/place=IN&/, { timeout: 15000 });
      await p.getByRole("heading", { name: "India · Machine Learning Engineer" }).waitFor();
    }
  }
  // Back to the thin state for the checks below.
  await p.locator('main a[data-state="MZ"]').click();
  await p.waitForURL(/place=MZ&/, { timeout: 15000 });
  await panel.waitFor();
  await a11y("market");
  // The avatar menu leads here too.
  await p.locator("header button[aria-expanded]").last().click();
  await p.locator("header ul").getByRole("link", { name: "Market" }).waitFor();
  await p.keyboard.press("Escape");
  // Phone width, light then dark: no sideways scroll, and axe passes.
  await p.setViewportSize({ width: 360, height: 800 });
  for (const scheme of ["light", "dark"]) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.reload();
    await settled();
    await marketIsLive();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`market scrolls sideways at 360px (${scheme}) by ${overflow}px`);
    await shot(`market-phone-${scheme}`);
    await a11y(`market-phone-${scheme}`);
  }
  await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize({ width: 1280, height: 900 });
});
await step("unknown address shows the not-found page", async () => {
  const r = await p.goto(BASE + expected404);
  if (r.status() !== 404) throw new Error("status " + r.status());
  await p.getByRole("heading", { name: "We can't find that page" }).waitFor({ timeout: 5000 });
  await p.getByRole("link", { name: "Go to the home page" }).waitFor({ timeout: 5000 });
  await a11y("not-found");
});
await step("account settings: name is locked, download works", async () => {
  await p.goto(BASE + "/today");
  await settled();
  await p.getByRole("button", { name: /open menu$/ }).click();
  await p.getByRole("link", { name: "Account settings" }).click();
  await p.waitForURL(/\/settings/);
  await settled();
  await shot("settings");
  await a11y("settings");
  // Once the account has a name it can't be edited (Milin, 2026-10-12): corrections go through a request to us.
  if (!(await p.getByLabel("First name").isDisabled()) || !(await p.getByLabel("Last name").isDisabled())) throw new Error("name is still editable");
  await p.getByRole("link", { name: "Grievances page" }).waitFor({ timeout: 5000 });
  const lastName = await p.getByLabel("Last name").inputValue();
  const res = await p.request.get(BASE + "/api/account/export");
  if (!res.ok()) throw new Error("download status " + res.status());
  const data = await res.json();
  if ((data.account?.lastName ?? "") !== lastName || !data.resumes?.length) throw new Error("download is missing data");
});
// Account settings part 2 (dev/account-settings-plan.md): a username with its availability check, a headline, private
// pay and privacy are saved together; the download carries them; the profile link shows the name and headline but never
// pay, the email or a resume line; another signed-in person sees it while it is open to everyone signed in, and gets
// the not-found page once it is Only you; the old link redirects after a change is refused inside 30 days.
await step("account settings part 2: username, privacy and pay saved, never on the public profile", async () => {
  const handle = `e2e-${Date.now().toString(36)}`;
  await p.goto(BASE + "/settings");
  await settled();
  // Nothing is set yet: no link, and a new user's profile starts at Your connections (FR-49, rulings 3 and 4).
  if (!(await p.locator('input[name="acc-visibility"][value="connections"]').isChecked())) throw new Error("profile visibility does not start at Your connections");
  const username = p.getByLabel("Username");
  await username.fill("admin");
  await p.getByText("That one is reserved. Try another.").waitFor({ timeout: 5000 });
  await username.fill(handle.toUpperCase());
  if ((await username.inputValue()) !== handle) throw new Error("username is not lowercased as typed");
  await p.getByText(/^Available\. After you save/).waitFor({ timeout: 10000 });
  await p.getByLabel(/^Headline/).fill("Data work, moving into analytics");
  await p.getByLabel(/^Current pay/).fill("4.2");
  await p.getByLabel(/^Expected pay/).fill("6");
  await p.getByLabel("Everyone signed in").check({ force: true });
  await p.getByText("You have unsaved changes.").waitFor();
  await shot("settings-part2-dirty");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("You have unsaved changes.").waitFor({ state: "detached", timeout: 15000 });
  // Focus isn't lost with the bar: it moves to the status line that says the save worked.
  await p.waitForFunction(() => document.activeElement?.getAttribute("role") === "status" && document.activeElement.textContent === "Settings saved.", null, { timeout: 5000 });
  // Discard puts back what's saved, and focus goes to the status line too.
  await p.getByLabel(/^Headline/).fill("Something else");
  await p.getByRole("button", { name: "Discard" }).click();
  await p.waitForFunction(() => document.activeElement?.textContent === "Changes discarded.", null, { timeout: 5000 });
  if ((await p.getByLabel(/^Headline/).inputValue()) !== "Data work, moving into analytics") throw new Error("Discard did not restore the headline");
  // A refused save moves focus to the field with the message.
  await p.getByLabel(/^Current pay/).fill("4.255");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.waitForFunction(() => document.activeElement?.id === "acc-currentPay", null, { timeout: 10000 });
  await p.getByRole("button", { name: "Discard" }).click();
  await p.reload();
  await settled();
  if ((await p.getByLabel("Username").inputValue()) !== handle) throw new Error("username did not save");
  if ((await p.getByLabel(/^Current pay/).inputValue()) !== "4.2") throw new Error("pay did not save");
  if (!(await p.getByLabel("Everyone signed in").isChecked())) throw new Error("visibility did not save");
  if (!(await p.getByLabel("Username").isDisabled())) throw new Error("username can change again inside 30 days");
  await p.getByText(/Yours\. You can change it again on /).waitFor();
  await shot("settings-part2");
  await a11y("settings-part2");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.reload();
  await settled();
  await a11y("settings-part2-dark");
  await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize({ width: 360, height: 780 });
  await p.reload();
  await settled();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await shot("settings-part2-phone");
  await p.setViewportSize({ width: 1280, height: 900 });
  if (overflow) throw new Error("settings scroll sideways at 360px");

  // The download has it all.
  const data = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
  if (data.account.username !== handle || data.account.headline !== "Data work, moving into analytics") throw new Error("download lacks username or headline");
  if (data.pay?.currentLakh !== 4.2 || data.pay?.expectedLakh !== 6) throw new Error("download lacks pay");
  if (data.settings?.visibility !== "signed_in") throw new Error("download lacks privacy settings");
  const resumeLines = data.resumes.flatMap((r) => r.profiles.flatMap((x) => (x.data?.roles ?? []).flatMap((role) => role.highlights ?? [])));

  // The public profile: name and headline; never pay, the email or a resume line.
  // On a /u page the whole HTML is checked, the data the page carries for React included; on /me (the owner's own page,
  // which holds their own resume lines for editing) only what is on screen.
  const neverShown = async (q, where, { screenOnly = false } = {}) => {
    const text = await q.locator("main").innerText();
    for (const bad of ["4.2", "lakh", testEmail, "₹"]) if (text.includes(bad)) throw new Error(`${where} shows ${bad}`);
    for (const line of resumeLines) if (line.length > 12 && text.includes(line)) throw new Error(`${where} shows a resume line`);
    if (screenOnly) return;
    const html = await q.content();
    for (const bad of ["lakh", testEmail, "currentLakh", "expectedLakh"]) if (html.includes(bad)) throw new Error(`${where} carries ${bad} in its HTML: ...${html.slice(Math.max(0, html.indexOf(bad) - 120), html.indexOf(bad) + 40)}...`);
    for (const line of resumeLines) if (line.length > 12 && html.includes(line)) throw new Error(`${where} carries a resume line in its HTML`);
  };
  await p.getByRole("link", { name: "Open your profile link" }).click();
  await p.waitForURL(new RegExp(`/u/${handle}$`));
  // Load it afresh: after a client-side move the settings page stays in the document, hidden, for the Back button.
  await p.reload();
  await settled();
  await p.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor({ timeout: 10000 });
  await p.getByText("Data work, moving into analytics").waitFor();
  await p.getByText("This is your profile as others see it.").waitFor();
  await neverShown(p, "own /u page");
  await shot("public-profile");
  await a11y("public-profile");
  // /me's View as others is the same projection.
  await p.goto(BASE + "/me");
  await settled();
  await p.getByRole("button", { name: "View as others" }).click();
  await p.getByText("You are seeing your profile the way other people will", { exact: false }).waitFor();
  await neverShown(p, "View as others", { screenOnly: true });

  // Someone else, signed in: sees it while it is open, then the not-found page once it is Only you.
  const other = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await other.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  await q.goto(BASE + "/sign-in");
  await q.locator('input[name="name"]').fill("Ravi Menon");
  await q.locator('input[name="email"]').fill(`e2e-viewer-${Date.now()}@example.com`);
  await q.locator('form button[type="submit"]').last().click();
  await q.waitForURL(/\/(sign-up\/finish|today)/, { timeout: 15000 });
  if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
    await q.locator('input[name="age"]').check();
    await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
    await q.waitForURL(/\/today/, { timeout: 15000 });
  }
  await q.goto(BASE + `/u/${handle.toUpperCase()}`);
  await q.waitForURL(new RegExp(`/u/${handle}$`), { timeout: 10000 });
  await q.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor({ timeout: 10000 });
  await q.getByText("Data work, moving into analytics").waitFor();
  if (await q.getByText("This is your profile as others see it.").count()) throw new Error("a stranger sees the owner's note");
  if (await q.getByRole("button", { name: "View as others" }).count()) throw new Error("a stranger sees edit controls");
  await neverShown(q, "stranger's /u page");
  await a11yOn(q, "public-profile-stranger");

  await p.goto(BASE + "/settings");
  await settled();
  await p.getByLabel("Only you", { exact: true }).check({ force: true });
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("You have unsaved changes.").waitFor({ state: "detached", timeout: 15000 });
  await q.goto(BASE + `/u/${handle}`);
  await q.getByRole("heading", { name: "We can't find that page" }).waitFor({ timeout: 10000 });
  // Another spelling of a hidden profile doesn't redirect either, so it doesn't show the profile exists.
  await q.goto(BASE + `/u/${handle.toUpperCase()}`);
  await q.getByRole("heading", { name: "We can't find that page" }).waitFor({ timeout: 10000 });
  if (!q.url().endsWith(`/u/${handle.toUpperCase()}`)) throw new Error("a hidden profile's other spelling redirected");
  // A username nobody has looks the same.
  await q.goto(BASE + `/u/${handle}-nobody`);
  await q.getByRole("heading", { name: "We can't find that page" }).waitFor({ timeout: 10000 });
  await other.close();
});
// Settings columns (docs/plans/settings-columns-plan.md, FR-55, v44 gap items 31, 33 and 36). In Settings the walk turns
// off message requests and picks Pune and Remote under Pay and location; Departures then opens on "Your places" with
// only those roles, and Any city lists the rest. In the Inbox it ticks Mon 17:00 and 18:00 as Usually free, and the
// summary reads "Mon 17:00 to 19:00" after a reload. The download has all three. Then it puts everything back, so the
// later Inbox and Departures steps see a person with nothing set.
await step("settings columns: message requests off, Open to work in filters Departures, Usually free in the Inbox", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to seed the feed");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const roles = [
    ["e2e-p1", "Places analyst Pune (e2e)", "Pune"],
    ["e2e-p2", "Places analyst Remote (e2e)", "Remote"],
    ["e2e-p3", "Places analyst Kochi (e2e)", "Kochi"],
  ];
  const settingsSave = async () => {
    await p.getByRole("button", { name: "Save changes" }).click();
    await p.getByText("You have unsaved changes.").waitFor({ state: "detached", timeout: 15000 });
  };
  try {
    for (const [id, title, city] of roles) {
      await sql`
        insert into job_posts (ats, board_token, external_id, url, title, company, city, experience_note, role_slug, required_skill_ids, nice_skill_ids, posted_at)
        values ('greenhouse', 'e2e-places', ${id}, ${`https://example.com/jobs/${id}`}, ${title}, 'Example Labs', ${city}, '2 to 4 years', 'data-analyst',
          '{sql,excel}'::text[], '{}'::text[], now())
        on conflict (ats, board_token, external_id) do update set closed_at = null, last_seen_at = now()`;
    }
    await p.goto(BASE + "/settings");
    await settled();
    const requests = p.getByRole("checkbox", { name: /^Allow message requests from people who aren't connections/ });
    if (!(await requests.isChecked())) throw new Error("message requests don't start on");
    await requests.setChecked(false, { force: true });
    await p.getByLabel("Add a city").selectOption("Pune");
    const chips = p.locator("[data-open-to-work-in]");
    await chips.getByRole("button", { name: "Remote", exact: true }).click();
    if ((await chips.getByRole("button", { name: "Pune", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("Pune isn't picked");
    await settingsSave();
    await p.reload();
    await settled();
    if (await requests.isChecked()) throw new Error("message requests off did not save");
    for (const place of ["Remote", "Pune"])
      if ((await chips.getByRole("button", { name: place, exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error(`${place} did not save`);
    await a11y("settings-columns");
    await p.emulateMedia({ colorScheme: "dark" });
    // Reload so every colour is drawn dark from the start, as on the other dark checks.
    await p.reload();
    await settled();
    await a11y("settings-columns-dark");
    await p.emulateMedia({ colorScheme: "light" });

    await p.goto(BASE + "/departures");
    await settled();
    const city = p.getByRole("group", { name: "City" });
    if ((await city.getByRole("button", { name: "Your places" }).getAttribute("aria-pressed")) !== "true") throw new Error("Departures doesn't open on Your places");
    const role = (title) => p.getByRole("button", { name: `${title} at Example Labs`, exact: true });
    await role(roles[0][1]).waitFor({ timeout: 10000 });
    await role(roles[1][1]).waitFor();
    if (await role(roles[2][1]).count()) throw new Error("Your places lists a role in another city");
    await city.getByRole("button", { name: "Any city" }).click();
    await role(roles[2][1]).waitFor({ timeout: 5000 });
    await a11y("departures-your-places");

    await p.goto(BASE + "/inbox");
    await settled();
    const panel = p.getByRole("complementary", { name: "Your availability" });
    const summary = panel.locator("[data-usually-free-summary]");
    if ((await summary.innerText()) !== "Not set") throw new Error("Usually free doesn't start Not set");
    const hours = panel.getByRole("group", { name: "Usually free hours" });
    for (const slot of ["Mon 17:00", "Mon 18:00"]) await hours.getByRole("button", { name: slot, exact: true }).click();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await panel.getByText("Saved. Ask for times now pre-ticks these hours.").waitFor({ timeout: 15000 });
    await p.reload();
    await settled();
    await p.waitForFunction(() => document.querySelector("[data-usually-free-summary]")?.textContent === "Mon 17:00 to 19:00", null, { timeout: 10000 });
    await shot("inbox-usually-free");
    await a11y("inbox-usually-free");
    await p.emulateMedia({ colorScheme: "dark" });
    // Reload so every colour is drawn dark from the start, as on the other dark checks.
    await p.reload();
    await settled();
    await a11y("inbox-usually-free-dark");
    await p.emulateMedia({ colorScheme: "light" });

    const data = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
    if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
    if (data.settings?.messageRequests !== false) throw new Error("the download lacks message requests off");
    if (JSON.stringify(data.settings?.openToWorkIn) !== JSON.stringify(["Remote", "Pune"])) throw new Error("the download lacks Open to work in");
    if (JSON.stringify(data.availability?.usuallyFree) !== JSON.stringify(["mon 17:00", "mon 18:00"])) throw new Error("the download lacks Usually free");

    // Put it all back for the later steps.
    for (const slot of ["Mon 17:00", "Mon 18:00"]) await hours.getByRole("button", { name: slot, exact: true }).click();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await panel.getByText("Saved.", { exact: true }).waitFor({ timeout: 15000 });
    await p.goto(BASE + "/settings");
    await settled();
    await requests.setChecked(true, { force: true });
    for (const place of ["Remote", "Pune"]) await chips.getByRole("button", { name: place, exact: true }).click();
    await settingsSave();
  } finally {
    await p.emulateMedia({ colorScheme: "light" });
    // Also reset in SQL, so a failure partway never leaves later steps with a changed person.
    await sql`update user_settings set message_requests = true, open_to_work_in = '{}', usually_free = '{}'
      where user_id = (select id from users where email like ${testEmail + "%"} order by created_at desc limit 1)`;
    await sql`update job_posts set closed_at = now() where board_token = 'e2e-places'`;
    await sql.end();
  }
});
// Me editing (docs/plans/me-editing-plan.md, v44 gap item 23). On /me the walk adds a role, an education row, a story (seen
// in its Board column, then in the List) and two interests; edits one of each; checks View as others (the story and the
// interests show, no Edit, Delete or remove); then deletes one of each. Each Save says "Saved." and Cancel puts focus
// back on the control that opened the form. axe passes in light and dark, and /me fits a phone.
await step("me editing: add, edit and delete a role, education, a story and interests; View as others shows them", async () => {
  await p.goto(BASE + "/me");
  await settled();
  const main = p.locator("main").first();
  await main.getByText("Write your first story: a time at work, college, an internship or volunteering. Keep each part short.").waitFor({ timeout: 10000 });
  // The job search rail's "Show my pitstop on the map · soon" is a separate item (job-search plan) and stays.
  if (await main.getByText(/· soon/).filter({ hasNotText: "Show my pitstop on the map" }).count()) throw new Error("Me still says soon");
  // The toast stays in the page at opacity 0 until it clears, so wait for it to go before the next save can look for it.
  const saved = async () => {
    const toast = p.getByText("Saved.", { exact: true }).first();
    await toast.waitFor({ timeout: 15000 });
    await toast.waitFor({ state: "detached", timeout: 10000 });
  };
  // A story title is in its card's summary, and again (screen-reader only) in its Edit and Delete buttons.
  const card = (scope) => scope.locator("summary").getByText(title, { exact: true });
  const focused = (name) => p.waitForFunction((n) => document.activeElement?.textContent?.trim() === n, name, { timeout: 5000 });

  // Cancel puts focus back on "+ Add role".
  await main.getByRole("button", { name: "+ Add role" }).click();
  await main.getByLabel("Job title", { exact: true }).waitFor();
  await main.getByRole("button", { name: "Cancel", exact: true }).click();
  await focused("+ Add role");
  // A role: refused without a start, then saved.
  await main.getByRole("button", { name: "+ Add role" }).click();
  await main.getByLabel("Job title", { exact: true }).fill("Volunteer data lead");
  await main.getByLabel("Company", { exact: true }).fill("Pune Reads Library Trust");
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await main.getByText("Pick a month and year.").first().waitFor({ timeout: 10000 });
  await main.getByLabel("Started, month").selectOption("06");
  await main.getByLabel("Started, year").selectOption("2023");
  await main.getByLabel("Ended, month").selectOption("12");
  await main.getByLabel("Ended, year").selectOption("2023");
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  await main.getByRole("button", { name: "Edit Volunteer data lead" }).waitFor({ timeout: 15000 });
  await main.getByText("Jun 2023 to Dec 2023", { exact: false }).waitFor();

  // Education.
  const education = main.getByRole("region", { name: "Education" });
  await education.getByRole("button", { name: "+ Add", exact: true }).click();
  await education.getByLabel("Qualification", { exact: true }).fill("Data Analytics with Python");
  await education.getByLabel("Institution", { exact: true }).fill("NPTEL");
  await education.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  await education.getByRole("button", { name: "Edit Data Analytics with Python" }).waitFor({ timeout: 15000 });

  // A story, refused with no box, then saved; it shows in its Board column, then in the List.
  const title = "Cut missed phishing alerts";
  await main.getByRole("button", { name: "+ Add story" }).click();
  await main.getByLabel("Title", { exact: true }).fill(title);
  await main.getByLabel("Where and when", { exact: true }).fill("Konkan Co-operative Bank · 2025");
  await main.getByLabel("Situation", { exact: true }).fill("Phishing alerts piled up and the team missed some.");
  await main.getByLabel("Task", { exact: true }).fill("I owned the morning triage of the alert queue.");
  await main.getByLabel("Action", { exact: true }).fill("I sorted the alerts by sender domain and wrote a short checklist for the team to follow.");
  await main.getByLabel("Result", { exact: true }).fill("Missed alerts fell from 9 a week to 1.");
  await main.getByText("38 of 400").waitFor();
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await main.getByText("Pick at least one box.").waitFor({ timeout: 10000 });
  await main.getByRole("button", { name: "Problem solving", exact: true }).click();
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  const column = main.getByRole("region", { name: "Problem solving" });
  await card(column).waitFor({ timeout: 15000 });
  await main.getByText("1 story · 5 boxes empty").waitFor();
  await main.getByRole("button", { name: "List", exact: true }).click();
  await main.getByRole("button", { name: "List", pressed: true }).waitFor();
  await card(column).click();
  // The SMART check: one box and no goal, so R is missing and its hint shows; never a score.
  await column.getByLabel("SMART check: S, M, A, T met").waitFor();
  await column.getByText("Link it to a goal, or pick another box it answers.").waitFor();

  // Two interests; the same one again is refused.
  await main.getByLabel("Add an interest").fill("Photography");
  await main.getByRole("button", { name: "Add", exact: true }).click();
  await saved();
  await main.getByRole("button", { name: "Remove Photography" }).waitFor({ timeout: 15000 });
  await main.getByLabel("Add an interest").fill("Cricket stats");
  await main.getByRole("button", { name: "Add", exact: true }).click();
  await saved();
  await main.getByRole("button", { name: "Remove Cricket stats" }).waitFor({ timeout: 15000 });
  await main.getByLabel("Add an interest").fill(" photography ");
  await main.getByRole("button", { name: "Add", exact: true }).click();
  await main.getByText("That one is already on your list.").waitFor({ timeout: 10000 });
  await main.getByLabel("Add an interest").fill("");

  // Edit one of each.
  await main.getByRole("button", { name: "Edit Volunteer data lead" }).click();
  await main.getByLabel("Job title", { exact: true }).fill("Volunteer data analyst");
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  await main.getByRole("button", { name: "Edit Volunteer data analyst" }).waitFor({ timeout: 15000 });
  await focused("Edit Volunteer data analyst");
  await education.getByRole("button", { name: "Edit Data Analytics with Python" }).click();
  await education.getByLabel("Year", { exact: true }).fill("2025");
  await education.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  await education.getByText("NPTEL · 2025").waitFor({ timeout: 15000 });
  if (!(await column.getByRole("button", { name: `Edit ${title}` }).isVisible())) await card(column).click();
  await column.getByRole("button", { name: `Edit ${title}` }).click();
  await main.getByLabel("Result", { exact: true }).fill("Missed alerts fell from 9 a week to 1 in six weeks.");
  await main.getByRole("button", { name: "Learning", exact: true }).click();
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
  await card(main.getByRole("region", { name: "Learning" })).waitFor({ timeout: 15000 });
  await shot("me-editing");
  await a11y("me-editing");

  // View as others: the role, the course, the story and the interests, and no editing.
  await main.getByRole("button", { name: "View as others" }).click();
  await main.getByText("You are seeing your profile the way other people will", { exact: false }).waitFor();
  for (const text of ["Volunteer data analyst", "Data Analytics with Python", "Photography", "Cricket stats"]) await main.getByText(text, { exact: true }).first().waitFor();
  await card(main.getByRole("region", { name: "Problem solving" })).waitFor();
  for (const name of [/^Edit /, /^Delete /, /^Remove /, "+ Add role", "+ Add story"]) if (await main.getByRole("button", { name }).count()) throw new Error(`View as others offers ${name}`);
  if (await main.getByText("Added by you").count()) throw new Error("View as others shows Added by you");
  await main.getByRole("button", { name: "Back to editing" }).click();

  // Delete one of each: Keep first, then Delete.
  const storyColumn = main.getByRole("region", { name: "Problem solving" });
  if (!(await storyColumn.getByRole("button", { name: `Delete ${title}` }).isVisible())) await card(storyColumn).click();
  await storyColumn.getByRole("button", { name: `Delete ${title}` }).click();
  await main.getByRole("group", { name: "Delete this story?" }).waitFor();
  await main.getByRole("button", { name: "Keep", exact: true }).click();
  await focused(`Delete ${title}`);
  await storyColumn.getByRole("button", { name: `Delete ${title}` }).click();
  await main.getByRole("group", { name: "Delete this story?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await main.getByText("Write your first story", { exact: false }).waitFor({ timeout: 15000 });
  await main.getByRole("button", { name: "Delete Volunteer data analyst" }).click();
  await main.getByRole("group", { name: "Delete this role?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await main.getByRole("button", { name: "Edit Volunteer data analyst" }).waitFor({ state: "detached", timeout: 15000 });
  await education.getByRole("button", { name: "Delete Data Analytics with Python" }).click();
  await main.getByRole("group", { name: "Delete this?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await education.getByRole("button", { name: "Edit Data Analytics with Python" }).waitFor({ state: "detached", timeout: 15000 });
  await main.getByRole("button", { name: "Remove Cricket stats" }).click();
  await main.getByRole("button", { name: "Remove Cricket stats" }).waitFor({ state: "detached", timeout: 15000 });

  // The download has what is left: one interest.
  const data = await p.request.get(BASE + "/api/account/export").then((r) => r.json());
  if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
  if (data.interests?.map((x) => x.name).join() !== "Photography" || data.stories?.length || data.meRoles?.length || data.meEducation?.length) throw new Error("the download doesn't match Me");

  await p.emulateMedia({ colorScheme: "dark" });
  await p.reload();
  await settled();
  await a11y("me-editing-dark");
  await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize({ width: 360, height: 780 });
  await p.reload();
  await settled();
  await p.locator("main").first().getByRole("button", { name: "+ Add story" }).click();
  await a11y("me-editing-phone");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await shot("me-editing-phone");
  await p.setViewportSize({ width: 1280, height: 900 });
  if (overflow) throw new Error("/me scrolls sideways at 360px with the story form open");
});
await step("delete account, then restore it by signing in again", async () => {
  await p.goto(BASE + "/settings");
  await settled();
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  await p.getByLabel("Type DELETE to confirm").fill("DELETE");
  await p.getByRole("button", { name: "Delete my account" }).click();
  await p.waitForURL(/\/account\/deleted/, { timeout: 15000 });
  await a11y("account-deleted");
  // Signed out: the signed-in screens send them to sign in.
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/);
  await p.locator('input[name="name"]').fill("Priya Sharma");
  await p.locator('input[name="email"]').fill(testEmail);
  await p.locator('form button[type="submit"]').last().click();
  await p.waitForURL(/\/account\/restore/, { timeout: 15000 });
  await shot("account-restore");
  await a11y("account-restore");
  await p.getByRole("button", { name: "Restore my account" }).click();
  await p.waitForURL(/\/today/, { timeout: 15000 });
  await p.locator('section[aria-label="Your goals"]').waitFor();
});
await step("inbox: offer times, accept a request", async () => {
  await p.goto(BASE + "/today");
  await settled();
  await p.getByRole("link", { name: /^Inbox/ }).first().click();
  await p.waitForURL(/\/inbox/);
  await settled();
  // A new account has no chats yet; the empty Inbox links to the example.
  await p.getByText("No messages yet.").waitFor();
  await p.getByRole("link", { name: "See an example Inbox" }).click();
  await p.waitForURL(/example=1/);
  await p.getByRole("button", { name: "Offer times" }).click();
  await p.locator('[aria-label="Pick times"] button:not([disabled])').first().click();
  await p.getByRole("button", { name: "Send 1 time" }).click();
  await p.getByText(/You offered 1 times?:/).waitFor();
  await p.getByRole("button", { name: "Requests" }).click();
  await p.getByRole("button", { name: /Sameer Kulkarni/ }).click();
  await p.getByRole("button", { name: "Accept" }).click();
  await p.getByText("You accepted. You can now message each other.").waitFor();
  await a11y("inbox-after");
});
// Real chats: someone sends the walk's account a message request straight into the database (nobody can start one
// from the app until Network exists), then the account accepts, replies and reports it.
if (process.env.DATABASE_URL) {
  await step("inbox: real request, accept, reply, report", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [me] = await sql`select id from users where email like ${testEmail + "%"} order by created_at desc limit 1`;
      if (!me) throw new Error("walk account not found");
      const [them] = await sql`insert into users (email, name) values (${"sender-" + testEmail}, 'Vikram Singh') returning id`;
      const [chat] = await sql`insert into conversations (kind, status, started_by) values ('direct', 'request', ${them.id}) returning id`;
      await sql`insert into conversation_members (conversation_id, user_id) values (${chat.id}, ${them.id}), (${chat.id}, ${me.id})`;
      await sql`insert into messages (conversation_id, sender_id, body) values (${chat.id}, ${them.id}, 'Hi Priya, could I ask about your SIEM switch?')`;
      await p.goto(BASE + "/inbox");
      await settled();
      await p.getByRole("link", { name: /Inbox, 1 unread/ }).first().waitFor();
      await p.getByRole("button", { name: /Vikram Singh/ }).click();
      await p.getByRole("button", { name: "Accept" }).click();
      await p.getByText("Request accepted. You can now message each other.").waitFor({ timeout: 10000 });
      await p.getByRole("textbox", { name: "Message", exact: true }).fill("Happy to help. Ask away.");
      await p.getByRole("button", { name: "Send" }).click();
      await p.locator('ol[aria-label="Messages"]').getByText("Happy to help. Ask away.").waitFor({ timeout: 10000 });
      await p.waitForFunction(() => document.querySelector("[data-draft]")?.value === "", null, { timeout: 5000 });
      await p.getByRole("button", { name: "Block or report" }).click();
      await p.getByRole("button", { name: "Report", exact: true }).click();
      await p.getByRole("alert").getByText("Choose what happened.").waitFor();
      await p.getByLabel("Fake job, scam or spam").check();
      await a11y("inbox-report");
      await p.getByRole("button", { name: "Report", exact: true }).click();
      await p.getByRole("status").getByText("Reported. We confirm within 24 hours.").waitFor({ timeout: 10000 });
      const [filed] = await sql`select target, reason from reports where reporter_id = ${me.id}`;
      if (filed?.target !== "person" || filed?.reason !== "fake_or_spam") throw new Error("report not saved");
      const [sent] = await sql`select count(*)::int as n from messages where conversation_id = ${chat.id} and sender_id = ${me.id}`;
      if (sent.n !== 1) throw new Error("reply not saved");
      // A new message in the chat on screen counts as read: the badge clears without opening another chat.
      await sql`insert into messages (conversation_id, sender_id, body) values (${chat.id}, ${them.id}, 'Thanks! First question soon.')`;
      await p.reload();
      await p.locator('ol[aria-label="Messages"]').getByText("Thanks! First question soon.").waitFor();
      await p.getByRole("link", { name: "Inbox", exact: true }).first().waitFor({ timeout: 10000 });
      await shot("inbox-real");
    } finally {
      await sql.end();
    }
  });
}
// Someone who signs in before uploading anything: every signed-in screen must load (Milin hit an error page here).
await step("fresh test user, no resume: every signed-in screen loads", async () => {
  const fresh = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await fresh.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await q.goto(BASE + "/today");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Fresh Rider");
    await q.locator('input[name="email"]').fill(`fresh-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/sign-up\/finish/, { timeout: 15000 });
    await q.locator('input[name="age"]').check();
    await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
    await q.waitForURL(/\/today/, { timeout: 15000 });
    for (const path of ["/today", "/map", "/match", "/practice", "/market", "/departures", "/arrivals", "/inbox", "/network", "/library", "/builder", "/elite", "/mock", "/me", "/settings"]) {
      await q.goto(BASE + path);
      await q.locator("header").first().waitFor();
      await q.locator("main").first().waitFor();
      await q.getByText(/Loading…/).first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
      if (await q.getByText("Something went wrong").count()) throw new Error("error page on " + path);
    }
  } finally {
    await fresh.close();
  }
});
// Notifications in the app (docs/plans/notifications-plan.md, v44 gap item 15). Person B asks person A to connect from
// A's profile; A's bell reads "Notifications, 1 new" with its dot. Opening it shows the sentence and clears the dot,
// Esc puts focus back on the bell, and the row opens Network on Requests. axe passes with the panel open at phone width,
// light and dark, with no sideways scroll.
await step("notifications: a connection request rings the bell, opening it clears the dot, the row opens Requests", async () => {
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const ctxR = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const qa = await ctxA.newPage();
  const qr = await ctxR.newPage();
  for (const q of [qa, qr]) {
    q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
    q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  }
  const signUp = async (q, name, email) => {
    await q.goto(BASE + "/today");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill(name);
    await q.locator('input[name="email"]').fill(email);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/(sign-up\/finish|today)/, { timeout: 15000 });
    if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/today/, { timeout: 15000 });
    }
  };
  try {
    const handle = `bell-${Date.now().toString(36)}`;
    await signUp(qa, "Asha Bellamy", `bell-a-${testEmail}`);
    await signUp(qr, "Ravi Bellamy", `bell-r-${testEmail}`);
    // A new account has nothing new: the bell reads "Notifications", with no dot.
    const bell = qa.locator("header button[data-bell]");
    if ((await bell.getAttribute("aria-label")) !== "Notifications") throw new Error(`a new account's bell reads ${await bell.getAttribute("aria-label")}`);
    // A opens their profile to everyone signed in, so B can find the Connect button there.
    await qa.goto(BASE + "/settings");
    await qa.getByLabel("Username").fill(handle);
    await qa.getByText(/^Available\. After you save/).waitFor({ timeout: 10000 });
    await qa.getByLabel("Everyone signed in").check({ force: true });
    await qa.getByRole("button", { name: "Save changes" }).click();
    await qa.getByText("You have unsaved changes.").waitFor({ state: "detached", timeout: 15000 });
    await qr.goto(BASE + `/u/${handle}`);
    await qr.getByRole("heading", { level: 1, name: "Asha Bellamy" }).waitFor({ timeout: 10000 });
    await qr.getByRole("button", { name: "Connect", exact: true }).click();
    await qr.getByRole("button", { name: "Send request", exact: true }).click();
    await qr.getByText("Request sent to Asha.").waitFor({ timeout: 10000 });
    // B gets nothing for their own request.
    if ((await qr.locator("header button[data-bell]").getAttribute("aria-label")) !== "Notifications") throw new Error("the sender's own bell rang");

    await qa.goto(BASE + "/today");
    await bell.waitFor();
    if ((await bell.getAttribute("aria-label")) !== "Notifications, 1 new") throw new Error(`the bell reads ${await bell.getAttribute("aria-label")}`);
    if (!(await qa.locator("header [data-bell-dot]").count())) throw new Error("no dot on the bell");
    await bell.click();
    const row = qa.getByRole("link", { name: "New: Ravi Bellamy asked to connect.", exact: false });
    await row.waitFor({ timeout: 10000 });
    if (await qa.locator("header [data-bell-dot]").count()) throw new Error("the dot stayed after opening");
    await axeOn(qa, "notifications-panel");
    await qa.keyboard.press("Escape");
    await qa.waitForFunction(() => document.activeElement?.hasAttribute("data-bell"), null, { timeout: 5000 });
    if ((await bell.getAttribute("aria-label")) !== "Notifications") throw new Error("the bell still reads new after opening");
    // Phone width, light then dark: the panel fills the screen under the top bar, with no sideways scroll.
    await qa.setViewportSize({ width: 360, height: 780 });
    for (const scheme of ["light", "dark"]) {
      await qa.emulateMedia({ colorScheme: scheme });
      // Reload so every colour is drawn in this scheme from the start, as on the other dark checks.
      await qa.reload();
      // Wait for hydration, so the click opens the panel.
      await qa.waitForLoadState("networkidle");
      await bell.waitFor({ timeout: 10000 });
      await bell.click();
      await qa.getByRole("link", { name: "Ravi Bellamy asked to connect.", exact: false }).waitFor({ timeout: 10000 });
      if (await qa.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`the panel scrolls sideways at 360px (${scheme})`);
      await axeOn(qa, `notifications-panel-phone-${scheme}`);
      await qa.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-notifications-phone-${scheme}.png` });
      await qa.keyboard.press("Escape");
    }
    await qa.setViewportSize({ width: 1280, height: 900 });
    await qa.emulateMedia({ colorScheme: "light" });
    // The row opens Network, on Requests.
    await bell.click();
    await qa.getByRole("link", { name: "Ravi Bellamy asked to connect.", exact: false }).click();
    await qa.waitForURL(/\/network\?tab=requests/, { timeout: 15000 });
    await qa.getByRole("tab", { name: /^Requests/, selected: true }).waitFor({ timeout: 10000 });
  } finally {
    await ctxA.close();
    await ctxR.close();
  }
});
// Build your resume (FR-36, handoff 12k). A fresh person answers the seven sections; one click on Next moves on each
// time, though leaving a field starts a save. "Review my resume" goes to the stand-in model (e2e/mock-ai.mjs buildReply),
// which returns the answer's own words plus "Improved results by 99% across 400 systems": the line check must drop
// that one, so the review shows the person's line and never the made-up one. axe passes in light and dark and at
// phone width, with no sideways scroll.
await step("builder: seven sections, one click each, and Review drops the model's made-up line", async () => {
  const ctxB = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctxB.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await q.goto(BASE + "/builder");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Builder Rider");
    await q.locator('input[name="email"]').fill(`builder-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/(sign-up\/finish|today|builder)/, { timeout: 15000 });
    if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/(today|builder)/, { timeout: 15000 });
    }
    if (!new URL(q.url()).pathname.startsWith("/builder")) await q.goto(BASE + "/builder");
    const section = (name) => q.getByRole("heading", { name, level: 2, exact: true });
    const next = async (name) => {
      await q.getByRole("button", { name: "Next", exact: true }).click();
      await section(name).waitFor({ timeout: 5000 });
    };
    await section("Role").waitFor({ timeout: 15000 });
    await q.getByLabel("Target role").selectOption("data-analyst");
    await q.getByText("Just graduated", { exact: true }).click();
    await next("Education");
    await q.getByRole("button", { name: "Add degree" }).click();
    await q.getByLabel("Degree", { exact: true }).fill("B.Com.");
    await q.getByLabel("College", { exact: true }).fill("Example College, Indore");
    await q.getByLabel("Start year").fill("2021");
    // Leaving the field mid-way starts a save in the background; Next still works on the first click.
    await q.getByLabel("End year").fill("2024");
    await next("Projects");
    await q.getByRole("button", { name: "Add project" }).click();
    await q.getByLabel("Project name").fill("Shop sales dashboard");
    await q.getByLabel("What did you build or do?").fill("Built a sales dashboard in Excel for 3 shops.");
    await next("Internships and jobs");
    await q.getByRole("checkbox", { name: /haven.t worked yet/ }).check();
    await next("Tools");
    const tools = q.getByRole("list", { name: "Tools" });
    if (!(await tools.getByRole("button", { pressed: true }).count())) {
      await q.getByLabel("Add your own").fill("Excel");
      await q.getByRole("button", { name: "Add", exact: true }).click();
    }
    await tools.getByRole("button", { pressed: true }).first().waitFor({ timeout: 5000 });
    await next("Certificates");
    await q.getByRole("checkbox", { name: "None yet" }).check();
    await next("Links");
    await q.getByLabel("GitHub").fill("github.com/builder-rider");
    await q.getByRole("button", { name: "Review my resume" }).click();
    await q.getByRole("heading", { name: "Your resume", level: 1 }).waitFor({ timeout: 60000 });
    const preview = q.getByRole("article", { name: "Resume preview" });
    await preview.getByRole("button", { name: "Built a sales dashboard in Excel for 3 shops." }).waitFor({ timeout: 5000 });
    await preview.getByText("github.com/builder-rider", { exact: false }).waitFor();
    if (await q.getByText("Improved results by 99% across 400 systems", { exact: false }).count()) throw new Error("the review shows the model's made-up line");
    // The model did answer (its suggestion is listed, not added), so the made-up line was dropped by the check.
    await q.getByRole("heading", { name: "Suggested, not added" }).waitFor();
    // Tapping a line shows the answer it came from.
    await preview.getByRole("button", { name: "Built a sales dashboard in Excel for 3 shops." }).click();
    await preview.getByText(/^Your answer:/).waitFor();
    await axeOn(q, "builder-review");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-builder-review.png`, fullPage: true });
    // Phone width, light then dark, on the same review (it lives on the page, so no reload).
    await q.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ["light", "dark"]) {
      await q.emulateMedia({ colorScheme: scheme });
      if (await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`the review scrolls sideways at 390px (${scheme})`);
      await axeOn(q, `builder-review-phone-${scheme}`);
    }
    // Back to the answers: the sections in dark mode at phone width pass too.
    await q.getByRole("button", { name: "Edit answers" }).click();
    await section("Role").waitFor({ timeout: 5000 });
    if (await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("the builder scrolls sideways at 390px (dark)");
    await axeOn(q, "builder-phone-dark");
    // "Download PDF or DOCX" on the review goes through the confirm step (the file is made only from a confirmed
    // profile, FR-20); the download appears as soon as "Looks right" saves.
    for (const name of ["Education", "Projects", "Internships and jobs", "Tools", "Certificates", "Links"]) await next(name);
    await q.getByRole("button", { name: "Review my resume" }).click();
    await q.getByRole("heading", { name: "Your resume", level: 1 }).waitFor({ timeout: 60000 });
    await q.getByRole("checkbox", { name: "Everything here is true and mine." }).check();
    await q.getByRole("button", { name: "Download PDF or DOCX" }).click();
    await q.waitForURL(/\/resume\/[0-9a-f-]+$/, { timeout: 15000 });
    await q.getByRole("button", { name: "Looks right", exact: true }).click();
    await q.getByRole("heading", { name: "Download your resume" }).waitFor({ timeout: 15000 });
    const pdf = await q.request.get(BASE + (await q.getByRole("link", { name: "PDF", exact: true }).getAttribute("href")));
    if (pdf.status() !== 200 || !(await pdf.body()).subarray(0, 5).toString("latin1").startsWith("%PDF-")) throw new Error(`the built resume's PDF download gave ${pdf.status()}`);
  } finally {
    await ctxB.close();
  }
});
// Elite, free in the beta (FR-50, handoff 12l). A fresh person turns Elite on from /elite: the avatar gets its mark and
// the menu says "Elite · beta" and "Elite is on". Their own profile shows the plan card; its switch puts the Elite badge
// by their name, and View as others hides the card. Settings > Your plan turns Elite off: back to Free, the badge gone,
// and the download says so. axe passes on each screen, and nothing asks for a card.
await step("elite: turn it on from /elite, see it in the menu and on the profile, turn it off in Settings", async () => {
  const ctxE = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctxE.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await q.goto(BASE + "/elite");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Vela Rider");
    await q.locator('input[name="email"]').fill(`elite-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/(sign-up\/finish|today|elite)/, { timeout: 15000 });
    if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/(today|elite)/, { timeout: 15000 });
    }
    if (!new URL(q.url()).pathname.startsWith("/elite")) await q.goto(BASE + "/elite");
    const main = q.locator("main");
    const turnOn = main.getByRole("button", { name: "Turn on Elite, free in the beta", exact: true });
    await turnOn.waitFor({ timeout: 15000 });
    for (const words of ["not charged now", "Prices are not final", "₹299", "₹2,499", "₹799", "at least 30 days"]) await main.getByText(words).first().waitFor();
    if (await main.getByRole("textbox").count()) throw new Error("/elite asks for something to type");
    await axeOn(q, "elite-free");
    await turnOn.click();
    await main.getByRole("button", { name: "Elite is on, free in the beta", exact: true }).waitFor({ timeout: 10000 });

    // The avatar and its menu.
    const avatar = q.getByRole("button", { name: /, Elite, open menu$/ });
    await avatar.waitFor({ timeout: 10000 });
    await avatar.click();
    const menu = q.locator("header");
    await menu.getByText("Elite · beta", { exact: true }).waitFor();
    await menu.getByRole("link", { name: "Elite is on", exact: true }).waitFor();
    await menu.getByRole("link", { name: "Build your resume", exact: true }).waitFor();
    await axeOn(q, "elite-on-menu");
    await q.keyboard.press("Escape");

    // Their own profile: the plan card, and the badge only once they turn it on.
    await q.goto(BASE + "/me");
    const card = q.getByRole("region", { name: "Your plan" });
    await card.getByText("Elite is on, free in the beta", { exact: true }).waitFor({ timeout: 15000 });
    const name = q.locator("main h1").first();
    if (await name.getByText("Elite", { exact: true }).count()) throw new Error("the Elite badge shows before it is turned on");
    const badge = card.getByRole("checkbox", { name: "Show the Elite badge on my profile" });
    if (await badge.isChecked()) throw new Error("the badge switch starts on");
    await badge.check({ force: true });
    await name.getByText("Elite", { exact: true }).waitFor({ timeout: 10000 });
    await axeOn(q, "elite-me");
    await main.getByRole("button", { name: "View as others", exact: true }).click();
    await main.getByRole("button", { name: "Back to editing", exact: true }).waitFor();
    if (await q.getByRole("region", { name: "Your plan" }).count()) throw new Error("the plan card shows in View as others");
    await main.getByRole("button", { name: "Back to editing", exact: true }).click();

    // Settings > Your plan: Turn off goes back to Free and keeps everything.
    await q.goto(BASE + "/settings");
    const plan = q.locator("#acc-plan");
    await plan.getByText("Elite, free in the beta", { exact: true }).waitFor({ timeout: 15000 });
    await plan.getByRole("button", { name: "Turn off", exact: true }).click();
    await plan.getByText("You're on Free", { exact: true }).waitFor({ timeout: 10000 });
    await plan.getByRole("link", { name: "See Elite", exact: true }).waitFor();
    await axeOn(q, "elite-settings-free");
    const data = await q.request.get(BASE + "/api/account/export").then((r) => r.json());
    if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
    if (data.plan?.plan !== "free" || data.plan.eliteSince !== null || data.plan.badgeShown !== false) throw new Error("the download's plan is wrong: " + JSON.stringify(data.plan));
    await q.goto(BASE + "/me");
    await q.getByRole("region", { name: "Your plan" }).getByText("You're on Free", { exact: true }).waitFor({ timeout: 15000 });
    if (await q.locator("main h1").first().getByText("Elite", { exact: true }).count()) throw new Error("the Elite badge stays after Elite is off");
    if (await q.getByRole("button", { name: /, Elite, open menu$/ }).count()) throw new Error("the avatar still says Elite");
  } finally {
    await ctxE.close();
  }
});
// Interview prep (FR-50 part 2, handoff 12l). A fresh person opens /mock on Free: the locked panel with Turn on Elite,
// and the question bank with 5 questions open (each with "A strong answer covers" and "Practise this one") and the rest
// locked. With Elite on, they take a timed test: 12 questions, each pick saved as it is made, then the review of every
// question with the count right. axe passes on each screen.
await step("mock: the bank opens 5 on Free; with Elite, a timed test and its review", async () => {
  const ctxM = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctxM.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await q.goto(BASE + "/mock");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Mira Prep");
    await q.locator('input[name="email"]').fill(`mock-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/(sign-up\/finish|today|mock)/, { timeout: 15000 });
    if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/(today|mock)/, { timeout: 15000 });
    }
    if (!new URL(q.url()).pathname.startsWith("/mock")) await q.goto(BASE + "/mock");
    const main = q.locator("main");
    await main.getByRole("heading", { level: 1, name: /Interview prep/ }).waitFor({ timeout: 15000 });

    // Free: the locked panel, and the bank tab with 5 open.
    const unlock = main.getByRole("link", { name: "Turn on Elite", exact: true });
    await unlock.waitFor();
    if ((await unlock.getAttribute("href")) !== "/elite") throw new Error("Turn on Elite doesn't open /elite");
    const mode = main.getByRole("group", { name: "Mode" });
    if ((await mode.getByRole("button", { name: "Question bank", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("Free doesn't open on the bank");
    const openItems = main.locator('[data-bank-item="open"]');
    const lockedItems = main.locator('[data-bank-item="locked"]');
    await openItems.first().waitFor();
    if ((await openItems.count()) !== 5) throw new Error(`${await openItems.count()} bank questions open on Free`);
    if ((await lockedItems.count()) < 1) throw new Error("nothing locked in the bank on Free");
    await openItems.first().locator("summary").click();
    await openItems.first().getByText("A strong answer covers", { exact: true }).waitFor();
    const practise = openItems.first().getByRole("link", { name: "Practise this one" });
    if (!(await practise.getAttribute("href"))?.startsWith("/practice?q=")) throw new Error("Practise this one doesn't open Practice");
    await lockedItems.first().locator("summary").click();
    await lockedItems.first().getByText(/opens with Elite/).waitFor();
    if (await lockedItems.getByText("A strong answer covers", { exact: true }).count()) throw new Error("a locked question shows its note");
    await axeOn(q, "mock-free-bank");
    await mode.getByRole("button", { name: "Timed test", exact: true }).click();
    await main.getByText("Timed tests open with Elite.", { exact: false }).waitFor();
    if (await main.getByRole("button", { name: "Start the test", exact: true }).count()) throw new Error("Free can start a timed test");

    // Turn Elite on, then take a test.
    await q.goto(BASE + "/elite");
    await main.getByRole("button", { name: "Turn on Elite, free in the beta", exact: true }).click();
    await main.getByRole("button", { name: "Elite is on, free in the beta", exact: true }).waitFor({ timeout: 10000 });
    await q.goto(BASE + "/mock?tab=test&role=data-analyst");
    if (await main.getByRole("link", { name: "Turn on Elite", exact: true }).count()) throw new Error("the locked panel stays with Elite on");
    await main.getByRole("button", { name: "Start the test", exact: true }).click();
    const timer = main.getByRole("timer");
    await timer.waitFor({ timeout: 15000 });
    if (!/1[45]:\d\d/.test(await timer.innerText())) throw new Error(`the timer reads ${await timer.innerText()}`);
    await axeOn(q, "mock-test-running");
    for (let i = 0; i < 12; i++) {
      await main.getByText(`Question ${i + 1} of 12`, { exact: true }).waitFor();
      const option = main.getByRole("radiogroup").getByRole("radio").nth(i % 2);
      await Promise.all([q.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/mock"), option.check()]);
      if (!(await option.isChecked())) throw new Error(`pick ${i + 1} didn't stay`);
      await main.getByRole("button", { name: i === 11 ? "Finish test" : "Next", exact: true }).click();
    }
    await main.getByRole("heading", { name: "Your test review", exact: true }).waitFor({ timeout: 15000 });
    await main.getByText(/^\d+ of 12 right\.$/).waitFor();
    if ((await main.locator("[data-review-item]").count()) !== 12) throw new Error("the review doesn't list all 12");
    await axeOn(q, "mock-test-review");

    // The whole bank opens with Elite.
    await mode.getByRole("button", { name: "Question bank", exact: true }).click();
    await openItems.first().waitFor();
    if (await lockedItems.count()) throw new Error("bank questions stay locked with Elite on");

    // The Library's Elite tab opens with Elite (part 5): no locked panel, our playbooks and drills open, and paid
    // courses stay Coming soon slots with no link.
    await q.goto(BASE + "/library?tab=elite");
    const shelf = main.getByRole("region", { name: "Elite shelf", exact: true });
    await shelf.waitFor({ timeout: 15000 });
    if (await shelf.getByRole("link", { name: "Turn on Elite", exact: true }).count()) throw new Error("the shelf stays locked with Elite on");
    if (await shelf.locator('[data-shelf-card="slot"] a').count()) throw new Error("a paid-course slot links somewhere");
    const drills = shelf.locator('[data-shelf-card="own"]').filter({ hasText: "Drill set" }).first();
    await drills.locator("summary").first().click();
    await drills.getByText("Show answer").first().waitFor({ timeout: 5000 });
    await axeOn(q, "library-elite-on");
    const data = await q.request.get(BASE + "/api/account/export").then((r) => r.json());
    if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
    if (data.timedTests?.length !== 1 || typeof data.timedTests[0].right !== "number" || !data.timedTests[0].endedAt) throw new Error("the download's timed test is wrong");
  } finally {
    await ctxM.close();
  }
});
// The mock interview (FR-50 part 3, handoff 12l). A fresh person on Free sees the Mock interview tab locked; with Elite
// on, /mock opens on it: they set up a Full round for Data Analyst (a Mix opens with two about-you questions, whose
// follow-ups wait for review, so this local build asks them: docs/plans/mock-followups-plan.md). A long first answer
// gets a follow-up from the bank, "Follow-up · topic" with a fresh box, the count still "Question 1 of 8"; they answer
// it. The second long answer gets one too, and Skip follow-up moves on; a short third answer gets none. They end with
// "End and get feedback" and get the stand-in model's feedback in words: a summary, then What worked and Add next time
// on each answer, the follow-up and its reply under the first, "Follow-up skipped." under the second, and "Open it in
// the bank" on each skipped question. No score. The download has the round with its answers and follow-ups. axe
// passes on the set-up, the running round, the follow-up and the feedback.
await step("mock interview: a full round with follow-ups, answered, ended, with feedback in words", async () => {
  const ctxI = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctxI.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await q.goto(BASE + "/mock?tab=interview");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Ravi Round");
    await q.locator('input[name="email"]').fill(`interview-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/(sign-up\/finish|today|mock)/, { timeout: 15000 });
    if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/(today|mock)/, { timeout: 15000 });
    }
    const main = q.locator("main");
    await q.goto(BASE + "/mock?tab=interview");
    await main.getByText("Mock interviews open with Elite.", { exact: false }).waitFor({ timeout: 15000 });
    if (await main.getByRole("button", { name: "Start mock interview", exact: true }).count()) throw new Error("Free can start a mock interview");

    await q.goto(BASE + "/elite");
    await main.getByRole("button", { name: "Turn on Elite, free in the beta", exact: true }).click();
    await main.getByRole("button", { name: "Elite is on, free in the beta", exact: true }).waitFor({ timeout: 10000 });
    await q.goto(BASE + "/mock?role=data-analyst");
    const mode = main.getByRole("group", { name: "Mode" });
    await mode.getByRole("button", { name: "Mock interview", exact: true }).waitFor({ timeout: 15000 });
    if ((await mode.getByRole("button", { name: "Mock interview", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("Elite doesn't open on the mock interview");
    const setup = main.getByRole("region", { name: "Set up your mock interview" });
    await setup.waitFor();
    await setup.getByText("It asks follow-ups like a person would, and it can be wrong.", { exact: false }).waitFor();
    if ((await setup.getByLabel("Role").inputValue()) !== "data-analyst") throw new Error("the role isn't the one asked for");
    // The choices are radios inside their labels; press the label, as a person would.
    await setup.getByText("Full round", { exact: true }).click();
    await setup.getByText("Mix", { exact: true }).click();
    if (!(await setup.getByRole("radio", { name: /Full round/ }).isChecked())) throw new Error("Full round isn't picked");
    await axeOn(q, "mock-interview-setup");
    await setup.getByRole("button", { name: "Start mock interview", exact: true }).click();

    const timer = main.getByRole("timer");
    await timer.waitFor({ timeout: 15000 });
    if (!/^(20:00|19:\d\d)$/.test((await timer.innerText()).trim())) throw new Error(`the timer reads ${await timer.innerText()}`);
    await main.getByText(/^Question 1 of 8 · /).waitFor();
    await main.getByText("AI interviewer", { exact: true }).waitFor();
    await axeOn(q, "mock-interview-running");
    const box = main.getByRole("textbox", { name: "Your answer" });
    const saved = () => q.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/mock");
    const followLabel = main.getByText(/^Follow-up · /);
    // 27 and 29 words, with none of the about-you follow-ups' skip words; the third has 17, under the 20 a follow-up needs.
    await box.fill("I studied commerce and made weekly sales reports in Excel for two years; now I want to analyse data full time and grow with a good team.");
    if (!(await box.inputValue()).startsWith("I studied commerce")) throw new Error("the answer box didn't keep the text");
    await Promise.all([saved(), main.getByRole("button", { name: "Next question", exact: true }).click()]);
    await followLabel.waitFor({ timeout: 15000 });
    await main.getByText(/^Question 1 of 8 · /).waitFor();
    if ((await box.inputValue()) !== "") throw new Error("the follow-up opens with text in the box");
    if (!(await main.getByRole("button", { name: "Skip follow-up", exact: true }).isVisible())) throw new Error("no Skip follow-up");
    await axeOn(q, "mock-interview-follow-up");
    await box.fill("I would start with the weekly sales report, since I already know where its numbers come from and what the team reads in it.");
    await Promise.all([saved(), main.getByRole("button", { name: "Next question", exact: true }).click()]);
    await main.getByText(/^Question 2 of 8 · /).waitFor();
    if (await followLabel.count()) throw new Error("the follow-up stays after Next");
    if ((await box.inputValue()) !== "") throw new Error("question 2 opens with text in the box");
    await box.fill("In my last job I worked with the sales and finance teams every week, and I kept a shared sheet so both teams saw the same numbers and dates.");
    await Promise.all([saved(), main.getByRole("button", { name: "Next question", exact: true }).click()]);
    await followLabel.waitFor({ timeout: 15000 });
    await main.getByText(/^Question 2 of 8 · /).waitFor();
    await main.getByRole("button", { name: "Skip follow-up", exact: true }).click();
    await main.getByText(/^Question 3 of 8 · /).waitFor();
    await box.fill("I would check the duplicates and the blanks first, then the odd values, before any chart.");
    await Promise.all([saved(), main.getByRole("button", { name: "Next question", exact: true }).click()]);
    await main.getByText(/^Question 4 of 8 · /).waitFor();
    if (await followLabel.count()) throw new Error("a short answer got a follow-up");
    await main.getByRole("button", { name: "End and get feedback", exact: true }).click();

    await main.getByRole("heading", { name: "Feedback on your round", exact: true }).waitFor({ timeout: 30000 });
    await main.getByText("You answer in plain words and start in the right place.", { exact: false }).waitFor();
    await main.getByText(/3 of 8 answered/).waitFor();
    if ((await main.locator('[data-feedback-item="answered"]').count()) !== 3) throw new Error("the feedback doesn't show the three answers");
    if ((await main.locator('[data-feedback-item="skipped"]').count()) !== 5) throw new Error("the feedback doesn't show the five skipped");
    if ((await main.getByText("What worked", { exact: true }).count()) !== 3) throw new Error("What worked isn't on each answer");
    if ((await main.getByText("Add next time", { exact: true }).count()) !== 3) throw new Error("Add next time isn't on each answer");
    if ((await main.locator('[data-follow-up="answered"]').count()) !== 1) throw new Error("the answered follow-up isn't in the feedback");
    if ((await main.locator('[data-follow-up="skipped"]').count()) !== 1) throw new Error("the skipped follow-up isn't in the feedback");
    await main.locator('[data-follow-up="answered"]').getByText("I would start with the weekly sales report", { exact: false }).waitFor();
    await main.locator('[data-follow-up="skipped"]').getByText("Follow-up skipped.", { exact: true }).waitFor();
    if (await main.locator('[data-follow-up="skipped"]').getByRole("link").count()) throw new Error("a skipped follow-up has a link");
    const bankLink = main.getByRole("link", { name: "Open it in the bank", exact: true }).first();
    if ((await bankLink.getAttribute("href")) !== "/mock?tab=bank&role=data-analyst") throw new Error("a skipped question doesn't link to the bank");
    const words = (await main.locator("[data-feedback-item]").allInnerTexts()).join("\n");
    if (/\b(score|grade|rating|\d+\s*\/\s*10|ready)\b/i.test(words)) throw new Error("the feedback shows a score or 'ready'");
    await axeOn(q, "mock-interview-feedback");

    const data = await q.request.get(BASE + "/api/account/export").then((r) => r.json());
    if (data.exportVersion !== 36) throw new Error(`export version ${data.exportVersion}`);
    const round = data.mockSessions?.[0];
    if (data.mockSessions?.length !== 1 || round.length !== "full" || !round.endedAt || round.answers?.length !== 3 || !round.summary) throw new Error("the download's mock interview is wrong");
    const ups = round.answers.map((a) => a.followUp);
    if (!ups[0]?.question || !ups[0]?.answer?.startsWith("I would start") || !ups[1]?.question || ups[1].answer !== null || ups[2] !== null) throw new Error("the download's follow-ups are wrong");

    // A skipped question opens the bank for the role.
    await bankLink.click();
    await q.waitForURL(/tab=bank/);
    await main.getByRole("region", { name: "Question bank" }).waitFor({ timeout: 15000 });
  } finally {
    await ctxI.close();
  }
});
// Verified certifications on the profile (pending item 13, dev/profile-certs-plan.md). Asha signs in; four accepted
// certificates go into the database (adding one runs through the Today form, covered by its own tests): a Credly badge
// in her name, a Credly badge for another certificate, a Microsoft Learn link and an expired one. On /me she checks the
// first two with Credly (local test mode answers from fixtures/credly, so nothing calls Credly): one turns Verified with
// Credly with its badge link and keeps focus on its button, the other stays Added by you with the reason. The walk's
// account then opens her /u page: the verified one first, "Added by Asha", never the expired one, the reason, the
// Microsoft link or a credential key, even in the HTML. axe passes, and /me doesn't scroll sideways at 360px.
if (process.env.DATABASE_URL) {
  await step("certifications: check with Credly on Me, verified first on the public profile, nothing private shown", async () => {
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const q = await ctx2.newPage();
    q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
    q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    const email = `certs-${testEmail}`;
    const handle = `ashacerts${Date.now() % 1e8}`;
    const msLink = "https://learn.microsoft.com/api/credentials/share/en-us/AshaRaoWalk/WALKCERT1";
    try {
      await q.goto(BASE + "/sign-in");
      await q.locator('input[name="name"]').fill("Asha Rao");
      await q.locator('input[name="email"]').fill(email);
      await q.locator('form button[type="submit"]').last().click();
      await q.waitForURL(/\/sign-up\/finish/, { timeout: 15000 });
      await q.locator('input[name="age"]').check();
      await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await q.waitForURL(/\/today/, { timeout: 15000 });

      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
      try {
        const [asha] = await sql`select id from users where email like ${email + "%"} order by created_at desc limit 1`;
        if (!asha) throw new Error("Asha's account not found");
        // Earlier walks on this database verified the same fixture badges; one badge counts for one account only.
        await sql`delete from gap_proofs where badge_id like 'c4ed1100-%' and user_id in (select id from users where email like 'certs%' and id <> ${asha.id})`;
        await sql`update users set username = ${handle} where id = ${asha.id}`;
        await sql`insert into user_settings (user_id, profile_visibility) values (${asha.id}, 'signed_in')
          on conflict (user_id) do update set profile_visibility = 'signed_in', show_certifications = true`;
        const add = (certId, url, issuedOn, expiresOn) =>
          sql`insert into gap_proofs (user_id, skill_id, type, status, evidence, cert_id, issued_on, expires_on, credential_key, name_matched, badge_id, verified_at)
            values (${asha.id}, 'aws', 'certification', 'accepted', ${sql.json({ type: "certification", certId, issuer: "walk", url })}, ${certId}, ${issuedOn}, ${expiresOn},
              ${`walk-${certId}-${asha.id}`}, true, ${url.match(/badges\/([0-9a-f-]{36})/)?.[1] ?? null}, now())`;
        await add("aws-cloud-practitioner", "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000002", "2025-06-10", "2028-06-10");
        await add("aws-security-specialty", "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000003", "2026-02-01", null);
        await add("azure-fundamentals", msLink, "2025-11-20", null);
        await add("cka", "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000009", "2023-01-05", "2026-01-05");
      } finally {
        await sql.end();
      }

      await q.goto(BASE + "/me");
      await q.getByText(/Loading…/).first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
      const rail = q.locator("section", { has: q.getByRole("heading", { name: /^Certifications/ }) });
      await rail.getByText("AWS Certified Cloud Practitioner").waitFor({ timeout: 10000 });
      if ((await rail.getByText("Added by you").count()) !== 4) throw new Error("expected 4 certificates Added by you before any check");
      await rail.getByText(/Expired Jan 2026/).waitFor();
      // The Microsoft Learn link can't be checked with Credly.
      if ((await rail.getByRole("button", { name: /Check with Credly/ }).count()) !== 3) throw new Error("expected Check with Credly on the 3 Credly badges only");

      const check = rail.getByRole("button", { name: "Check with Credly: AWS Certified Cloud Practitioner" });
      await check.focus();
      await q.keyboard.press("Enter");
      await rail.getByText("Verified with Credly", { exact: true }).waitFor({ timeout: 15000 });
      await rail.getByRole("link", { name: /See the badge on Credly/ }).waitFor();
      const focused = await q.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
      if (focused === "BODY" || !focused) throw new Error("focus fell to the page after the check");
      if (!/AWS Certified Cloud Practitioner/.test(focused)) throw new Error(`focus moved to ${focused}`);

      await rail.getByRole("button", { name: "Check with Credly: AWS Certified Security – Specialty" }).click();
      await rail.getByText("Check pending, so it doesn't fill the goal yet. The Credly badge is for a different certificate.").waitFor({ timeout: 15000 });
      await rail.getByText(/Added by you, check pending/).waitFor({ timeout: 10000 });
      await rail.getByText("The Credly badge is for a different certificate.", { exact: true }).waitFor({ timeout: 10000 });
      await a11yOn(q, "me-certifications");
      await q.emulateMedia({ colorScheme: "dark" });
      await q.reload();
      await rail.getByText("Verified with Credly", { exact: true }).waitFor({ timeout: 10000 });
      await a11yOn(q, "me-certifications-dark");
      await q.emulateMedia({ colorScheme: "light" });
      await q.setViewportSize({ width: 360, height: 780 });
      await q.reload();
      await rail.getByText("Verified with Credly", { exact: true }).waitFor({ timeout: 10000 });
      if (await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("/me scrolls sideways at 360px");
      await q.screenshot({ path: `${OUT}me-certifications-phone.png`, fullPage: true });
    } finally {
      await ctx2.close();
    }

    // The walk's account opens Asha's profile link.
    await p.goto(BASE + `/u/${handle}`);
    await settled();
    await p.getByRole("heading", { level: 1, name: "Asha Rao" }).waitFor({ timeout: 10000 });
    const certs = p.locator("section", { has: p.getByRole("heading", { name: /^Certifications/ }) });
    const names = await certs.locator("li span.font-semibold").allInnerTexts();
    // The Security Specialty badge Credly didn't confirm waits as check pending, which only Asha sees.
    if (JSON.stringify(names) !== JSON.stringify(["AWS Certified Cloud Practitioner", "Microsoft Certified: Azure Fundamentals (AZ-900)"]))
      throw new Error(`public certifications: ${JSON.stringify(names)}`);
    await certs.getByText("Verified with Credly", { exact: true }).waitFor();
    if ((await certs.getByText("Added by Asha", { exact: true }).count()) !== 1) throw new Error("expected Added by Asha once");
    const badge = await certs.getByRole("link", { name: /See the badge on Credly/ }).getAttribute("href");
    if (badge !== "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000002") throw new Error(`badge link ${badge}`);
    if (await certs.getByRole("button").count()) throw new Error("a visitor sees Check with Credly");
    const html = await p.content();
    for (const bad of ["Certified Kubernetes", "Security – Specialty", "check pending", "learn.microsoft.com", "AshaRaoWalk", "WALKCERT1", "different certificate", "walk-aws", "c4ed1100-0000-4000-8000-000000000003", "Expired"])
      if (html.includes(bad)) throw new Error(`the public profile carries ${bad}`);
    await shot("public-certifications");
    await a11y("public-certifications");

    // A second account, also named Asha Rao, adds the same badge and checks it: it is already verified on Asha's
    // account, so it is held for review, not refused for good. The row leaves the list and focus moves to the
    // Certifications heading, never to the page.
    const ctx3 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const r = await ctx3.newPage();
    r.on("pageerror", (e) => problems.push(`pageerror@${r.url()}: ${e.message.slice(0, 200)}`));
    r.on("response", (res) => res.status() >= 500 && problems.push(`${res.status()} ${res.request().method()} ${res.url()}`));
    const email2 = `certs2-${testEmail}`;
    try {
      await r.goto(BASE + "/sign-in");
      await r.locator('input[name="name"]').fill("Asha Rao");
      await r.locator('input[name="email"]').fill(email2);
      await r.locator('form button[type="submit"]').last().click();
      await r.waitForURL(/\/sign-up\/finish/, { timeout: 15000 });
      await r.locator('input[name="age"]').check();
      await r.locator("form", { has: r.locator('input[name="age"]') }).locator('button[type="submit"]').click();
      await r.waitForURL(/\/today/, { timeout: 15000 });
      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
      try {
        const [other] = await sql`select id from users where email like ${email2 + "%"} order by created_at desc limit 1`;
        if (!other) throw new Error("the second account was not found");
        const url = "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000002";
        await sql`insert into gap_proofs (user_id, skill_id, type, status, evidence, cert_id, issued_on, expires_on, credential_key, name_matched, badge_id, verified_at)
          values (${other.id}, 'aws', 'certification', 'accepted', ${sql.json({ type: "certification", certId: "aws-cloud-practitioner", issuer: "walk", url })},
            'aws-cloud-practitioner', '2025-06-10', '2028-06-10', ${`walk-squat-${other.id}`}, true, 'c4ed1100-0000-4000-8000-000000000002', now())`;
      } finally {
        await sql.end();
      }
      await r.goto(BASE + "/me");
      await r.getByText(/Loading…/).first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
      const rail2 = r.locator("section", { has: r.getByRole("heading", { name: /^Certifications/ }) });
      const check2 = rail2.getByRole("button", { name: "Check with Credly: AWS Certified Cloud Practitioner" });
      await check2.focus();
      await r.keyboard.press("Enter");
      await rail2.getByText(/already on another account, so we'll review it/).waitFor({ timeout: 15000 });
      await check2.waitFor({ state: "detached", timeout: 10000 });
      const at = await r.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? "" }));
      if (at.tag === "BODY" || !/Certifications/.test(at.text)) throw new Error(`focus after the held check: ${JSON.stringify(at)}`);
      await a11yOn(r, "me-certifications-held");
    } finally {
      await ctx3.close();
    }
  });
}
// The company the Corporate step sets up, for the company review step after it.
let corpDomain = null;
// Corporate (dev/corporate-plan.md, build steps 1 and 2): a signed-in person sets up a company with a work email on
// an example domain, types the test-mode code (no email sender yet), and lands on Corporate waiting for verification.
// The company admin's browser stays open for the jobs step after the company review.
let corp = null;
let q = null;
const domain = `labs${Date.now()}.example-labs.test`;
await step("corporate: set up a company, confirm the code, wait for verification", async () => {
  corp = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  q = await corp.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  corpDomain = domain;
  {
    await q.goto(BASE + "/today");
    await q.waitForURL(/\/sign-in/);
    await q.locator('input[name="name"]').fill("Meera Iyer");
    await q.locator('input[name="email"]').fill(`corp-${testEmail}`);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL(/\/sign-up\/finish/, { timeout: 15000 });
    await q.locator('input[name="age"]').check();
    await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
    await q.waitForURL(/\/today/, { timeout: 15000 });
    // From the avatar menu's Corporate entry.
    await q.getByRole("button", { name: /open menu$/ }).click();
    await q.getByRole("link", { name: "Corporate", exact: true }).click();
    await q.waitForURL(/\/corporate$/);
    await q.getByRole("link", { name: "Set up your company" }).click();
    await q.waitForURL(/\/corporate\/new/);
    await q.getByRole("heading", { name: "Set up your company on CareerMetro" }).waitFor();
    // Free mail is refused with a plain reason.
    await q.getByLabel("Registered name").fill("Example Labs Private Limited");
    await q.getByLabel("Name candidates see").fill("Example Labs");
    await q.getByLabel("Website").fill(domain);
    await q.getByLabel("Your work email").fill("meera.iyer@gmail.com");
    await q.getByLabel("Company size").selectOption("51 to 200");
    await q.getByLabel("Head office city").fill("Pune");
    await q.getByRole("button", { name: "Continue" }).click();
    await q.getByRole("alert").getByText(/Personal addresses like Gmail/).waitFor();
    await q.getByLabel("Your work email").fill(`meera.iyer@${domain}`);
    await q.getByRole("button", { name: "Continue" }).click();
    const box = q.locator("[data-test-code]");
    await box.waitFor({ timeout: 10000 });
    await q.getByRole("status").filter({ hasText: "Test mode" }).waitFor();
    const code = await box.getAttribute("data-test-code");
    await q.getByLabel("Code", { exact: true }).fill(code);
    await q.getByRole("button", { name: "Verify" }).click();
    await q.getByLabel("About the company").waitFor({ timeout: 10000 });
    await q.getByLabel("About the company").fill("Payments software for co-operative banks.");
    await q.getByRole("button", { name: "Send for review" }).click();
    await q.getByRole("heading", { name: /We check every new company by hand/ }).waitFor({ timeout: 10000 });
    await q.getByRole("link", { name: "Open Corporate" }).click();
    await q.waitForURL(/\/corporate$/);
    await q.getByText("Waiting for verification").first().waitFor({ timeout: 10000 });
    await q.getByText("Add a second admin").waitFor();
    await q.getByRole("heading", { name: "Team and access" }).waitFor();
    await q.getByText(/Verified on/).first().waitFor();
    if ((await q.locator("body").innerText()).includes(`meera.iyer@${domain}`)) throw new Error("work email shown on Corporate");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate.png`, fullPage: true });
    // The same axe check as the other screens, on this page.
    await axeOn(q, "corporate");
    // Phone size in dark mode: no sideways scroll, and the same axe check.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByText("Waiting for verification").first().waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("corporate: horizontal overflow " + overflow + "px");
    await axeOn(q, "corporate-phone-dark");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-phone-dark.png`, fullPage: true });
    if (process.env.DATABASE_URL) {
      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
      try {
        const [org] = await sql`select review_status from organizations where email_domain = ${domain}`;
        if (org?.review_status !== "pending") throw new Error("company not saved as pending");
        const [left] = await sql`select count(*)::int as n from work_email_codes c join users u on u.id = c.user_id where u.email like ${`corp-${testEmail}%`} and c.email is not null`;
        if (left.n !== 0) throw new Error("work email kept after the code was used");
      } finally {
        await sql.end();
      }
    }
  }
});
// Company review (/admin/companies): signed out and a non-admin get the normal not-found page with a 404; the admin
// (the documented local default, admin@careermetro.test, while ADMIN_EMAILS is unset) sees the company the Corporate
// step set up, tries Suspend and cancels, verifies it, and it leaves the list with focus kept on the page.
const signInAs = async (q, name, email) => {
  await q.goto(BASE + "/sign-in");
  await q.locator('input[name="name"]').fill(name);
  await q.locator('input[name="email"]').fill(email);
  await q.locator('form button[type="submit"]').last().click();
  await q.waitForURL(/\/(sign-up\/finish|today)/, { timeout: 15000 });
  // The admin test account is the same on every run: after the first, it is already signed up.
  if (new URL(q.url()).pathname.startsWith("/sign-up/finish")) {
    await q.locator('input[name="age"]').check();
    await q.locator("form", { has: q.locator('input[name="age"]') }).locator('button[type="submit"]').click();
    await q.waitForURL(/\/today/, { timeout: 15000 });
  }
};
const expectNotFound = async (q, who) => {
  const res = await q.goto(BASE + "/admin/companies");
  if (res?.status() !== 404) throw new Error(`${who}: /admin/companies answered ${res?.status()}, not 404`);
  await q.getByRole("heading", { name: "We can't find that page" }).waitFor();
  if (await q.getByText("Company review").count()) throw new Error(`${who}: the review page showed`);
};
await step("company review: not found for others; the admin verifies the new company", async () => {
  if (!corpDomain) throw new Error("the Corporate step set up no company");
  // Signed out.
  const out = await b.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await expectNotFound(await out.newPage(), "signed out");
  } finally {
    await out.close();
  }
  // Signed in, not an admin: not found, and no Admin in the avatar menu.
  const other = await b.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const q = await other.newPage();
    q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
    await signInAs(q, "Ravi Kumar", `notadmin-${testEmail}`);
    await q.getByRole("button", { name: /open menu$/ }).click();
    await q.getByRole("link", { name: "Corporate", exact: true }).waitFor();
    if (await q.getByRole("link", { name: "Admin", exact: true }).count()) throw new Error("Admin shown in a non-admin's menu");
    await expectNotFound(q, "non-admin");
  } finally {
    await other.close();
  }
  // The admin.
  const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await adm.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  try {
    await signInAs(q, "Admin Tester", "admin@careermetro.test");
    await q.getByRole("button", { name: /open menu$/ }).click();
    await q.getByRole("link", { name: "Admin", exact: true }).click();
    await q.waitForURL(/\/admin\/companies$/);
    await q.getByRole("heading", { name: "Company review", level: 1 }).waitFor({ timeout: 15000 });
    const row = q.locator("article", { hasText: corpDomain });
    await row.waitFor();
    await row.getByText("Waiting for verification").waitFor();
    const body = await q.locator("body").innerText();
    // Work-email checks waiting for review show a bare "@domain" (FR-47), never an address with a name before the @.
    if (/[A-Za-z0-9._%+-]@[A-Za-z0-9-]/.test(body)) throw new Error("an email address is shown on the review page");
    const verify = row.getByRole("button", { name: "Verify Example Labs" });
    const box = await verify.boundingBox();
    if (!box || box.height < 44) throw new Error(`Verify is ${box?.height}px tall, under 44px`);
    // Suspend asks first; Cancel puts focus back on Suspend.
    await row.getByRole("button", { name: "Suspend Example Labs" }).click();
    await row.getByRole("button", { name: "Suspend company" }).waitFor();
    if ((await q.evaluate(() => document.activeElement?.textContent?.trim())) !== "Suspend company") throw new Error("confirm step did not take focus");
    await row.getByRole("button", { name: "Cancel" }).click();
    await q.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Suspend Example Labs", null, { timeout: 5000 });
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-admin-companies.png`, fullPage: true });
    await axeOn(q, "admin-companies");
    await verify.click();
    await q.getByRole("status").filter({ hasText: "Example Labs is verified." }).waitFor({ timeout: 10000 });
    await row.waitFor({ state: "detached", timeout: 10000 });
    // The row left; focus moved to the next row's name or the empty-list line, not to the page.
    await q.waitForFunction(() => document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected, null, { timeout: 5000 });
    if (process.env.DATABASE_URL) {
      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
      try {
        const [org] = await sql`select id, review_status, reviewed_by from organizations where email_domain = ${corpDomain}`;
        if (org?.review_status !== "verified" || !/^admin:[0-9a-f-]{36}$/.test(org.reviewed_by ?? "")) throw new Error("review not saved with the admin's id");
        const [audit] = await sql`select count(*)::int as n from audit_logs where target = ${`organization:${org.id}`} and action = 'company_verified'`;
        if (audit.n !== 1) throw new Error("no audit line for the review");
      } finally {
        await sql.end();
      }
    }
    // Phone size in dark mode: no sideways scroll, and the same axe check.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Company review", level: 1 }).waitFor({ timeout: 15000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("admin-companies: horizontal overflow " + overflow + "px");
    await axeOn(q, "admin-companies-phone-dark");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-admin-companies-phone-dark.png`, fullPage: true });
  } finally {
    await adm.close();
  }
});
// Held proofs (/admin/proofs, FR-44): not found when signed out; the admin sees two held certificates set up here in
// the database (a Credly badge already verified on another account, and a reused credential), accepts the first, and
// focus moves to the next row's first button, never to the page. The other account's claim on the badge is rejected.
await step("held proofs: the admin accepts one, and focus moves to the next row", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to set up held proofs");
  const out = await b.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const q = await out.newPage();
    const res = await q.goto(BASE + "/admin/proofs");
    if (res?.status() !== 404) throw new Error(`signed out: /admin/proofs answered ${res?.status()}, not 404`);
  } finally {
    await out.close();
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const run = `e2e-held-${Date.now()}`;
  const hex = Date.now().toString(16).padStart(12, "0").slice(-12);
  const badge = `c4ed1100-0000-4000-8000-${hex}`;
  const proofRow = (userId, key, status, heldReason, checkNote, verifier) => sql`
    insert into gap_proofs (user_id, skill_id, type, status, evidence, cert_id, credential_key, badge_id, held_reason, check_note, verifier, verified_at, name_matched)
    values (${userId}, 'aws', 'certification', ${status}, ${sql.json({ type: "certification", certId: "aws-cloud-practitioner", issuer: "Amazon Web Services", url: `https://www.credly.com/badges/${badge}` })},
      'aws-cloud-practitioner', ${`${run}-${key}`}, ${badge}, ${heldReason}, ${checkNote}, ${verifier}, ${status === "accepted" ? new Date() : null}, true)
    returning id`;
  const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await adm.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  try {
    const person = async (n, first, last) =>
      (await sql`insert into users (email, first_name, last_name, name) values (${`${run}-${n}@example.test`}, ${first}, ${last}, ${`${first} ${last}`}) returning id`)[0].id;
    const holder = await person("a", "Meera", "Iyer");
    const claimant = await person("b", "Walkhold", "Bose");
    const second = await person("c", "Walksecond", "Das");
    const [kept] = await proofRow(holder, "a", "accepted", null, null, "credly");
    const [heldB] = await proofRow(claimant, "b", "pending", "badge_reused", "used_elsewhere", null);
    // Submitted a moment later, so it is the next row.
    const [heldC] = await sql`
      insert into gap_proofs (user_id, skill_id, type, status, evidence, cert_id, credential_key, held_reason, name_matched, created_at)
      values (${second}, 'aws', 'certification', 'pending', ${sql.json({ type: "certification", certId: "aws-cloud-practitioner", issuer: "Amazon Web Services", url: null })},
        'aws-cloud-practitioner', ${`${run}-c`}, 'credential_reused', true, now() + interval '1 second')
      returning id`;

    await signInAs(q, "Admin Tester", "admin@careermetro.test");
    await q.goto(BASE + "/admin/proofs");
    await q.getByRole("heading", { name: "Held proofs", level: 1 }).waitFor({ timeout: 15000 });
    const row = q.locator("article", { hasText: "Walkhold B." });
    await row.waitFor();
    await row.getByText("Its Credly badge is already verified on another account").waitFor();
    const body = await q.locator("body").innerText();
    if (/@/.test(body)) throw new Error("an email address is shown on the held-proof page");
    if (/Bose|Iyer/.test(body)) throw new Error("a full last name is shown on the held-proof page");
    const href = await row.getByRole("link", { name: /Badge page/ }).getAttribute("href");
    if (href !== `https://www.credly.com/badges/${badge}`) throw new Error(`badge link ${href}`);
    const accept = row.getByRole("button", { name: /^Accept for this person: Walkhold B\./ });
    const box = await accept.boundingBox();
    if (!box || box.height < 44) throw new Error(`Accept is ${box?.height}px tall, under 44px`);
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-admin-proofs.png`, fullPage: true });
    await axeOn(q, "admin-proofs");
    await accept.click();
    await q.getByRole("status").filter({ hasText: "Accepted for Walkhold B." }).waitFor({ timeout: 10000 });
    await row.waitFor({ state: "detached", timeout: 10000 });
    // Focus is on the next row's first button (the reused credential), never on the page.
    await q.waitForFunction((id) => document.activeElement?.getAttribute("data-first-action") === id, heldC.id, { timeout: 5000 }).catch(async () => {
      const at = await q.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.slice(0, 40)}`);
      throw new Error(`focus after accept is on ${at}, not the next row's first button`);
    });
    const [b2] = await sql`select status, verifier, held_reason from gap_proofs where id = ${heldB.id}`;
    const [a2] = await sql`select status, held_reason from gap_proofs where id = ${kept.id}`;
    if (b2.status !== "accepted" || b2.verifier !== null || b2.held_reason !== null) throw new Error(`accepted claim saved as ${JSON.stringify(b2)}`);
    if (a2.status !== "rejected" || a2.held_reason !== "claimed_elsewhere") throw new Error(`competing claim saved as ${JSON.stringify(a2)}`);
    const audit = await sql`select action from audit_logs where target in (${`gap_proof:${heldB.id}`}, ${`gap_proof:${kept.id}`}) order by action`;
    if (audit.map((x) => x.action).join(",") !== "proof_accepted,proof_rejected_claimed_elsewhere") throw new Error(`audit lines ${JSON.stringify(audit)}`);
    // Phone size in dark mode: no sideways scroll, and the same axe check.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Held proofs", level: 1 }).waitFor({ timeout: 15000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("admin-proofs: horizontal overflow " + overflow + "px");
    await axeOn(q, "admin-proofs-phone-dark");
  } finally {
    await adm.close();
    await sql`delete from users where email like ${`${run}-%`}`;
    await sql.end();
  }
});
// Reports (/admin/reports, FR-45): not found when signed out; the admin sees a report set up here in the database
// with its reason, the reported message and the deadlines, acknowledges it (focus stays on the row), then marks action
// taken and the row leaves the list. One audit line each.
await step("reports: the admin acknowledges one, then closes it", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to set up a report");
  const out = await b.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const q = await out.newPage();
    const res = await q.goto(BASE + "/admin/reports");
    if (res?.status() !== 404) throw new Error(`signed out: /admin/reports answered ${res?.status()}, not 404`);
  } finally {
    await out.close();
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const run = `e2e-report-${Date.now()}`;
  const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await adm.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  try {
    const person = async (n, first, last) =>
      (await sql`insert into users (email, first_name, last_name, name) values (${`${run}-${n}@example.test`}, ${first}, ${last}, ${`${first} ${last}`}) returning id`)[0].id;
    const reporter = await person("a", "Walkreport", "Rao");
    const other = await person("b", "Walkother", "Sen");
    const [chat] = await sql`insert into conversations (kind, status, started_by) values ('direct', 'open', ${other}) returning id`;
    await sql`insert into conversation_members (conversation_id, user_id, role) values (${chat.id}, ${reporter}, 'member'), (${chat.id}, ${other}, 'member')`;
    const [msg] = await sql`insert into messages (conversation_id, sender_id, body) values (${chat.id}, ${other}, ${`Send me the OTP ${run}`}) returning id`;
    const [rep] = await sql`insert into reports (reporter_id, target, target_id, reason, note) values (${reporter}, 'message', ${msg.id}, 'money_or_otp', 'Asked for my OTP.') returning id`;

    await signInAs(q, "Admin Tester", "admin@careermetro.test");
    await q.goto(BASE + "/admin/reports");
    await q.getByRole("heading", { name: "Reports", level: 1 }).waitFor({ timeout: 15000 });
    const row = q.locator("article", { hasText: `Send me the OTP ${run}` });
    await row.waitFor();
    await row.getByText("Message from Walkother S.").waitFor();
    await row.getByText("Walkreport R.").waitFor();
    // Other steps' reports may be open too, so only this row is checked.
    const body = await row.innerText();
    if (/@/.test(body)) throw new Error("an email address is shown on the reports page");
    if (/Walkreport Rao|Walkother Sen/.test(body)) throw new Error("a full last name is shown on the reports page");
    const ack = row.getByRole("button", { name: /^Acknowledge: / });
    const box = await ack.boundingBox();
    if (!box || box.height < 44) throw new Error(`Acknowledge is ${box?.height}px tall, under 44px`);
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-admin-reports.png`, fullPage: true });
    await axeOn(q, "admin-reports");
    await ack.click();
    await q.getByRole("status").filter({ hasText: "Acknowledged." }).waitFor({ timeout: 10000 });
    await row.getByRole("button", { name: /^Acknowledge: / }).waitFor({ state: "detached", timeout: 10000 });
    // Focus stays on the row: its first button is now Action taken, never the page.
    await q.waitForFunction((id) => document.activeElement?.getAttribute("data-first-action") === id, rep.id, { timeout: 5000 }).catch(async () => {
      const at = await q.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.slice(0, 40)}`);
      throw new Error(`focus after acknowledge is on ${at}, not the row's Action taken button`);
    });
    await row.getByRole("button", { name: /^Action taken: / }).click();
    await q.getByRole("status").filter({ hasText: "Marked as action taken." }).waitFor({ timeout: 10000 });
    await row.waitFor({ state: "detached", timeout: 10000 });
    const [saved] = await sql`select status, acknowledged_at, resolved_at from reports where id = ${rep.id}`;
    if (saved.status !== "actioned" || !saved.acknowledged_at || !saved.resolved_at) throw new Error(`report saved as ${JSON.stringify(saved)}`);
    const audit = await sql`select action from audit_logs where target = ${`report:${rep.id}`} order by action`;
    if (audit.map((x) => x.action).join(",") !== "report_acknowledged,report_actioned") throw new Error(`audit lines ${JSON.stringify(audit)}`);
    // Phone size in dark mode: no sideways scroll, and the same axe check.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Reports", level: 1 }).waitFor({ timeout: 15000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("admin-reports: horizontal overflow " + overflow + "px");
    await axeOn(q, "admin-reports-phone-dark");
  } finally {
    await adm.close();
    await sql`delete from reports where note = 'Asked for my OTP.' and reporter_id in (select id from users where email like ${`${run}-%`})`;
    await sql`delete from conversations where started_by in (select id from users where email like ${`${run}-%`})`;
    await sql`delete from users where email like ${`${run}-%`}`;
    await sql.end();
  }
});
// Reports removal tools (FR-46): the admin hides a reported message with a reason (a blank reason is refused first),
// the row says so in words and focus stays on it; the person who reported it sees the notice in their Inbox and the
// text never reaches the page; then the admin shows it again from the list in force. One audit line each.
await step("reports: the admin hides the reported message, and the other side sees the notice", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to set up a report");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const run = `e2e-hide-${Date.now()}`;
  const reporterEmail = `${run}-a@example.test`;
  const text = `Pay the booking fee first ${run}`;
  const why = "Asked for money to book an interview.";
  const them = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const r = await them.newPage();
  const q = await adm.newPage();
  for (const pg of [r, q]) {
    pg.on("pageerror", (e) => problems.push(`pageerror@${pg.url()}: ${e.message.slice(0, 200)}`));
    pg.on("response", (x) => x.status() >= 500 && problems.push(`${x.status()} ${x.request().method()} ${x.url()}`));
    pg.on("console", (m) => m.type() === "error" && problems.push(`console@${pg.url()}: ${m.text().slice(0, 200)}`));
  }
  try {
    // The person who reports it signs in for real, so their Inbox can be read; the sender is set up in the database.
    await signInAs(r, "Walkhide Rao", reporterEmail);
    const [reporter] = await sql`select id from users where email = ${reporterEmail}`;
    if (!reporter) throw new Error("the reporter's account was not made");
    const [other] = await sql`insert into users (email, first_name, last_name, name) values (${`${run}-b@example.test`}, 'Walksender', 'Sen', 'Walksender Sen') returning id`;
    const [chat] = await sql`insert into conversations (kind, status, started_by) values ('direct', 'open', ${other.id}) returning id`;
    await sql`insert into conversation_members (conversation_id, user_id, role) values (${chat.id}, ${reporter.id}, 'member'), (${chat.id}, ${other.id}, 'member')`;
    const [msg] = await sql`insert into messages (conversation_id, sender_id, body) values (${chat.id}, ${other.id}, ${text}) returning id`;
    const [rep] = await sql`insert into reports (reporter_id, target, target_id, reason, note) values (${reporter.id}, 'message', ${msg.id}, 'money_or_otp', 'Asked me to pay.') returning id`;

    await signInAs(q, "Admin Tester", "admin@careermetro.test");
    await q.goto(BASE + "/admin/reports");
    await q.getByRole("heading", { name: "Reports", level: 1 }).waitFor({ timeout: 15000 });
    // By the row's own heading id: once hidden, the list in force shows the same text in another row.
    const row = q.locator(`article[aria-labelledby="report-${rep.id}"]`);
    await row.waitFor();
    await row.getByRole("button", { name: /^Hide message: / }).click();
    const reason = row.getByLabel("Reason", { exact: true });
    await reason.waitFor();
    if (!(await reason.evaluate((el) => el === document.activeElement))) throw new Error("focus did not move to the reason field");
    await row.getByRole("button", { name: "Hide message", exact: true }).click();
    await row.getByRole("alert").getByText("Write the reason.").waitFor({ timeout: 5000 });
    await reason.fill(why);
    await axeOn(q, "admin-reports-hide");
    await row.getByRole("button", { name: "Hide message", exact: true }).click();
    await q.getByRole("status").filter({ hasText: "Message hidden." }).waitFor({ timeout: 10000 });
    await row.getByText(/^Message hidden \d+ \w+ by .+\. Reason: Asked for money/).waitFor({ timeout: 10000 });
    // Focus is back on the row's button, which now shows the message again; never the page.
    await q.waitForFunction(() => /^Unhide message: /.test(document.activeElement?.getAttribute("aria-label") ?? ""), null, { timeout: 5000 }).catch(async () => {
      const at = await q.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? ""}`);
      throw new Error(`focus after hiding is on ${at}, not the row's Unhide message button`);
    });
    const [saved] = await sql`select body, hidden_at, hidden_reason from messages where id = ${msg.id}`;
    if (saved.body !== text || !saved.hidden_at || saved.hidden_reason !== why) throw new Error("the hide was not saved, or the text was changed");
    const [still] = await sql`select status from reports where id = ${rep.id}`;
    if (still.status !== "open") throw new Error(`hiding closed the report (${still.status})`);
    const hiddenRow = q.locator(`article[aria-labelledby="hidden-${msg.id}"]`);
    await hiddenRow.waitFor();

    // The other side: the notice in place of the text, and the text nowhere in the page.
    await r.goto(BASE + "/inbox");
    await r.getByRole("button", { name: /Walksender Sen/ }).first().click();
    await r.locator('ol[aria-label="Messages"]').getByText("This message was hidden by CareerMetro after a report.").waitFor({ timeout: 10000 });
    if ((await r.content()).includes(text)) throw new Error("the hidden message's text reached the Inbox page");
    await axeOn(r, "inbox-hidden-message");
    await r.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-inbox-hidden-message.png`, fullPage: true });

    // Shown again from the list in force; the row leaves it and the Inbox reads the text again.
    await hiddenRow.getByRole("button", { name: /^Unhide message: / }).click();
    await hiddenRow.getByRole("button", { name: "Unhide message", exact: true }).click();
    await q.getByRole("status").filter({ hasText: "Message shown again." }).waitFor({ timeout: 10000 });
    await hiddenRow.waitFor({ state: "detached", timeout: 10000 });
    const [back] = await sql`select hidden_at from messages where id = ${msg.id}`;
    if (back.hidden_at) throw new Error("the message is still hidden");
    const audit = await sql`select action from audit_logs where target = ${`message:${msg.id}`} order by action`;
    if (audit.map((x) => x.action).join(",") !== "message_hidden,message_unhidden") throw new Error(`audit lines ${JSON.stringify(audit)}`);
    await r.reload();
    await r.getByRole("button", { name: /Walksender Sen/ }).first().click();
    await r.locator('ol[aria-label="Messages"]').getByText(text).waitFor({ timeout: 10000 });
  } finally {
    await them.close();
    await adm.close();
    await sql`delete from reports where reporter_id in (select id from users where email like ${`${run}-%`})`;
    await sql`delete from conversations where started_by in (select id from users where email like ${`${run}-%`})`;
    await sql`delete from users where email like ${`${run}-%`}`;
    await sql.end();
  }
});
// Library review (/admin/library, docs/plans/library-part-2-plan.md): not found when signed out; the admin sees the
// link the walk reported and the link it suggested, hides the reported link (one audit line), and the walk's Library no
// longer shows it; Show again brings it back. The suggestion is declined as off topic. axe passes, phone size in dark.
await step("library review: the admin hides the reported link, and the Library no longer shows it", async () => {
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to read the audit lines");
  if (!libraryReported) throw new Error("the Library step reported no link");
  const out = await b.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const res = await (await out.newPage()).goto(BASE + "/admin/library");
    if (res?.status() !== 404) throw new Error(`signed out: /admin/library answered ${res?.status()}, not 404`);
  } finally {
    await out.close();
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await adm.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  q.on("console", (m) => m.type() === "error" && problems.push(`console@${q.url()}: ${m.text().slice(0, 200)}`));
  let hiddenId = null;
  try {
    await signInAs(q, "Admin Tester", "admin@careermetro.test");
    await q.goto(BASE + "/admin/library");
    await q.getByRole("heading", { name: "Library review", level: 1 }).waitFor({ timeout: 15000 });
    const row = q.locator("article").filter({ has: q.getByRole("heading", { name: libraryReported, exact: true, level: 3 }) });
    await row.waitFor({ timeout: 10000 });
    await row.getByText(/Link is broken · \d+/).waitFor();
    const suggestion = q.locator("article").filter({ hasText: suggestedLink });
    const link = suggestion.getByRole("link", { name: new RegExp(suggestedLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    if ((await link.getAttribute("target")) !== "_blank" || !(await link.getAttribute("rel"))?.includes("noreferrer")) throw new Error("a suggested link doesn't open in a new tab without a referrer");
    await axeOn(q, "admin-library");
    await row.getByRole("button", { name: `Hide link: ${libraryReported}`, exact: true }).click();
    await q.getByRole("status").filter({ hasText: "Hidden. It has left the Library, paths and rides." }).waitFor({ timeout: 10000 });
    await row.getByRole("button", { name: `Show again: ${libraryReported}`, exact: true }).waitFor({ timeout: 10000 });
    [{ id: hiddenId }] = await sql`select id from resources where title = ${libraryReported} and hidden_at is not null`;
    const audit = await sql`select action from audit_logs where target = ${`resource:${hiddenId}`} and action = 'resource_hidden'`;
    if (!audit.length) throw new Error("no audit line for Hide link");
    // The walk's own Library no longer has it, in search or anywhere else.
    await p.goto(BASE + "/library");
    await settled();
    await p.getByRole("searchbox", { name: "Search the Library" }).fill(libraryReported);
    // The search says how many it shows; none of them is the hidden link.
    await p.getByRole("status").filter({ hasText: /^\d+ resources? shown$/ }).waitFor({ timeout: 10000 });
    if (await p.locator("main").first().getByRole("button", { name: libraryReported, exact: true }).count()) throw new Error("the hidden link still shows in the Library");
    // The suggestion is declined with its reason.
    await suggestion.getByLabel(/^Why decline /).selectOption("off_topic");
    await suggestion.getByRole("button", { name: /^Decline: / }).click();
    await q.getByRole("status").filter({ hasText: "Declined." }).waitFor({ timeout: 10000 });
    await suggestion.waitFor({ state: "detached", timeout: 10000 });
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Library review", level: 1 }).waitFor({ timeout: 15000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("admin-library: horizontal overflow " + overflow + "px");
    await axeOn(q, "admin-library-phone-dark");
    // Phone size in dark on the person's Library too.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.goto(BASE + "/library");
    await settled();
    await a11y("library-phone-dark");
  } finally {
    // Show it again, so later steps and runs have the whole catalog.
    if (hiddenId) await sql`update resources set hidden_at = null where id = ${hiddenId}`;
    await sql`delete from resource_reports where user_id in (select id from users where email = ${testEmail})`;
    await sql`delete from resource_suggestions where url = ${suggestedLink}`;
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await adm.close();
    await sql.end();
  }
});
// The job the jobs step posts, for the applications step after it.
let postedTitle = null;
let proofSkill = "";
// Corporate jobs (dev/corporate-plan.md, build step 3): the company review step has verified the company (we set it
// again in the database so this step also runs alone), the admin posts a job from a role profile, opens it after the three checks, it shows on Departures
// with Apply switched off and no member or email, Report this job opens and cancels with focus back, and pausing it
// takes it off Departures.
await step("corporate jobs: post, open, see it on Departures, report, pause", async () => {
  if (!q) throw new Error("no company from the step before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to verify the company");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = (postedTitle = `SOC Analyst L1 ${Date.now()}`);
  try {
    await sql`update organizations set review_status = 'verified', reviewed_at = now(), reviewed_by = 'e2e' where email_domain = ${domain}`;
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByText("Verified company").first().waitFor({ timeout: 10000 });
    await q.getByRole("heading", { name: "Jobs", exact: true }).waitFor();
    await q.getByRole("link", { name: "Post a job" }).click();
    await q.waitForURL(/\/corporate\/jobs\/new$/);
    await q.getByRole("heading", { name: "Post a job", level: 1 }).waitFor();
    await q.getByLabel("Role profile").selectOption("cyber-security-analyst");
    await q.getByLabel("Job title as you post it").fill(title);
    await q.getByLabel("City").fill("Pune");
    // Skills come from our list only: add one nice-to-have from the picker.
    const nice = q.getByLabel("Add a nice-to-have skill");
    await nice.selectOption({ index: 1 });
    const added = await nice.locator("option:checked").innerText();
    await nice.locator("xpath=following-sibling::button").click();
    await q.getByRole("button", { name: `Remove ${added} from Nice to have` }).waitFor();
    // Express apply criteria (pending item 16): proof of one required skill, and a certificate from our list.
    const proofOf = q.getByRole("group", { name: "Proof of required skills" }).getByRole("checkbox").first();
    await proofOf.check();
    proofSkill = (await proofOf.locator("xpath=..").innerText()).trim();
    const cert = q.getByLabel("Add a certificate");
    await cert.selectOption({ label: "CompTIA Security+" });
    await cert.locator("xpath=following-sibling::button").click();
    await q.getByRole("button", { name: "Remove CompTIA Security+ from Express apply criteria" }).waitFor();
    // At the limit of 3 the picker stays focusable (aria-disabled), so focus never drops to the page: after adding the
    // third, and after removing one of three.
    const onPicker = () => cert.evaluate((el) => el === document.activeElement);
    for (const extra of ["Splunk Core Certified User", "Google Cybersecurity Professional Certificate"]) {
      await cert.selectOption({ label: extra });
      await cert.locator("xpath=following-sibling::button").click();
      await q.getByRole("button", { name: `Remove ${extra} from Express apply criteria` }).waitFor();
    }
    if (!(await onPicker())) throw new Error("focus not on the certificate picker after adding the third");
    if ((await cert.getAttribute("aria-disabled")) !== "true") throw new Error("the certificate picker isn't marked full at 3");
    for (const extra of ["Splunk Core Certified User", "Google Cybersecurity Professional Certificate"]) {
      await q.getByRole("button", { name: `Remove ${extra} from Express apply criteria` }).click();
      if (!(await onPicker())) throw new Error("focus not on the certificate picker after removing one");
    }
    await q.getByRole("article").getByText("Express apply asks for").waitFor();
    await q.getByRole("article").getByText(`Proof of ${proofSkill}`).waitFor();
    // Open job stays off until the three ticks.
    if (await q.getByRole("button", { name: "Open job" }).isEnabled()) throw new Error("Open job enabled before the three ticks");
    for (const name of ["This job is real and open now.", "We never ask candidates for a fee, deposit or paid training.", /don't screen people out/])
      await q.getByRole("checkbox", { name }).check();
    await q.getByRole("article").getByRole("heading", { name: title }).waitFor();
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-post-job.png`, fullPage: true });
    await a11yOn(q, "corporate-post-job");
    await q.getByRole("button", { name: "Open job" }).click();
    await q.waitForURL(/\/corporate(#jobs)?$/, { timeout: 15000 });
    const row = q.getByRole("listitem").filter({ has: q.getByRole("heading", { name: title }) });
    await row.getByText("Live on Departures").waitFor({ timeout: 10000 });
    await a11yOn(q, "corporate-jobs");

    await q.goto(BASE + "/departures");
    const card = q.getByRole("article").filter({ has: q.getByRole("heading", { name: title }) });
    await card.waitFor({ timeout: 10000 });
    // This account has no resume, so the card asks for one before applying (the applications step applies for real).
    await card.getByText(/Add your resume first, so Example Labs can see how you match this job/).waitFor();
    await card.getByText("Companies never ask for money").waitFor();
    const text = await card.innerText();
    if (text.includes("@") || text.includes("Meera")) throw new Error("a member or an email shown on the job card");
    await card.getByRole("button", { name: /Report this job/ }).click();
    const first = card.getByRole("radio").first();
    await first.waitFor();
    if (!(await first.evaluate((el) => el === document.activeElement))) throw new Error("focus not on the first reason");
    await card.getByRole("button", { name: "Cancel" }).click();
    const again = card.getByRole("button", { name: /Report this job/ });
    await again.waitFor();
    if (!(await again.evaluate((el) => el === document.activeElement))) throw new Error("focus not back on Report this job");
    await again.click();
    await card.getByRole("radio", { name: "Fake job, scam or spam" }).check();
    await card.getByRole("button", { name: "Send report" }).click();
    await card.getByRole("status").getByText(/Reported/).waitFor({ timeout: 10000 });
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-departures-posted-job.png`, fullPage: true });
    await a11yOn(q, "departures-posted-job");

    // Phone size in dark mode: the form, Corporate's Jobs and Departures fit with no sideways scroll.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    for (const path of ["/corporate/jobs/new", "/corporate", "/departures"]) {
      await q.goto(BASE + path);
      await q.getByRole("heading", { level: 1 }).or(q.getByRole("heading", { name: title })).first().waitFor({ timeout: 10000 });
      const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`${path}: horizontal overflow ${overflow}px`);
      await a11yOn(q, `${path}-phone-dark`);
    }
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-departures-phone-dark.png`, fullPage: true });

    // Pausing takes it off Departures.
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("button", { name: `Pause ${title}` }).click();
    await q.getByRole("status").getByText(/Paused\./).waitFor({ timeout: 10000 });
    await q.goto(BASE + "/departures");
    await q.getByRole("heading", { name: "Departures" }).first().waitFor();
    if (await q.getByRole("heading", { name: title }).count()) throw new Error("paused job still on Departures");

    const [job] = await sql`select id, status, ai_round, criteria from jobs where title = ${title}`;
    if (job?.status !== "paused" || job.ai_round) throw new Error("job not saved as paused with the AI round off");
    if (job.criteria?.verifiedSkills?.length !== 1 || job.criteria?.certificates?.join() !== "comptia-security-plus") throw new Error("criteria not saved: " + JSON.stringify(job.criteria));
    const actions = (await sql`select action from audit_logs where target = ${`job:${job.id}`} order by created_at`).map((r) => r.action);
    if (actions.join() !== "job_opened,job_paused") throw new Error("audit lines: " + actions.join());
    const [reported] = await sql`select count(*)::int as n from reports where target = 'job' and target_id = ${job.id}`;
    if (reported.n !== 1) throw new Error("report not filed");
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-corporate-jobs.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await sql.end();
  }
});
// Applications and the board (dev/corporate-plan.md, build step 4): the company opens the job again, the walk's
// candidate applies from Departures with the consent naming the company, the job team finds them on the board with
// Match to this job in words and no email, moves them to Shortlisted, then closes it with Not this time and a note,
// which the candidate reads on Arrivals.
await step("corporate applications: apply with consent, the board, move a lane, Not this time on Arrivals", async () => {
  if (!q || !postedTitle) throw new Error("no job from the step before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check the events");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  const NOTE = "We need hands-on SIEM for this role. Apply again once SIEM is proved.";
  const EXPRESS_NOTE = "I triage SIEM alerts every week and wrote two incident runbooks. Happy to walk you through one.";
  try {
    // The jobs step paused it; open it again.
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("button", { name: `Open again ${title}` }).click();
    await q.getByRole("status").getByText(/Open again\./).waitFor({ timeout: 10000 });

    // The candidate applies with Express apply (pending item 16): a preview of exactly what the company receives, the
    // criteria as met or not yet, a note, and nothing goes without the consent tick.
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/departures");
    const card = p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
    await card.waitFor({ timeout: 10000 });
    // The card shows the job's criteria for this person: the certificate isn't proved, so it reads Not yet.
    await card.getByText(/Express apply criteria · /).waitFor();
    await card.getByText("CompTIA Security+: Not yet").waitFor();
    const express = card.getByRole("button", { name: `Express apply: ${title}` });
    await express.click();
    const preview = p.getByRole("dialog", { name: "What Example Labs receives" });
    await preview.waitFor();
    // Focus starts inside the dialog, on its heading, never on the page body.
    if (!(await preview.getByRole("heading", { name: "What Example Labs receives" }).evaluate((el) => el === document.activeElement))) throw new Error("focus not on the preview's heading");
    // The company's drawer reads the profile and proof live, and the preview says so (T51).
    await preview.getByText("If you update your profile or add proof later, the company sees the latest.").waitFor();
    await preview.getByRole("heading", { name: "Match to this job" }).waitFor({ timeout: 10000 });
    await preview.getByText(/^(Proved|On resume, not proved|Not on resume)$/).first().waitFor();
    // The criteria, met or not yet, and the warning that unmet ones don't block.
    await preview.getByText("Express apply criteria", { exact: true }).waitFor();
    await preview.getByText(`Proof of ${proofSkill}`).waitFor();
    await preview.getByText("CompTIA Security+", { exact: true }).waitFor();
    await preview.getByText("Not yet").first().waitFor();
    await preview.getByText(/Not met yet doesn't stop you/).waitFor();
    await preview.getByText(/Never sent: your gaps, path, goals, pay, phone, email, notice period, resume lines/).waitFor();
    const previewText = await preview.innerText();
    if (previewText.includes(testEmail)) throw new Error("email shown in the preview");
    // Escape closes it and focus goes back to Express apply; opening again keeps what was written.
    await preview.getByLabel(/A note to Example Labs/).fill("Call me on 98765 43210 any evening.");
    await p.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    if (!(await express.evaluate((el) => el === document.activeElement))) throw new Error("focus not back on Express apply after Escape");
    await express.click();
    await preview.waitFor();
    if ((await preview.getByLabel(/A note to Example Labs/).inputValue()) !== "Call me on 98765 43210 any evening.") throw new Error("the note was lost on closing the preview");
    // The preview is modal: Tab never leaves it.
    for (let k = 0; k < 25; k++) {
      await p.keyboard.press("Tab");
      const where = await p.evaluate(() => (document.activeElement?.closest("dialog") ? "dialog" : document.activeElement === document.body ? "browser" : document.activeElement?.outerHTML.slice(0, 80)));
      if (where !== "dialog" && where !== "browser") throw new Error("Tab left the preview for " + where);
    }
    await preview.getByLabel("When can you join?").selectOption({ label: "Within 30 days" });
    // A phone number in the note is refused, as the headline does.
    await preview.getByRole("button", { name: "Send application" }).click();
    await preview.getByRole("alert").getByText(/Leave out email addresses and phone numbers/).waitFor();
    if (!(await preview.getByRole("alert").evaluate((el) => el === document.activeElement))) throw new Error("focus not on the preview's error");
    await preview.getByLabel(/A note to Example Labs/).fill(EXPRESS_NOTE);
    await preview.getByRole("button", { name: "Send application" }).click();
    await preview.getByRole("alert").getByText(/Tick the box to send this to Example Labs/).waitFor();
    await shot("departures-express-preview");
    await a11y("departures-express-preview");
    // Phone size in dark mode: the preview fits with no sideways scroll at 360px.
    await p.setViewportSize({ width: 360, height: 740 });
    await p.emulateMedia({ colorScheme: "dark" });
    const wide = await preview.evaluate((d) => d.scrollWidth - d.clientWidth);
    const pageWide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1 || pageWide > 1) throw new Error(`preview at 360px: sideways scroll ${wide}px / page ${pageWide}px`);
    await a11y("departures-express-preview-phone-dark");
    await shot("departures-express-preview-phone-dark");
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await preview.getByRole("checkbox", { name: /I agree to send this to Example Labs/ }).check();
    await preview.getByRole("button", { name: "Send application" }).click();
    await preview.waitFor({ state: "hidden", timeout: 15000 });
    const done = card.getByRole("status").getByText("Applied · Applied");
    await done.waitFor({ timeout: 15000 });
    // Focus lands on the confirmation, never on the page body.
    const focused = await p.evaluate(() => (document.activeElement === document.body ? "body" : (document.activeElement?.textContent ?? "")));
    if (!focused.includes("Applied · Applied")) throw new Error("focus after sending: " + focused.slice(0, 80));
    const [sent] = await sql`select a.note from applications a join jobs j on j.id = a.job_id where j.title = ${title}`;
    if (sent?.note !== EXPRESS_NOTE) throw new Error("the note was not saved with the application");

    // Every other job keeps the external link: the roles from company job boards show "Apply on company site", never Express apply.
    await p.getByRole("button", { name: /^Apply on company site/ }).or(p.getByRole("link", { name: /^Apply on company site/ })).first().waitFor();
    if (await p.getByText("Express apply · soon").count()) throw new Error("an external role still offers Express apply");

    // The job team's board.
    await q.goto(BASE + "/corporate");
    await q.getByRole("link", { name: `Board for ${title}, 1 open application` }).click();
    await q.waitForURL(/\/corporate\/jobs\/board\?id=/);
    await q.getByRole("heading", { name: title, level: 1 }).waitFor({ timeout: 10000 });
    const lane = (name) => q.locator("section", { has: q.getByRole("heading", { name, exact: true, level: 2 }) });
    const open = lane("Applied").getByRole("button", { name: /^Priya Sharma/ });
    await open.waitFor();
    await open.getByText(/required proved/).waitFor();
    const body = await q.locator("body").innerText();
    if (body.includes(testEmail) || body.includes("@")) throw new Error("an email address is shown on the board");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-board.png`, fullPage: true });
    await a11yOn(q, "corporate-board");
    await open.click();
    const drawer = q.getByRole("dialog", { name: "Priya Sharma" });
    await drawer.getByText("Never shown to companies", { exact: false }).waitFor({ timeout: 10000 });
    // The company reads the note on the Profile tab, and the criteria on Match to this job.
    await drawer.getByText("Their note").waitFor();
    await drawer.getByText(EXPRESS_NOTE).waitFor();
    const profileHtml = await drawer.innerHTML();
    await drawer.getByRole("tab", { name: "Match to this job" }).click();
    await drawer.getByText(/^(Proved|On resume, not proved|Not on resume)$/).first().waitFor();
    await drawer.getByText("Express apply criteria", { exact: true }).waitFor();
    await drawer.getByText(`Proof of ${proofSkill}`).waitFor();
    if ((await drawer.innerText()).includes(testEmail)) throw new Error("email shown in the candidate drawer");
    // No gaps in the packet the company received: none of the person's gap explanations or readiness words, and no
    // email, goals or path, in the drawer's HTML on either tab.
    const drawerHtml = profileHtml + (await drawer.innerHTML());
    const [cand] = await sql`select a.user_id as id from applications a join jobs j on j.id = a.job_id where j.title = ${title}`;
    const analyses = await sql`select ga.result from gap_analyses ga join profiles pr on pr.id = ga.profile_id join resumes r on r.id = pr.resume_id where r.user_id = ${cand.id}`;
    const gapTexts = analyses.flatMap(({ result }) => [
      // The person's own gap words: why each skill is a gap, and how ready they are. (A requirement is the role's text, and a
      // quote can be a certificate name the public profile lists, so neither is checked.)
      ...(result.gaps ?? []).map((g) => g.explanation),
      result.readiness?.headline,
      result.readiness?.explanation,
    ]).filter((t) => typeof t === "string" && t.length > 12);
    if (!gapTexts.length) throw new Error("no gap texts to check the drawer against");
    const leaked = gapTexts.filter((t) => drawerHtml.includes(t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) || drawerHtml.includes(t));
    if (leaked.length) throw new Error("gap text in the company's drawer: " + leaked[0].slice(0, 60));
    if (drawerHtml.includes(testEmail) || /Your goals|Your path|Between you and this role/.test(drawerHtml)) throw new Error("gaps, goals, path or email in the company's drawer");
    await a11yOn(q, "corporate-candidate");
    // The drawer is modal: Tab never leaves it. Arrow keys move between its tabs. Escape closes it, focus back on the card.
    for (let k = 0; k < 15; k++) {
      await q.keyboard.press("Tab");
      // Past the last control the browser's own toolbar takes focus (the page reports body); never the page behind.
      const where = await q.evaluate(() => (document.activeElement?.closest("dialog") ? "dialog" : document.activeElement === document.body ? "browser" : document.activeElement?.outerHTML.slice(0, 80)));
      if (where !== "dialog" && where !== "browser") throw new Error("Tab left the candidate drawer for " + where);
    }
    await drawer.getByRole("tab", { name: "Match to this job" }).focus();
    await q.keyboard.press("ArrowRight");
    if ((await drawer.getByRole("tab", { name: "Interviews" }).getAttribute("aria-selected")) !== "true") throw new Error("ArrowRight did not move to the next tab");
    await q.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await q.waitForFunction(() => document.activeElement?.textContent?.startsWith("PSPriya Sharma") || document.activeElement?.textContent?.startsWith("Priya Sharma"), null, { timeout: 5000 });
    await open.click();
    await drawer.getByText("Never shown to companies", { exact: false }).waitFor({ timeout: 10000 });
    // The L1 AI lane is off for this job.
    if (!(await drawer.locator('option[value="ai"]').evaluate((o) => o.disabled))) throw new Error("the L1 AI lane is offered while it is off");
    await drawer.getByLabel("Move to").selectOption("shortlisted");
    await drawer.getByRole("button", { name: "Move", exact: true }).click();
    await q.getByRole("status").getByText(/Moved Priya Sharma to Shortlisted/).waitFor({ timeout: 10000 });
    await lane("Shortlisted").getByRole("button", { name: /^Priya Sharma/ }).click();
    await drawer.getByRole("button", { name: "Not this time" }).click();
    // A note is required.
    await drawer.getByRole("button", { name: "Send Not this time" }).click();
    await drawer.getByRole("alert").getByText(/Add a short note/).waitFor();
    await drawer.getByLabel(/Note for Priya/).fill(NOTE);
    // Escape doesn't throw away a note being written.
    await q.keyboard.press("Escape");
    await drawer.getByRole("alert").getByText(/Send the note or press Cancel first/).waitFor();
    if ((await drawer.getByLabel(/Note for Priya/).inputValue()) !== NOTE) throw new Error("the note was lost on Escape");
    await drawer.getByRole("button", { name: "Send Not this time" }).click();
    await q.getByRole("status").getByText(/Not this time, with your note/).waitFor({ timeout: 10000 });
    await lane("Not this time").getByRole("button", { name: /^Priya Sharma/ }).waitFor();

    // Phone size in dark mode: the board fits with no sideways scroll.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: title, level: 1 }).waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("board: horizontal overflow " + overflow + "px");
    await a11yOn(q, "corporate-board-phone-dark");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-board-phone-dark.png`, fullPage: true });

    // The candidate reads it on Arrivals, with the company's note.
    await p.goto(BASE + "/arrivals");
    const mine = p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
    await mine.waitFor({ timeout: 10000 });
    await p.locator("section", { has: p.getByRole("heading", { name: "Not this time", exact: true }) }).getByRole("heading", { name: title }).waitFor();
    await mine.getByText(NOTE).waitFor();
    await mine.getByText("Example Labs moved you to Shortlisted").waitFor();
    // The bell says so too (docs/plans/notifications-plan.md): the move and the closing make one row, the closing line.
    const bell = p.locator("header button[data-bell]");
    if ((await bell.getAttribute("aria-label")) !== "Notifications, 1 new") throw new Error(`the bell reads ${await bell.getAttribute("aria-label")}`);
    await bell.click();
    await p.getByRole("link", { name: `New: Example Labs closed your application for ${title}. Their note is on Arrivals.`, exact: false }).waitFor({ timeout: 10000 });
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.activeElement?.hasAttribute("data-bell"), null, { timeout: 5000 });
    if ((await bell.getAttribute("aria-label")) !== "Notifications") throw new Error("the bell still reads new after opening");
    await shot("arrivals");
    await a11y("arrivals");
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.reload();
    await mine.waitFor({ timeout: 10000 });
    const pOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (pOverflow > 1) throw new Error("arrivals: horizontal overflow " + pOverflow + "px");
    await a11y("arrivals-phone-dark");
    await shot("arrivals-phone-dark");
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-corporate-applications.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await sql.end();
    await p.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await p.emulateMedia({ colorScheme: "light" }).catch(() => {});
  }
});
// Company chats (dev/corporate-plan.md, build step 5): within 30 days of Not this time the job team still writes. The
// admin opens the candidate on the board, goes to the chat, sends a message and asks a question; the candidate finds
// it in their Inbox with the verified badge and the anti-scam line and replies; the company reads the reply; an
// Interviewer on the job sees no chat and nowhere to write.
await step("company chats: the job team writes from the board, the candidate replies in the Inbox, an Interviewer can't send", async () => {
  if (!q || !postedTitle) throw new Error("no application from the step before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to add the interviewer");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  const HELLO = "Thanks for applying, Priya. We'd still like to hear about your SIEM practice.";
  const QUESTION = "Which SIEM tools have you used so far?";
  const REPLY = "Splunk on the BOTS data set, about forty searches so far.";
  let iv = null;
  try {
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("link", { name: /^Messages( \d+ unread)?$/ }).waitFor({ timeout: 10000 });
    await q.getByRole("link", { name: new RegExp(`^Board for ${title}`) }).click();
    await q.waitForURL(/\/corporate\/jobs\/board\?id=/);
    const lane = (name) => q.locator("section", { has: q.getByRole("heading", { name, exact: true, level: 2 }) });
    await lane("Not this time").getByRole("button", { name: /^Priya Sharma/ }).click();
    const drawer = q.getByRole("dialog", { name: "Priya Sharma" });
    await drawer.getByRole("link", { name: "Message Priya" }).click();
    await q.waitForURL(/\/corporate\/messages\?application=/, { timeout: 15000 });
    const appId = new URL(q.url()).searchParams.get("application");
    const chat = q.getByRole("region", { name: "Priya Sharma" });
    await chat.waitFor({ timeout: 10000 });
    await chat.getByText("Companies never ask for money", { exact: false }).waitFor();
    await chat.getByText("Applied on CareerMetro.").waitFor();
    // A message, then a question.
    await chat.getByRole("textbox", { name: "Message" }).fill(HELLO);
    await chat.getByRole("button", { name: "Send" }).click();
    await chat.getByText(HELLO).waitFor({ timeout: 10000 });
    // Screen readers hear it went, politely.
    await chat.locator('[role="status"][aria-live="polite"]').filter({ hasText: /^Sent\.$/ }).waitFor({ state: "attached", timeout: 5000 });
    await chat.getByRole("button", { name: "Ask a question" }).click();
    await chat.getByRole("textbox", { name: "Question" }).fill(QUESTION);
    await chat.getByRole("button", { name: "Send" }).click();
    await chat.getByText(QUESTION).waitFor({ timeout: 10000 });
    const body = await q.locator("body").innerText();
    if (body.includes(testEmail) || body.includes("@")) throw new Error("an email address is shown in Corporate Messages");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-messages.png`, fullPage: true });
    await a11yOn(q, "corporate-messages");
    // Back goes to the board with the drawer shut: the link closed it the way Close does.
    await q.goBack();
    await q.waitForURL(/\/corporate\/jobs\/board\?id=/, { timeout: 10000 });
    await lane("Not this time").getByRole("button", { name: /^Priya Sharma/ }).waitFor({ timeout: 10000 });
    await q.waitForTimeout(500);
    if (await drawer.isVisible()) throw new Error("Back from Messages opened the candidate drawer again");
    await q.goForward();
    await chat.getByText(QUESTION).waitFor({ timeout: 10000 });

    // The candidate: the chat in the Inbox, from Example Labs with the verified badge and the anti-scam line.
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/inbox");
    await p.getByRole("button", { name: /Example Labs/ }).first().click();
    const thread = p.getByRole("region", { name: "Chat with Example Labs" });
    await thread.getByText(QUESTION).waitFor({ timeout: 10000 });
    await thread.getByText("Verified company", { exact: true }).waitFor();
    await thread.getByText(/Example Labs is a verified company\. Companies never ask for money, OTPs or bank details/).waitFor();
    await thread.getByText(HELLO).waitFor();
    await thread.getByText("Question", { exact: true }).waitFor();
    await thread.getByText(/^Meera Iyer · Example Labs/).first().waitFor();
    await thread.getByRole("textbox", { name: "Message" }).fill(REPLY);
    await thread.getByRole("button", { name: "Send" }).click();
    await thread.getByText(REPLY).waitFor({ timeout: 10000 });
    await p.locator('[role="status"][aria-live="polite"]').filter({ hasText: /^Sent\.$/ }).waitFor({ state: "attached", timeout: 5000 });
    await shot("inbox-company-chat");
    await a11y("inbox-company-chat");
    // Report and Block are there on a company chat (opened and cancelled here; the store tests file them).
    await thread.getByRole("button", { name: "Block or report" }).click();
    await thread.getByRole("checkbox", { name: /Also block Example Labs/ }).waitFor();
    await thread.getByRole("button", { name: "Cancel" }).click();

    // The reply reaches the open chat with the 30-second check, and is read out politely.
    await chat.getByText(REPLY).waitFor({ timeout: 45000 });
    await chat.locator('[role="status"][aria-live="polite"]').filter({ hasText: /^New message from Priya Sharma$/ }).waitFor({ state: "attached", timeout: 5000 });
    // The company reads the reply.
    await q.reload();
    await chat.getByText(REPLY).waitFor({ timeout: 10000 });

    // Phone size in dark mode: Corporate Messages and the chat fit with no sideways scroll.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await chat.waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("corporate messages: horizontal overflow " + overflow + "px");
    await a11yOn(q, "corporate-messages-phone-dark");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-messages-phone-dark.png`, fullPage: true });
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });

    // An Interviewer on the job: no chats to read until they are on the candidate's interview, and nowhere to write.
    iv = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const ivp = await iv.newPage();
    ivp.on("pageerror", (e) => problems.push(`pageerror@${ivp.url()}: ${e.message.slice(0, 200)}`));
    ivp.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    const ivEmail = `iv-${testEmail}`;
    await signInAs(ivp, "Sana Qureshi", ivEmail);
    const [ivUser] = await sql`select id from users where email like ${ivEmail + "%"} order by created_at desc limit 1`;
    const [org] = await sql`select id, email_domain from organizations where email_domain = ${domain}`;
    const [job] = await sql`select id from jobs where title = ${title}`;
    await sql`insert into org_members (org_id, user_id, role, work_email_domain, work_email_verified_at, recheck_due_at)
      values (${org.id}, ${ivUser.id}, 'interviewer', ${org.email_domain}, now(), now() + interval '180 days')`;
    await sql`insert into job_team (job_id, user_id, role) values (${job.id}, ${ivUser.id}, 'interviewer')`;
    await ivp.goto(BASE + "/corporate/messages");
    await ivp.getByText(/Interviewers read the chats of candidates whose interviews they are on/).waitFor({ timeout: 10000 });
    await ivp.goto(BASE + `/corporate/messages?application=${appId}`);
    await ivp.getByRole("alert").getByText("That chat isn't available.").waitFor({ timeout: 10000 });
    if (await ivp.getByRole("textbox", { name: /Message|Question/ }).count()) throw new Error("an Interviewer was offered a box to write in");
    const ivText = await ivp.locator("body").innerText();
    if (ivText.includes(HELLO) || ivText.includes(REPLY)) throw new Error("an Interviewer read the chat");
    await a11yOn(ivp, "corporate-messages-interviewer");

    const [conv] = await sql`select c.id, c.org_id, c.kind from conversations c where c.application_id = ${appId}`;
    if (conv?.kind !== "application" || conv.org_id !== org.id) throw new Error("the chat isn't the company's");
    const kinds = (await sql`select m.kind, (m.sender_id = a.user_id) as from_candidate from messages m join conversations c on c.id = m.conversation_id join applications a on a.id = c.application_id where c.id = ${conv.id} order by m.created_at`).map((m) => `${m.kind}${m.from_candidate ? ":candidate" : ""}`);
    if (kinds.join() !== "system,text,ask_question,text:candidate") throw new Error("messages: " + kinds.join());
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-company-chats.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await iv?.close();
    await sql.end();
    await p.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await p.emulateMedia({ colorScheme: "light" }).catch(() => {});
  }
});
// Interviews (dev/corporate-plan.md, build step 6): the admin opens Priya again and asks for times from the drawer; she
// offers one in the Inbox; the admin books it with Sana (an Interviewer on the job); Priya accepts on Arrivals and
// chooses to share a phone; it shows as Next up and on the 10-day strip. Sana now sees Priya read only (board, drawer
// with the phone, chat with nowhere to write) and leaves feedback; the job team reads it. Then Not this time again,
// which cancels the interview still ahead.
await step("interviews: ask for times, the candidate offers one, book it, accept with a phone, the interviewer's feedback", async () => {
  if (!q || !postedTitle) throw new Error("no application from the steps before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check the interview");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  const PHONE = "98765 43210";
  const FEEDBACK = "Walked through a phishing alert end to end; clear on Splunk searches, thin on cloud logs.";
  const NOTE = "We went with someone with more cloud log work. Apply again once that is proved.";
  let iv = null;
  try {
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("link", { name: "Interviews", exact: true }).waitFor({ timeout: 10000 });
    await q.getByRole("link", { name: new RegExp(`^Board for ${title}`) }).click();
    await q.waitForURL(/\/corporate\/jobs\/board\?id=/);
    const boardUrl = q.url();
    const lane = (name) => q.locator("section", { has: q.getByRole("heading", { name, exact: true, level: 2 }) });
    await lane("Not this time").getByRole("button", { name: /^Priya Sharma/ }).click();
    const drawer = q.getByRole("dialog", { name: "Priya Sharma" });
    await drawer.getByLabel("Open again in").selectOption("shortlisted");
    await drawer.getByRole("button", { name: "Move", exact: true }).click();
    await q.getByRole("status").getByText(/Moved Priya Sharma to Shortlisted/).waitFor({ timeout: 10000 });

    // Ask for times from the drawer's Interviews tab.
    await lane("Shortlisted").getByRole("button", { name: /^Priya Sharma/ }).click();
    await drawer.getByRole("tab", { name: "Interviews" }).click();
    await drawer.getByRole("button", { name: "Ask for times" }).click();
    await drawer.getByRole("status").getByText(/Asked for times in Messages/).waitFor({ timeout: 10000 });
    await drawer.getByText(/Waiting for the candidate to pick some/).waitFor({ timeout: 10000 });
    await a11yOn(q, "corporate-drawer-interviews");
    await drawer.getByRole("button", { name: "Close" }).click();

    // The candidate offers one time in the Inbox; only that time reaches the company.
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/inbox");
    await p.getByRole("button", { name: /Example Labs/ }).first().click();
    const thread = p.getByRole("region", { name: "Chat with Example Labs" });
    await thread.getByText("Asking for interview times").waitFor({ timeout: 10000 });
    await thread.getByRole("button", { name: "Offer times" }).click();
    const firstSlot = thread.locator('[aria-label="Pick times"] button:not([disabled])').first();
    const slotName = await firstSlot.getAttribute("aria-label");
    await firstSlot.click();
    await thread.getByRole("button", { name: "Send 1 time" }).click();
    await thread.getByText(/You offered 1 time:/).waitFor({ timeout: 10000 });
    await shot("inbox-offered-times");
    await a11y("inbox-offered-times");

    // The admin books it with Sana on the scheduler.
    const [app] = await sql`select a.id from applications a join jobs j on j.id = a.job_id where j.title = ${title}`;
    const ivEmail = `iv-${testEmail}`;
    await q.goto(BASE + `/corporate/interviews?application=${app.id}`);
    await q.getByRole("heading", { name: "Schedule Priya Sharma", level: 1 }).waitFor({ timeout: 10000 });
    const offeredCell = q.getByRole("radio", { name: new RegExp(`^${slotName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    await offeredCell.click();
    await q.getByRole("radio", { name: "30 min" }).check();
    await q.getByRole("checkbox", { name: /Sana Qureshi/ }).check();
    await q.getByRole("button", { name: "Book interview" }).click();
    await q.getByRole("status").getByText(/^Booked /).waitFor({ timeout: 10000 });
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-scheduler.png`, fullPage: true });
    await a11yOn(q, "corporate-scheduler");
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Schedule Priya Sharma", level: 1 }).waitFor({ timeout: 10000 });
    const sOverflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sOverflow > 1) throw new Error("scheduler: horizontal overflow " + sOverflow + "px");
    await a11yOn(q, "corporate-scheduler-phone-dark");
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });

    // The candidate accepts on Arrivals and chooses to share a phone; Next up and the 10-day strip show it.
    await p.goto(BASE + "/arrivals");
    await p.getByText("Next up", { exact: true }).waitFor({ timeout: 10000 });
    await p.getByRole("list", { name: "The next 10 days" }).getByRole("listitem", { name: /1 interview$/ }).waitFor();
    const mine = p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
    await mine.getByRole("button", { name: /^Accept the interview on / }).click();
    const share = mine.getByRole("checkbox", { name: /^Share my phone with Example Labs's Recruiter admins, Hiring HR on this job, and this interview's interviewers/ });
    // Focus goes to the choice to share; Not now puts it back on Accept.
    await p.waitForFunction(() => document.activeElement?.getAttribute("type") === "checkbox", null, { timeout: 5000 });
    await mine.getByRole("button", { name: "Not now" }).click();
    await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Accept the interview on"), null, { timeout: 5000 });
    await mine.getByRole("button", { name: /^Accept the interview on / }).click();
    await share.check();
    await mine.getByLabel("Mobile number").fill(PHONE);
    await mine.getByRole("button", { name: "Accept interview" }).click();
    await p.getByRole("status").getByText(/^Accepted: /).waitFor({ timeout: 10000 });
    await mine.getByText(/Your phone is shared with Example Labs's Recruiter admins, Hiring HR on this job/).waitFor({ timeout: 10000 });
    await mine.getByRole("button", { name: "Stop sharing" }).waitFor();
    await shot("arrivals-interview");
    await a11y("arrivals-interview");
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.reload();
    await p.getByText("Next up", { exact: true }).waitFor({ timeout: 10000 });
    const aOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (aOverflow > 1) throw new Error("arrivals with interviews: horizontal overflow " + aOverflow + "px");
    await a11y("arrivals-interview-phone-dark");
    await shot("arrivals-interview-phone-dark");
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });

    // Sana, an Interviewer on it: Priya on the board, read only, with the phone; the chat to read; her own feedback.
    iv = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const ivp = await iv.newPage();
    ivp.on("pageerror", (e) => problems.push(`pageerror@${ivp.url()}: ${e.message.slice(0, 200)}`));
    ivp.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    await signInAs(ivp, "Sana Qureshi", ivEmail);
    await ivp.goto(boardUrl);
    await ivp.getByText(/Interviewers see only the candidates assigned to them/).waitFor({ timeout: 10000 });
    await ivp.getByRole("button", { name: /^Priya Sharma/ }).click();
    const ivDrawer = ivp.getByRole("dialog", { name: "Priya Sharma" });
    await ivDrawer.getByText("Interviewers can't change stages.").waitFor({ timeout: 10000 });
    if (await ivDrawer.getByLabel(/Move to|Open again in/).count()) throw new Error("an Interviewer was offered a move");
    await ivDrawer.getByText("+91 98765 43210 (shared for an accepted interview)").waitFor();
    await ivDrawer.getByRole("tab", { name: "Interviews" }).click();
    if (await ivDrawer.getByRole("button", { name: /Ask for times|Cancel interview/ }).count()) throw new Error("an Interviewer was offered Ask for times or Cancel");
    await ivDrawer.getByRole("button", { name: "Write feedback" }).click();
    await ivDrawer.getByRole("radio", { name: "Move forward", exact: true }).check();
    await ivDrawer.getByLabel(/What you saw/).fill(FEEDBACK);
    await ivDrawer.getByRole("button", { name: "Save feedback" }).click();
    await ivDrawer.getByRole("status").getByText(/Feedback saved/).waitFor({ timeout: 10000 });
    await ivDrawer.getByText(FEEDBACK).waitFor({ timeout: 10000 });
    await a11yOn(ivp, "corporate-drawer-interviewer");
    await ivDrawer.getByRole("link", { name: "Read the chat" }).click();
    await ivp.waitForURL(/\/corporate\/messages\?application=/, { timeout: 15000 });
    const ivChat = ivp.getByRole("region", { name: "Priya Sharma" });
    await ivChat.getByText(/Interviewers can read this chat/).waitFor({ timeout: 10000 });
    if (await ivp.getByRole("textbox", { name: /Message|Question/ }).count()) throw new Error("an Interviewer was offered a box to write in");
    if (await ivp.getByRole("button", { name: "Ask for times" }).count()) throw new Error("an Interviewer was offered Ask for times");
    await ivp.goto(BASE + "/corporate/interviews");
    await ivp.getByText("You are interviewing", { exact: false }).waitFor({ timeout: 10000 });
    await a11yOn(ivp, "corporate-interviews-interviewer");

    // The job team reads Sana's feedback on Corporate Interviews.
    await q.goto(BASE + "/corporate/interviews");
    await q.getByRole("heading", { name: "Interviews", level: 1 }).waitFor({ timeout: 10000 });
    await q.getByText(FEEDBACK).waitFor({ timeout: 10000 });
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-interviews.png`, fullPage: true });
    await a11yOn(q, "corporate-interviews");
    if ((await q.locator("body").innerText()).includes("@")) throw new Error("an email address is shown on Corporate Interviews");

    const [row] = await sql`select i.status, i.phone_shared, a.phone_shared as sealed, (select count(*)::int from interview_feedback f where f.interview_id = i.id) as feedback,
      (select count(*)::int from interview_interviewers x where x.interview_id = i.id) as interviewers
      from interviews i join applications a on a.id = i.application_id where a.id = ${app.id}`;
    if (row?.status !== "accepted" || !row.phone_shared || row.feedback !== 1 || row.interviewers !== 1) throw new Error("interview not saved: " + JSON.stringify({ ...row, sealed: undefined }));
    if (!String(row.sealed).startsWith("v2:") || String(row.sealed).includes("98765")) throw new Error("the phone isn't stored sealed");
    const [slots] = await sql`select count(*)::int as n from candidate_slots where application_id = ${app.id}`;
    if (slots.n !== 1) throw new Error("offered slots: " + slots.n);
    // No phone, feedback or name in an address the walk visited.
    for (const u of [p.url(), q.url(), ivp.url()]) if (/98765|Priya|Sana|phishing/i.test(decodeURIComponent(u))) throw new Error("personal data in a URL: " + u);

    // Not this time again: the interview still ahead is cancelled, and the phone is no longer shown.
    await q.goto(boardUrl);
    await lane("Shortlisted").getByRole("button", { name: /^Priya Sharma/ }).click();
    await drawer.getByRole("button", { name: "Not this time" }).click();
    await drawer.getByLabel(/Note for Priya/).fill(NOTE);
    await drawer.getByRole("button", { name: "Send Not this time" }).click();
    await q.getByRole("status").getByText(/Not this time, with your note/).waitFor({ timeout: 10000 });
    const [after] = await sql`select status from interviews where application_id = ${app.id}`;
    if (after?.status !== "cancelled") throw new Error("Not this time left the interview " + after?.status);
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-interviews.png`, fullPage: true }).catch(() => {});
    await p.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-interviews-candidate.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await iv?.close();
    await sql.end();
    await q.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await q.emulateMedia({ colorScheme: "light" }).catch(() => {});
    await p.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await p.emulateMedia({ colorScheme: "light" }).catch(() => {});
  }
});
// Overview, audit and the daily clean-up (dev/corporate-plan.md, build step 7): after the interview step, the admin's
// Overview counts match the database; the admin opens the audit and finds the booking and the cancellation, with no
// contact details; the daily clean-up answers only with its secret, reports counts, and a second run finds nothing more.
await step("overview, audit and the daily clean-up", async () => {
  if (!q || !postedTitle || !corpDomain) throw new Error("no company or application from the steps before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to check the counts");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  try {
    const [org] = await sql`select id from organizations where email_domain = ${corpDomain}`;
    const [job] = await sql`select id from jobs where org_id = ${org.id} and title = ${title}`;
    const [open] = await sql`select count(*)::int as n from jobs where org_id = ${org.id} and status = 'open'`;
    const lanes = await sql`select a.stage, count(*)::int as n from applications a join users u on u.id = a.user_id
      where a.job_id = ${job.id} and a.withdrawn_at is null and u.deletion_requested_at is null group by a.stage`;
    const lane = (stage) => lanes.find((l) => l.stage === stage)?.n ?? 0;
    if (lane("not_this_time") < 1) throw new Error("expected the walk's application in Not this time");

    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    const overview = q.locator("section#overview");
    await overview.getByRole("heading", { name: "Overview", level: 2 }).waitFor({ timeout: 10000 });
    const stat = async (label) => (await overview.locator("div, a").filter({ has: q.getByText(label, { exact: true }) }).last().locator("span.font-display").innerText()).trim();
    if ((await stat("Open jobs")) !== String(open.n)) throw new Error(`Overview open jobs ${await stat("Open jobs")}, database ${open.n}`);
    // The cancelled interview no longer counts this week.
    const [week] = await sql`select count(*)::int as n from interviews i join applications a on a.id = i.application_id
      where a.org_id = ${org.id} and i.status in ('proposed', 'accepted')
        and i.starts_at >= date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
        and i.starts_at < (date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '7 days') at time zone 'Asia/Kolkata'`;
    if ((await stat("Interviews")) !== String(week.n)) throw new Error(`Overview interviews ${await stat("Interviews")}, database ${week.n}`);
    const jobLanes = overview.locator(`dl[aria-label=${JSON.stringify(`${title}: applications per stage`)}]`);
    for (const [stage, label] of [["applied", "Applied"], ["shortlisted", "Shortlisted"], ["not_this_time", "Not this time"]]) {
      const shown = (await jobLanes.locator("div", { has: q.getByText(label, { exact: true }) }).locator("dd").innerText()).trim();
      if (shown !== String(lane(stage))) throw new Error(`Overview ${label}: ${shown}, database ${lane(stage)}`);
    }
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-overview.png`, fullPage: true });
    await a11yOn(q, "corporate-overview");

    // The admin's audit: the booking and the cancellation, by whom, on which application; never contact details.
    await q.getByRole("link", { name: "Audit", exact: true }).click();
    await q.waitForURL(/\/corporate\/audit$/);
    await q.getByRole("heading", { name: "Audit", level: 1 }).waitFor({ timeout: 10000 });
    const lines = q.getByRole("region", { name: "Audit lines" });
    await lines.getByText(/booked an interview/).first().waitFor({ timeout: 10000 });
    await lines.getByText(/cancelled an interview/).first().waitFor({ timeout: 10000 });
    await lines.getByText(/The candidate accepted an interview/).first().waitFor();
    await lines.getByText(new RegExp(`Application [0-9a-f]{8} · ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).first().waitFor();
    const text = await q.locator("main").innerText();
    for (const secret of ["@", "98765", "Priya", "phishing", "Splunk", testEmail]) if (text.includes(secret)) throw new Error("the audit shows " + secret);
    const [stored] = await sql`select count(*)::int as n from audit_logs where org_id = ${org.id} and action in ('interview_booked', 'interview_cancelled')`;
    if (stored.n < 2) throw new Error("audit lines for booking and cancelling: " + stored.n);
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-audit.png`, fullPage: true });
    await a11yOn(q, "corporate-audit");
    await q.setViewportSize({ width: 375, height: 800 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("heading", { name: "Audit", level: 1 }).waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error("audit on a phone: horizontal overflow " + overflow + "px");
    await a11yOn(q, "corporate-audit-phone-dark");
    await q.goto(BASE + "/corporate");
    await q.locator("section#overview").waitFor({ timeout: 10000 });
    const overflow2 = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow2 > 1) throw new Error("overview on a phone: horizontal overflow " + overflow2 + "px");
    await a11yOn(q, "corporate-overview-phone-dark");
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-corporate-overview-phone-dark.png`, fullPage: true });
    // A cursor that is not a time and an id is ignored, and nothing about a person ever goes in the address.
    await q.goto(BASE + "/corporate/audit?before=Priya");
    await q.getByRole("heading", { name: "Audit", level: 1 }).waitFor({ timeout: 10000 });

    // The candidate has no company role: the audit is not theirs.
    await p.goto(BASE + "/corporate/audit");
    await p.getByRole("heading", { name: "You don't have a company role" }).waitFor({ timeout: 10000 });

    // The daily clean-up: the secret from the server's environment, never from a page; counts only.
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("needs CRON_SECRET, as the server has it");
    const refused = await fetch(BASE + "/api/cron/cleanup");
    if (refused.status !== 401) throw new Error("the clean-up ran without its secret: " + refused.status);
    const call = async () => {
      const res = await fetch(BASE + "/api/cron/cleanup", { headers: { authorization: `Bearer ${secret}` } });
      const body = await res.json();
      if (res.status !== 200 || !body.ok) throw new Error("clean-up: " + res.status + " " + JSON.stringify(body));
      for (const k of ["accessEnded", "readMarksCleared", "sharedNumbersErased", "offeredTimesDeleted"]) if (typeof body.corporate?.[k] !== "number") throw new Error("clean-up count missing: " + k);
      return body.corporate;
    };
    const first = await call();
    console.log("     clean-up counts:", JSON.stringify(first));
    const again = await call();
    if (again.accessEnded || again.readMarksCleared || again.sharedNumbersErased || again.offeredTimesDeleted) throw new Error("a second run found more: " + JSON.stringify(again));
    // No shared phone is left on a closed application.
    const [phones] = await sql`select count(*)::int as n from applications where closed_at is not null and phone_shared is not null`;
    if (phones.n) throw new Error("phones left on closed applications: " + phones.n);
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-overview.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await sql.end();
    await q.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await q.emulateMedia({ colorScheme: "light" }).catch(() => {});
  }
});
// Let companies find me (pending item 19): a person turns it on in Settings; the verified company's Recruiter admin
// searches from the walk's open job, opens them and sends a message request, which reaches their Inbox; an Interviewer
// can't search; turning it off takes the person out of the next search at once. The person's resume is added in the
// database (the walk's upload is Priya's, and she applied to this job, so she never shows in its searches).
await step("let companies find me: opt in, a recruiter finds and messages them, an Interviewer can't search, opting out removes them", async () => {
  if (!q || !postedTitle || !corpDomain) throw new Error("no company or job from the steps before");
  if (!process.env.DATABASE_URL) throw new Error("needs DATABASE_URL to add the person's resume");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  const HELLO = "Hello Arjun, your security work matches our SOC Analyst opening in Pune. Would you like to hear more?";
  const fmEmail = `fm-${testEmail}`;
  let fm = null;
  let iv = null;
  try {
    // The person: signed in, with a resume whose skills include the job's first required one.
    fm = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const fp = await fm.newPage();
    fp.on("pageerror", (e) => problems.push(`pageerror@${fp.url()}: ${e.message.slice(0, 200)}`));
    fp.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    await signInAs(fp, "Arjun Mehta", fmEmail);
    const [user] = await sql`select id from users where email like ${fmEmail + "%"} order by created_at desc limit 1`;
    const [org] = await sql`select id from organizations where email_domain = ${corpDomain}`;
    const [job] = await sql`select id, status, requirements from jobs where org_id = ${org.id} and title = ${title}`;
    if (job.status !== "open") await sql`update jobs set status = 'open' where id = ${job.id}`;
    const [skill] = await sql`select name from skills where id = ${job.requirements.required[0] ?? job.requirements.oneOf[0][0]}`;
    const [{ matcher_version: matcher }] = await sql`select matcher_version from gap_analyses order by created_at desc limit 1`;
    const profile = {
      headline: null,
      totalYearsExperience: 3,
      roles: [{ title: "Security operations analyst", employer: "Garuda Logistics", start: "2023-04", end: null, highlights: ["Triaged alerts for 40 branch offices."] }],
      skills: [{ name: skill.name, lastUsed: "2025", evidence: [] }],
      education: [{ qualification: "B.Tech", institution: "Pune University", year: "2022" }],
      certifications: [],
    };
    const analysis = { roleSlug: "cyber-security-analyst", gaps: [], metSkillIds: [], niceToHave: [], readiness: { headline: "h", explanation: "e", estimatedHours: 10 } };
    const [resume] = await sql`insert into resumes (user_id, mime_type, size_bytes, status) values (${user.id}, 'text/plain', 1, 'parsed') returning id`;
    const [prof] = await sql`insert into profiles (resume_id, version, data, confirmed_by_user) values (${resume.id}, 1, ${sql.json(profile)}, true) returning id`;
    await sql`insert into gap_analyses (profile_id, result, matcher_version) values (${prof.id}, ${sql.json(analysis)}, ${matcher})`;
    // The optional city he picked in Settings (T44); companies that can find him filter by it.
    await sql`update users set city = 'Pune' where id = ${user.id}`;

    // Off by default; turned on in Settings > Privacy, with the plain words about what companies see.
    await fp.goto(BASE + "/settings");
    const findMe = fp.getByRole("checkbox", { name: /Let companies find me/ });
    await findMe.waitFor({ state: "attached", timeout: 10000 });
    if (await findMe.isChecked()) throw new Error("Let companies find me starts on");
    await fp.getByText(/Never your email, phone, pay, notice period or resume/).waitFor();
    await findMe.check({ force: true });
    await fp.getByRole("button", { name: "Save changes" }).click();
    await fp.waitForFunction(() => document.activeElement?.textContent === "Settings saved.", null, { timeout: 15000 });

    // The admin finds them from the job: the address holds the job and nothing else.
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("link", { name: "Find people" }).click();
    await q.waitForURL(/\/corporate\/people$/);
    await q.getByRole("heading", { name: "Find people", level: 1 }).waitFor({ timeout: 10000 });
    await q.getByLabel("Match to this job").selectOption(job.id);
    await q.getByRole("button", { name: "Search", exact: true }).click();
    await q.waitForURL(/\/corporate\/people\?job=/);
    // Focus lands on the results heading, never on the page body.
    await q.waitForFunction(() => document.activeElement?.tagName === "H2" && /match/.test(document.activeElement.textContent ?? ""), null, { timeout: 10000 });
    const address = new URL(q.url());
    // Opening that address again fills in the form but runs no search (Testing T41): no limit used, no audit line.
    const searched = async () => (await sql`select count(*)::int as n from audit_logs where org_id = ${org.id} and action = 'people_searched'`)[0].n;
    const before = await searched();
    await q.reload();
    await q.getByRole("heading", { name: "Find people", level: 1 }).waitFor({ timeout: 10000 });
    if ((await q.getByLabel("Match to this job").inputValue()) !== job.id) throw new Error("the address did not fill in the job");
    if (await q.getByRole("button", { name: "View profile of Arjun Mehta" }).count()) throw new Error("opening a search address ran the search");
    if ((await searched()) !== before) throw new Error("opening a search address wrote a people_searched line");
    if ([...address.searchParams.keys()].some((k) => k !== "job") || address.searchParams.get("job") !== job.id) throw new Error("the search address holds more than the job: " + address.search);
    // Filters (T44), one or several together. Verified profiles only: Arjun has proved nothing yet, so no one shows.
    const searchForm = q.getByRole("form", { name: "Search" });
    await searchForm.getByLabel("Verified profiles only").check();
    await q.getByRole("button", { name: "Search", exact: true }).click();
    await q.getByRole("heading", { name: "No one matches yet" }).waitFor({ timeout: 10000 });
    // Experience 2 to 5 years with the target role he aims for and his city: he shows, with that role on his card.
    await searchForm.getByLabel("Verified profiles only").uncheck();
    await searchForm.locator("summary", { hasText: "Target role" }).click();
    await searchForm.getByLabel("Cyber Security Analyst", { exact: true }).check();
    await searchForm.locator("summary", { hasText: "City" }).click();
    await searchForm.getByLabel("Pune", { exact: true }).check();
    await searchForm.getByLabel("2 to 5 years").check();
    // And by name and current company: typed words never go into the address.
    await searchForm.getByLabel("Name", { exact: true }).fill("arjun");
    await searchForm.getByLabel("Current company", { exact: true }).fill("Garuda");
    await q.getByRole("button", { name: "Search", exact: true }).click();
    await q.getByRole("button", { name: "View profile of Arjun Mehta" }).waitFor({ timeout: 10000 });
    await q.getByText("Aiming for Cyber Security Analyst").waitFor();
    const filtered = new URL(q.url());
    const allowed = ["job", "band", "role", "city", "verified", "page"];
    if (
      [...filtered.searchParams.keys()].some((k) => !allowed.includes(k)) ||
      filtered.searchParams.get("role") !== "cyber-security-analyst" ||
      filtered.searchParams.get("band") !== "2-5" ||
      filtered.searchParams.get("city") !== "Pune" ||
      /arjun|garuda/i.test(filtered.search)
    )
      throw new Error("the search address holds more than the job and filters: " + filtered.search);
    const open = q.getByRole("button", { name: "View profile of Arjun Mehta" });
    await open.waitFor({ timeout: 10000 });
    await open.click();
    const drawer = q.getByRole("dialog", { name: "Arjun Mehta" });
    await drawer.getByText(/Match to /).first().waitFor({ timeout: 10000 });
    await drawer.getByText("Security operations analyst · Garuda Logistics").waitFor();
    const seen = await drawer.innerText();
    for (const secret of ["@", "Triaged alerts", fmEmail]) if (seen.includes(secret)) throw new Error("the company sees " + secret);
    await a11yOn(q, "find-people-drawer");
    await drawer.getByLabel("Message request to Arjun").fill(HELLO);
    await drawer.getByRole("button", { name: "Send message request" }).click();
    await q.getByRole("status").getByText(/^Message request sent to Arjun Mehta\./).waitFor({ timeout: 10000 });
    // Focus goes to the line saying it went, never to the page.
    if (await q.evaluate(() => document.activeElement === document.body)) throw new Error("focus dropped to the page after sending");
    await q.getByRole("button", { name: "View profile of Arjun Mehta" }).waitFor();
    await q.getByText("Request sent", { exact: true }).first().waitFor();
    await q.getByRole("heading", { name: "Message requests you sent" }).waitFor();
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-find-people.png`, fullPage: true });
    await a11yOn(q, "find-people");

    // Phone width in dark mode: no sideways scroll.
    await q.setViewportSize({ width: 360, height: 780 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByRole("button", { name: "Search", exact: true }).click();
    await q.getByRole("button", { name: "View profile of Arjun Mehta" }).waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error("find people on a phone: horizontal overflow " + overflow + "px");
    await a11yOn(q, "find-people-phone-dark");
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });

    // The request in the person's Inbox: from a verified company, with why they were found; accepted.
    await fp.goto(BASE + "/inbox");
    await fp.getByRole("button", { name: /Example Labs/ }).first().click();
    const thread = fp.getByRole("region", { name: "Chat with Example Labs" });
    await thread.getByText(HELLO).waitFor({ timeout: 10000 });
    await thread.getByText(/found you in a search/).waitFor();
    await thread.getByText(/found you because you let companies find you/).waitFor();
    await thread.getByText("Verified company", { exact: true }).waitFor();
    await a11yOn(fp, "inbox-found-request");
    await fp.getByRole("button", { name: "Accept" }).click();
    await thread.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 10000 });
    // End chat is on the accepted chat, behind an inline confirm (opened and cancelled here; the store tests end one).
    await thread.getByRole("button", { name: "End chat", exact: true }).click();
    await thread.getByText("End this chat? The company can't message you here again.", { exact: true }).waitFor();
    await thread.getByRole("button", { name: "Cancel", exact: true }).click();
    await thread.getByRole("button", { name: "End chat", exact: true }).waitFor();
    // The company's profile view shows in Settings.
    await fp.goto(BASE + "/settings");
    await fp.locator("[data-company-discovery]").getByText("Example Labs").first().waitFor({ timeout: 10000 });

    // An Interviewer (Sana, added on the job in the company chats step) can't search.
    iv = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const ivp = await iv.newPage();
    ivp.on("pageerror", (e) => problems.push(`pageerror@${ivp.url()}: ${e.message.slice(0, 200)}`));
    ivp.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    await signInAs(ivp, "Sana Qureshi", `iv-${testEmail}`);
    await ivp.goto(BASE + `/corporate/people?job=${job.id}`);
    await ivp.getByRole("heading", { name: "Interviewers can't search for people" }).waitFor({ timeout: 10000 });
    if (await ivp.getByText("Arjun Mehta").count()) throw new Error("an Interviewer saw a person");
    await a11yOn(ivp, "find-people-interviewer");

    // Turning it off takes them out of the next search at once.
    await fp.goto(BASE + "/settings");
    const findMe2 = fp.getByRole("checkbox", { name: /Let companies find me/ });
    await findMe2.waitFor({ state: "attached", timeout: 10000 });
    await findMe2.uncheck({ force: true });
    await fp.getByRole("button", { name: "Save changes" }).click();
    await fp.waitForFunction(() => document.activeElement?.textContent === "Settings saved.", null, { timeout: 15000 });
    await q.reload();
    await q.getByRole("heading", { name: "Find people", level: 1 }).waitFor({ timeout: 10000 });
    await q.getByRole("button", { name: "Search", exact: true }).click();
    await q.getByRole("heading", { name: "No one matches yet" }).waitFor({ timeout: 10000 });
    if (await q.getByRole("button", { name: "View profile of Arjun Mehta" }).count()) throw new Error("opting out did not remove the person from results");

    // In the database: the consent given and withdrawn, the view, and audit lines that name the job only.
    const [consent] = await sql`select given_at, withdrawn_at from consents where user_id = ${user.id} and purpose = 'company_discovery'`;
    if (!consent?.withdrawn_at) throw new Error("the consent was not recorded and withdrawn");
    const [views] = await sql`select count(*)::int as n from company_profile_views where user_id = ${user.id} and org_id = ${org.id}`;
    if (views.n < 1) throw new Error("no profile view recorded");
    const audit = await sql`select action, target from audit_logs where org_id = ${org.id} and action in ('people_searched', 'found_profile_viewed', 'found_request_sent')`;
    for (const action of ["people_searched", "found_profile_viewed", "found_request_sent"]) if (!audit.some((a) => a.action === action)) throw new Error("no audit line for " + action);
    if (audit.some((a) => a.target !== `job:${job.id}`)) throw new Error("an audit line names more than the job: " + audit.map((a) => a.target).join());

    // Blocking the whole company stops its application chats too (Testing T37). Arjun applies to the job; once he
    // blocks Example Labs in Settings, the recruiter's message on that application doesn't reach him, and to the
    // company the chat reads as closed, never as blocked.
    await fp.goto(BASE + "/departures");
    const fcard = fp.getByRole("article").filter({ has: fp.getByRole("heading", { name: title }) });
    await fcard.waitFor({ timeout: 10000 });
    await fcard.getByRole("button", { name: `Express apply: ${title}` }).click();
    const fpreview = fp.getByRole("dialog", { name: "What Example Labs receives" });
    await fpreview.getByRole("heading", { name: "Match to this job" }).waitFor({ timeout: 10000 });
    await fpreview.getByLabel("When can you join?").selectOption({ label: "Within 30 days" });
    await fpreview.getByRole("checkbox", { name: /I agree to send this to Example Labs/ }).check();
    await fpreview.getByRole("button", { name: "Send application" }).click();
    await fpreview.waitFor({ state: "hidden", timeout: 15000 });
    await fcard.getByRole("status").getByText("Applied · Applied").waitFor({ timeout: 15000 });
    const [arjunApp] = await sql`select id from applications where user_id = ${user.id} and job_id = ${job.id}`;
    await fp.goto(BASE + "/settings");
    await fp.locator("[data-company-discovery]").getByRole("button", { name: "Block Example Labs" }).click();
    await fp.getByText("Blocked Example Labs. They won't find or message you.").waitFor({ timeout: 10000 });
    await q.goto(BASE + `/corporate/messages?application=${arjunApp.id}`);
    const blockedChat = q.getByRole("region", { name: "Arjun Mehta" });
    await blockedChat.waitFor({ timeout: 10000 });
    await blockedChat.getByText(/This chat is closed/).waitFor({ timeout: 10000 });
    if (await blockedChat.getByRole("textbox", { name: "Message" }).count()) throw new Error("the company can still write after the person blocked it");
    if ((await blockedChat.innerText()).toLowerCase().includes("block")) throw new Error("the company is told it was blocked");
    const [sent] = await sql`select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id where c.application_id = ${arjunApp.id} and m.kind <> 'system'`;
    if (sent.n !== 0) throw new Error("a company message reached a person who blocked the company");
    await fp.goto(BASE + "/arrivals");
    await fp.getByText(/You blocked Example Labs\. It can.t message you/).waitFor({ timeout: 10000 });
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-find-people.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await fm?.close();
    await iv?.close();
    await sql.end();
    await q.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await q.emulateMedia({ colorScheme: "light" }).catch(() => {});
  }
});
// The candidate withdraws after Not this time (step 4): the company keeps only a count, and the chat closes.
await step("corporate applications: withdraw after Not this time; the company sees a count and the chat closes", async () => {
  if (!q || !postedTitle) throw new Error("no application from the steps before");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const title = postedTitle;
  try {
    await p.goto(BASE + "/arrivals");
    const mine = p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
    await mine.waitFor({ timeout: 10000 });
    await q.goto(BASE + "/corporate");
    await q.getByRole("link", { name: new RegExp(`^Board for ${title}`) }).click();
    await q.waitForURL(/\/corporate\/jobs\/board\?id=/);
    await q.getByRole("heading", { name: title, level: 1 }).waitFor({ timeout: 10000 });

    // Withdrawing stays open after Not this time: the company kept the profile and could reopen it.
    await mine.getByRole("button", { name: `Withdraw ${title} at Example Labs` }).click();
    await mine.getByText("Withdraw? Example Labs stops seeing your profile.").waitFor();
    await mine.getByRole("button", { name: "Withdraw application" }).click();
    await p.getByRole("status").getByText(`Withdrawn: ${title} at Example Labs.`).waitFor({ timeout: 10000 });
    await p.locator("section", { has: p.getByRole("heading", { name: "Withdrawn", exact: true }) }).getByRole("heading", { name: title }).waitFor();
    // The company now sees only a count.
    await q.reload();
    await q.getByText(/1 withdrew/).waitFor({ timeout: 10000 });
    if (await q.getByRole("button", { name: /^Priya Sharma/ }).count()) throw new Error("a withdrawn candidate is still on the board");
    // The chat closes for both sides: gone from Corporate Messages, closed in the candidate's Inbox.
    await q.goto(BASE + "/corporate/messages");
    await q.getByRole("heading", { name: "Messages", level: 1 }).waitFor({ timeout: 10000 });
    if (await q.getByRole("link", { name: /Priya Sharma/ }).count()) throw new Error("a withdrawn candidate's chat is still in Corporate Messages");
    await p.goto(BASE + "/inbox");
    await p.getByRole("button", { name: /Example Labs/ }).first().click();
    await p.getByRole("region", { name: "Chat with Example Labs" }).getByText(/This chat is closed/).waitFor({ timeout: 10000 });

    const [app] = await sql`select a.id, a.stage, a.closed_at, a.withdrawn_at, c.purpose, c.withdrawn_at as consent_withdrawn from applications a join jobs j on j.id = a.job_id join consents c on c.id = a.consent_id where j.title = ${title} order by a.created_at limit 1`;
    if (app?.stage !== "not_this_time" || !app.closed_at || app.purpose !== "job_application") throw new Error("application not saved as closed with its consent");
    if (!app.withdrawn_at || !app.consent_withdrawn) throw new Error("withdrawal not saved on the application and its consent");
    const steps = (await sql`select kind, stage, note from application_events where application_id = ${app.id} order by created_at`).map((e) => `${e.kind}:${e.stage}${e.note ? ":note" : ""}`);
    if (steps.join() !== "applied:applied,moved:shortlisted,moved:not_this_time:note,moved:shortlisted,moved:not_this_time:note,withdrawn:not_this_time") throw new Error("events: " + steps.join());
    // Withdrawing erases a phone shared for an interview (build step 6).
    const [sealed] = await sql`select phone_shared from applications where id = ${app.id}`;
    if (sealed.phone_shared !== null) throw new Error("the shared phone outlived the withdrawal");
    const [viewed] = await sql`select count(*)::int as n from audit_logs where target = ${`application:${app.id}`} and action = 'candidate_viewed'`;
    if (viewed.n < 1) throw new Error("no audit line for opening the candidate");
  } catch (e) {
    await q.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-fail-corporate-applications.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await sql.end();
    await p.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await p.emulateMedia({ colorScheme: "light" }).catch(() => {});
    await corp?.close();
  }
});
await step("phone inbox: list first, chat full screen", async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(BASE + "/inbox?example=1");
  await settled();
  if (await p.getByRole("button", { name: "Back to all messages" }).isVisible()) throw new Error("chat shown before a tap");
  await p.getByRole("button", { name: /Arjun Mehta/ }).click();
  await p.getByRole("button", { name: "Back to all messages" }).waitFor();
  await shot("inbox-phone");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error("horizontal overflow " + overflow + "px");
  await p.getByRole("button", { name: "Back to all messages" }).click();
  await p.getByRole("button", { name: /Arjun Mehta/ }).waitFor();
  await p.setViewportSize({ width: 1280, height: 900 });
});
await step("phone + dark today", async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.goto(BASE + "/today");
  await settled();
  await shot("today-phone-dark");
  await a11y("today-phone-dark");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error("horizontal overflow " + overflow + "px");
});
// Last, so ticking every learning step can't change the ride the earlier steps check.
await step("path finished: says what's next, and the gaps stay open", async () => {
  const gapsUrl = pathUrl.replace("/path/", "/gaps/");
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.emulateMedia({ colorScheme: "light" });
  await p.goto(gapsUrl);
  await settled();
  const before = await p.locator("article").allInnerTexts();
  await p.goto(pathUrl);
  await settled();
  // Signed in, the way on leads to Today before the last step is done, and only one card says what's next.
  await p.getByRole("link", { name: "Continue to Today" }).waitFor({ timeout: 10000 });
  if (await p.getByRole("heading", { name: "Every step done" }).count()) throw new Error("finished card before every step is done");
  for (let left = await p.getByRole("button", { name: /^Mark done: / }).count(); left > 0; left--) {
    await Promise.all([
      p.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/path-steps/")),
      p.getByRole("button", { name: /^Mark done: / }).first().click(),
    ]);
  }
  await p.reload();
  await settled();
  await p.getByRole("heading", { name: "Every step done" }).waitFor({ timeout: 10000 });
  await p.getByRole("link", { name: "Go to Today" }).waitFor();
  if (await p.getByRole("link", { name: "Continue to Today" }).count()) throw new Error("two cards say what's next on a finished path");
  await shot("path-finished");
  await a11y("path-finished");
  await p.goto(gapsUrl);
  await settled();
  const after = await p.locator("article").allInnerTexts();
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("finishing the path changed the gaps");
});
// Last of all: every gap goal proved arrives, whatever Your choice goal is still open (it never holds back the train).
if (process.env.DATABASE_URL) {
  await step("every gap proved arrives, with a Your choice goal still open", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [me] = await sql`select id from users where email like ${testEmail + "%"} order by created_at desc limit 1`;
      if (!me) throw new Error("walk account not found");
      const gaps = await sql`select skill_id from user_goals where user_id = ${me.id} and source = 'gap' and status <> 'skipped'`;
      for (const g of gaps) {
        await sql`insert into gap_proofs (user_id, skill_id, type, status, evidence, verifier, verified_at)
          values (${me.id}, ${g.skill_id}, 'skill_check', 'accepted', ${sql.json({ type: "skill_check", checkId: "walk" })}, 'app', now())`;
      }
      const [open] = await sql`select count(*)::int as n from user_goals where user_id = ${me.id} and source = 'user' and status = 'active'`;
      if (open.n < 1) throw new Error("no open Your choice goal to check against");
    } finally {
      await sql.end();
    }
    await p.goto(BASE + "/today");
    await settled();
    await p.getByText("Every goal on your line is proved.").first().waitFor({ timeout: 10000 });
    await p.locator('section[aria-label="Your goals"]').getByRole("region", { name: "Your choice" }).getByText(choiceSkill, { exact: true }).waitFor({ timeout: 5000 });
    await shot("today-arrived-your-choice");
    await a11y("today-arrived-your-choice");
  });
}
// After everything else, since it saves a new profile version: "I have this" adds the skill as listed only, so it leaves
// the missing keywords and stays a gap with weak evidence.
await step("screening check: confirm a missing keyword, and it stays a weak gap", async () => {
  await p.goto(pathUrl.replace("/path/", "/gaps/"));
  await settled();
  const check = p.locator('section[aria-labelledby="screening-check"]');
  const first = check.getByRole("button", { name: /^I have this: / }).first();
  const name = (await first.getAttribute("aria-label")).replace(/^I have this: /, "");
  await first.click();
  await check.getByRole("button", { name: `Add ${name}`, exact: true }).click();
  await check.getByRole("status").filter({ hasText: `Added ${name} to your skills list` }).waitFor({ timeout: 15000 });
  // The pressed row is gone after the refresh, so focus moves to the section's heading, never to the page.
  await p.waitForFunction(() => document.activeElement?.id === "screening-check", null, { timeout: 15000 });
  await p.reload();
  await settled();
  if (await check.getByRole("button", { name: `I have this: ${name}`, exact: true }).count()) throw new Error("a confirmed keyword is still listed as missing");
  const card = p.locator("article").filter({ hasText: name }).first();
  await card.getByText("Weak evidence").waitFor({ timeout: 10000 });
  await shot("screening-confirmed");
});
// Hardening pass over the screens of #175 to #193 (docs/plans/hardening-pass.md): keyboard paths, axe in light and in
// dark (each dark check reloads first), and no sideways scroll at 390px, where the steps above don't already check
// them. Each step puts back what it changes. Kept together here, after the walk's own steps.
const focusedHas = (q, attr, value) =>
  q.waitForFunction(([a, v]) => document.activeElement?.getAttribute(a) === v, [attr, value], { timeout: 5000 });
const fitsPhone = async (q, what) => {
  const over = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // 1px of slack for sub-pixel rounding, as "phone + dark today" allows.
  if (over > 1) throw new Error(`${what} scrolls sideways at 390px (${over}px)`);
};
await step("hardening: Today with no resume, the role chips and the drop zone by keyboard, light, dark and phone", async () => {
  const fresh = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await fresh.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  try {
    await signInAs(q, "Nisha Rao", `nores-${testEmail}`);
    await q.goto(BASE + "/today");
    const chips = q.getByRole("group", { name: "Target role", exact: true });
    await chips.waitFor({ timeout: 15000 });
    await q.waitForLoadState("networkidle");
    // Space presses a chip; Tab goes on to the next one; Enter presses that one instead.
    await chips.getByRole("button", { name: "Cyber Security Analyst", exact: true }).focus();
    await q.keyboard.press("Space");
    await chips.getByRole("button", { name: "Cyber Security Analyst", exact: true, pressed: true }).waitFor({ timeout: 5000 });
    await q.keyboard.press("Tab");
    await q.waitForFunction(() => document.activeElement?.textContent?.trim() === "Data Analyst", null, { timeout: 5000 });
    await q.keyboard.press("Enter");
    await chips.getByRole("button", { name: "Data Analyst", exact: true, pressed: true }).waitFor({ timeout: 5000 });
    if ((await chips.getByRole("button", { pressed: true }).count()) !== 1) throw new Error("more than one target role is pressed");
    // Paste text and back by keyboard, then Tab reaches the file box, which shows where focus is.
    const how = q.getByRole("group", { name: "How to add your resume" });
    await how.getByRole("button", { name: "Paste text", exact: true }).focus();
    await q.keyboard.press("Enter");
    await q.getByRole("textbox", { name: "Your resume" }).waitFor({ timeout: 5000 });
    await q.keyboard.press("Shift+Tab");
    await q.keyboard.press("Space");
    await q.getByRole("textbox", { name: "Your resume" }).waitFor({ state: "detached", timeout: 5000 });
    await q.getByText("Drop your resume here", { exact: true }).waitFor({ timeout: 5000 });
    await q.keyboard.press("Tab");
    await q.keyboard.press("Tab");
    if ((await q.evaluate(() => document.activeElement?.getAttribute("type"))) !== "file") throw new Error("Tab doesn't reach the file box after the two buttons");
    const ring = await q.evaluate(() => getComputedStyle(document.activeElement.closest("label")).outlineStyle);
    if (ring === "none") throw new Error("the drop zone shows no focus ring");
    await axeOn(q, "hardening-today-no-resume");
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await chips.waitFor({ timeout: 15000 });
    await axeOn(q, "hardening-today-no-resume-dark");
    await q.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ["dark", "light"]) {
      await q.emulateMedia({ colorScheme: scheme });
      await q.reload();
      await chips.waitFor({ timeout: 15000 });
      await fitsPhone(q, `Today with no resume (${scheme})`);
    }
    await axeOn(q, "hardening-today-no-resume-phone");
  } finally {
    await fresh.close();
  }
});
await step("hardening: the Life line by keyboard, light, dark and phone", async () => {
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    const openLife = async () => {
      await p.goto(BASE + "/map");
      await settled();
      const life = p.getByRole("group", { name: "Which map" }).getByRole("button", { name: "Life line", exact: true });
      await life.waitFor({ timeout: 10000 });
      await p.waitForLoadState("networkidle");
      await life.focus();
      await p.keyboard.press("Enter");
      await p.getByRole("group", { name: "Which map" }).getByRole("button", { name: "Life line", exact: true, pressed: true }).waitFor({ timeout: 5000 });
      await p.getByRole("group", { name: "Time range" }).waitFor({ timeout: 10000 });
      await p.locator('main svg g[role="button"]').first().waitFor({ timeout: 10000 });
    };
    await openLife();
    // The Interests row shows the interests from Me as one undated row, or links to Me to add them; never "soon".
    if (await p.locator("main svg").getByText(/interests show here/i).count()) throw new Error("the Interests row still says soon");
    if (!(await p.locator("main svg").getByText(/NO DATES · FROM YOUR PROFILE|No interests yet\. Add them on your profile/).count())) throw new Error("the Interests row shows neither interests nor the link to add them");
    // A moment opens with Enter, and its panel replaces "Your big moments".
    const details = p.getByRole("complementary", { name: "Moment details" });
    await details.getByRole("heading", { name: "Your big moments", level: 3 }).waitFor({ timeout: 10000 });
    const station = p.locator('main svg g[role="button"]').first();
    await station.focus();
    await p.keyboard.press("Enter");
    await p.locator('main svg g[role="button"][aria-pressed="true"]').waitFor({ timeout: 5000 });
    await details.getByRole("heading", { name: "Your big moments", level: 3 }).waitFor({ state: "detached", timeout: 5000 });
    await a11y("hardening-life-line");
    await p.emulateMedia({ colorScheme: "dark" });
    await openLife();
    await a11y("hardening-life-line-dark");
    await p.setViewportSize({ width: 390, height: 844 });
    await openLife();
    await fitsPhone(p, "the Life line (dark)");
    await a11y("hardening-life-line-phone-dark");
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
await step("hardening: Report and Connect on a profile by keyboard, Cancel gives focus back, light, dark and phone", async () => {
  const other = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const r = await other.newPage();
  r.on("pageerror", (e) => problems.push(`pageerror@${r.url()}: ${e.message.slice(0, 200)}`));
  r.on("response", (res) => res.status() >= 500 && problems.push(`${res.status()} ${res.request().method()} ${res.url()}`));
  const NAME = "Kiran Joshi";
  const handle = `kiran-${Date.now().toString(36)}`;
  try {
    await signInAs(r, NAME, `report-${testEmail}`);
    // Kiran opens their profile to everyone signed in, so the walk's person can open it.
    await r.goto(BASE + "/settings");
    await r.getByLabel("Username").fill(handle);
    await r.getByText(/^Available\. After you save/).waitFor({ timeout: 10000 });
    await r.getByLabel("Everyone signed in").check({ force: true });
    await r.getByRole("button", { name: "Save changes" }).click();
    await r.getByText("You have unsaved changes.").waitFor({ state: "detached", timeout: 15000 });

    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    const you = p.getByRole("region", { name: `You and ${NAME}`, exact: true });
    const open = async () => {
      await p.goto(BASE + `/u/${handle}`);
      await you.waitFor({ timeout: 10000 });
      await p.waitForLoadState("networkidle");
    };
    await open();
    // Report: Enter opens the form with focus on its first reason; Tab reaches Send report then Cancel; Cancel puts
    // focus back on Report. Nothing is sent.
    const report = you.getByRole("button", { name: "Report", exact: true });
    const form = you.getByRole("form", { name: `Report ${NAME}` });
    const openReport = async () => {
      await report.focus();
      await p.keyboard.press("Enter");
      await form.waitFor({ timeout: 5000 });
      await p.waitForFunction(() => document.activeElement?.getAttribute("type") === "radio", null, { timeout: 5000 });
    };
    const cancelReport = async () => {
      await form.getByRole("button", { name: "Cancel", exact: true }).focus();
      await p.keyboard.press("Enter");
      await form.waitFor({ state: "detached", timeout: 5000 });
      await focusedHas(p, "data-opens", "report");
    };
    await openReport();
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", null, { timeout: 5000 });
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Send report", null, { timeout: 5000 });
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Cancel", null, { timeout: 5000 });
    await a11y("hardening-profile-report");
    await cancelReport();
    // Connect: the how-you-know pick opens inline; Cancel puts focus back on Connect, and no request goes.
    await you.getByRole("button", { name: "Connect", exact: true }).focus();
    await p.keyboard.press("Enter");
    const pick = you.getByRole("group", { name: `How you know ${NAME}` });
    await pick.waitFor({ timeout: 5000 });
    await pick.getByRole("button", { name: "Cancel", exact: true }).focus();
    await p.keyboard.press("Enter");
    await pick.waitFor({ state: "detached", timeout: 5000 });
    await focusedHas(p, "data-opens", "pick");
    if (await you.getByText("Requested", { exact: true }).count()) throw new Error("Cancel sent a connection request");

    await p.emulateMedia({ colorScheme: "dark" });
    await open();
    await openReport();
    await a11y("hardening-profile-report-dark");
    await cancelReport();
    await p.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ["dark", "light"]) {
      await p.emulateMedia({ colorScheme: scheme });
      await open();
      await openReport();
      await fitsPhone(p, `a profile with Report open (${scheme})`);
      await cancelReport();
    }
  } finally {
    await other.close();
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
await step("hardening: Network's tabs and Find people by keyboard, light, dark and phone", async () => {
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/network");
    await settled();
    const tabs = p.getByRole("tablist", { name: "Your network" });
    await tabs.waitFor({ timeout: 10000 });
    await p.waitForLoadState("networkidle");
    // Arrow keys move along the tabs, and only the selected tab is in the Tab order.
    await tabs.getByRole("tab", { selected: true }).focus();
    const find = tabs.getByRole("tab", { name: /^Find/ });
    for (let k = 0; k < 4 && (await find.getAttribute("aria-selected")) !== "true"; k++) await p.keyboard.press("ArrowRight");
    if ((await find.getAttribute("aria-selected")) !== "true") throw new Error("ArrowRight never reached Find people");
    if ((await p.evaluate(() => document.activeElement?.getAttribute("role"))) !== "tab") throw new Error("focus left the tabs on ArrowRight");
    // Tab goes from the tab to the search box, which shows where focus is, then Search, then the first filter.
    await p.keyboard.press("Tab");
    if ((await p.evaluate(() => document.activeElement?.getAttribute("type"))) !== "search") throw new Error("Tab from Find people doesn't reach the search box");
    const ring = await p.evaluate(() => getComputedStyle(document.activeElement.closest("label")).outlineStyle);
    if (ring === "none") throw new Error("the search box shows no focus ring");
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Search", null, { timeout: 5000 });
    await p.keyboard.press("Tab");
    await focusedHas(p, "aria-pressed", "false");
    // Before a search a filter only waits for one: Space turns it on and off, and nothing is sent.
    await p.keyboard.press("Space");
    await focusedHas(p, "aria-pressed", "true");
    await p.keyboard.press("Space");
    await focusedHas(p, "aria-pressed", "false");
    await a11y("hardening-network-find");
    await p.emulateMedia({ colorScheme: "dark" });
    await p.reload();
    await settled();
    await tabs.waitFor({ timeout: 10000 });
    await a11y("hardening-network-dark");
    await p.setViewportSize({ width: 390, height: 844 });
    await p.reload();
    await settled();
    await tabs.waitFor({ timeout: 10000 });
    await fitsPhone(p, "Network (dark)");
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
await step("hardening: the avatar menu by keyboard, Escape gives focus back, light, dark and phone", async () => {
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    const avatar = p.getByRole("button", { name: /, open menu/ });
    const profile = p.locator("header").getByRole("link", { name: "Your profile", exact: true });
    const openMenu = async () => {
      await p.goto(BASE + "/me");
      await settled();
      await avatar.waitFor({ timeout: 10000 });
      await p.waitForLoadState("networkidle");
      await avatar.focus();
      await p.keyboard.press("Enter");
      await profile.waitFor({ timeout: 5000 });
      if ((await avatar.getAttribute("aria-expanded")) !== "true") throw new Error("the avatar button doesn't say the menu is open");
    };
    const escape = async () => {
      await p.keyboard.press("Escape");
      await profile.waitFor({ state: "hidden", timeout: 5000 });
      await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.includes(", open menu") === true, null, { timeout: 5000 });
    };
    await openMenu();
    // Tab goes into the menu, at its first link.
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.activeElement?.textContent?.trim() === "Your profile", null, { timeout: 5000 });
    await a11y("hardening-avatar-menu");
    await escape();
    await p.emulateMedia({ colorScheme: "dark" });
    await openMenu();
    await a11y("hardening-avatar-menu-dark");
    await escape();
    // On a phone, Network and Library are in the menu, and the open menu fits.
    await p.setViewportSize({ width: 390, height: 844 });
    await openMenu();
    const menu = p.locator("header");
    await menu.getByRole("link", { name: /^Network/ }).waitFor({ timeout: 5000 });
    await menu.getByRole("link", { name: /^Library/ }).waitFor({ timeout: 5000 });
    await fitsPhone(p, "the open avatar menu (dark)");
    await a11y("hardening-avatar-menu-phone-dark");
    await escape();
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
await step("hardening: job search by keyboard on Departures, the notice card in dark at phone width", async () => {
  const sw = p.getByRole("checkbox", { name: "Looking for a job", exact: true });
  const off = p.getByRole("region", { name: "Job search is off" });
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.goto(BASE + "/arrivals");
    await settled();
    await p.getByRole("region", { name: "Notice period" }).waitFor({ timeout: 10000 });
    await fitsPhone(p, "Arrivals with the notice card (dark)");
    await a11y("hardening-arrivals-notice-phone-dark");
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.goto(BASE + "/departures");
    await settled();
    await sw.waitFor({ state: "attached", timeout: 10000 });
    await p.waitForLoadState("networkidle");
    if (!(await sw.isChecked())) throw new Error("job search is off before this step");
    // Space on the switch turns job search off; the paused page's switch has focus.
    await sw.focus();
    await p.keyboard.press("Space");
    await off.waitFor({ timeout: 10000 });
    await p.waitForFunction(() => document.activeElement?.closest("[data-job-search]") != null, null, { timeout: 5000 });
    await p.getByText("Job search is off. Your rides and map keep going.", { exact: true }).waitFor({ timeout: 10000 });
    await p.reload();
    await settled();
    await p.waitForLoadState("networkidle");
    await off.waitFor({ timeout: 10000 });
    await a11y("hardening-departures-search-off-dark");
    await p.setViewportSize({ width: 390, height: 844 });
    await fitsPhone(p, "Departures with job search off (dark)");
    // Space again turns it back on.
    await sw.focus();
    await p.keyboard.press("Space");
    await p.getByText("Job search is on. Departures and Arrivals are back.", { exact: true }).waitFor({ timeout: 10000 });
    await off.waitFor({ state: "detached", timeout: 10000 });
  } finally {
    // Whatever failed above, the walk's person ends with job search on.
    try {
      await p.goto(BASE + "/departures");
      await settled();
      await p.waitForLoadState("networkidle");
      if (await off.count()) {
        await sw.click({ force: true });
        await off.waitFor({ state: "detached", timeout: 10000 });
      }
    } catch {
      // Best effort: the step has already failed and said why.
    }
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
await step("hardening: Settings, Match, Interview prep, Elite and the Inbox in dark at phone width", async () => {
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    for (const path of ["/settings", "/match", "/mock", "/elite", "/inbox"]) {
      await p.goto(BASE + path);
      await settled();
      await p.locator("main").first().waitFor({ timeout: 10000 });
      await fitsPhone(p, `${path} (dark)`);
      await a11y(`hardening${path.replace("/", "-")}-phone-dark`);
    }
  } finally {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
  }
});
// docs/launch/prod-smoke.md 6.1 to 6.3: the Download link in Account settings saves careermetro-data-<date>.json; Sign out
// in the avatar menu lands on the home page signed out, and /today then asks to sign in; signing in again goes straight to
// Today with no name step.
await step("smoke 6: the settings Download link, Sign out from the menu, and back in straight to Today", async () => {
  const ctxS = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const q = await ctxS.newPage();
  q.on("pageerror", (e) => problems.push(`pageerror@${q.url()}: ${e.message.slice(0, 200)}`));
  q.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  const email = `signout-${testEmail}`;
  try {
    await signInAs(q, "Sana Iyer", email);
    await q.goto(BASE + "/settings");
    await q.waitForLoadState("networkidle");
    const link = q.getByRole("region", { name: "Your data", exact: true }).getByRole("link", { name: "Download", exact: true });
    const [download] = await Promise.all([q.waitForEvent("download"), link.click()]);
    if (!/^careermetro-data-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename())) throw new Error(`download named ${download.suggestedFilename()}`);
    if (!JSON.parse(readFileSync(await download.path(), "utf8")).account) throw new Error("the downloaded file has no account");
    await q.goto(BASE + "/today");
    await q.waitForLoadState("networkidle");
    await q.getByRole("button", { name: /open menu$/ }).click();
    await q.getByRole("button", { name: "Sign out", exact: true }).click();
    await q.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    await q.waitForLoadState("networkidle");
    await q.getByRole("link", { name: "Sign in", exact: true }).first().waitFor({ timeout: 15000 });
    await q.goto(BASE + "/today");
    await q.waitForURL(/\/sign-in/, { timeout: 15000 });
    await q.locator('input[name="name"]').fill("Sana Iyer");
    await q.locator('input[name="email"]').fill(email);
    await q.locator('form button[type="submit"]').last().click();
    await q.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
    if (new URL(q.url()).pathname !== "/today") throw new Error(`signing in again went to ${new URL(q.url()).pathname}, not straight to Today`);
  } finally {
    await ctxS.close();
  }
});
if (a11yNotes.length) console.log("ACCESSIBILITY (moderate/minor, not failing):\n" + a11yNotes.join("\n"));
console.log("PROBLEMS:\n" + (problems.join("\n") || "none"));
if (process.env.GITHUB_ACTIONS) for (const pr of problems) console.log(`::error title=e2e problem::${pr.split("\n")[0]}`);
await b.close();
if (failed || problems.length) process.exit(1);
