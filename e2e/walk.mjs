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
  "None of our other roles shares at least half its key skills with you yet. The closest, Senior Data Scientist, shares 2 of its 7.";
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
const a11y = async (name) => {
  // A server action's refresh() can still be landing when the check starts, and for that moment the head has no <title>
  // (seen once in CI on inbox-report, never locally). Wait for it; a page that never gets a title still fails below.
  if (!(await p.evaluate(() => document.title))) {
    const back = await p.waitForFunction(() => document.title !== "", null, { timeout: 5000 }).then(() => true, () => false);
    if (back) a11yNotes.push(`${name}: title was empty mid-refresh, then came back`);
  }
  await p.addScriptTag({ content: AXE });
  const result = await p.evaluate(() =>
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
/** The same check on another page (a second signed-in context). */
const a11yOn = async (page, name) => {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() =>
    axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  for (const v of result.violations) {
    const line = `${name}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`;
    if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${line}`);
    else a11yNotes.push(line);
  }
};
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
  await form.getByLabel("Verify link").fill("https://www.credly.com/badges/walk-test");
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
  await form.getByLabel("Verify link").fill("https://www.credly.com/badges/example");
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
for (const path of ["/map", "/me", "/departures", "/settings", "/inbox", "/grievances"]) {
  await step("open " + path, async () => {
    const r = await p.goto(BASE + path);
    if (!r.ok()) throw new Error("status " + r.status());
    await settled();
    await shot(path.slice(1));
    await a11y(path.slice(1));
  });
}
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
// Market (handoff C6, dev/market-plan.md): from the top nav, every card labelled EXAMPLE DATA with its month; search a
// city and a role (Enter takes the first match); open a state from the map; a thin state says "Not enough data"
// instead of figures; Market is in the avatar menu; axe passes in light and dark, with no sideways scroll at 360px.
await step("market: search, open a state, a thin one says Not enough data, every card says example data", async () => {
  await p.goto(BASE + "/today");
  await settled();
  await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Market" }).click();
  await p.waitForURL(/\/market/, { timeout: 15000 });
  await settled();
  await p.getByRole("heading", { name: "Market", level: 1 }).waitFor();
  await p.getByText("Example data", { exact: true }).first().waitFor();
  // Map, trend, pay, top cities and compare each say EXAMPLE DATA and the month.
  const labels = await p.locator("main p").filter({ hasText: /^EXAMPLE DATA · .* · [A-Z][a-z]{2} \d{4}$/ }).count();
  if (labels < 5) throw new Error(`only ${labels} cards say EXAMPLE DATA with a month`);
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
  if (await p.locator("main").getByText("openings a month", { exact: true }).count()) throw new Error("a thin place shows a figure");
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
    await p.getByText("Example data", { exact: true }).first().waitFor();
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
  // Nothing is set yet: no link, the profile starts hidden.
  if (!(await p.getByLabel("Only you").isChecked())) throw new Error("profile visibility does not start at Only you");
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
  if (data.exportVersion !== 12) throw new Error(`export version ${data.exportVersion}`);
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
  await p.getByLabel("Only you").check({ force: true });
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
    for (const path of ["/today", "/map", "/market", "/departures", "/arrivals", "/inbox", "/me", "/settings"]) {
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
    await q.addScriptTag({ content: AXE });
    const result = await q.evaluate(() =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
    );
    for (const v of result.violations) {
      const line = `corporate: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`;
      if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${line}`);
      else a11yNotes.push(line);
    }
    // Phone size in dark mode: no sideways scroll, and the same axe check.
    await q.setViewportSize({ width: 390, height: 844 });
    await q.emulateMedia({ colorScheme: "dark" });
    await q.reload();
    await q.getByText("Waiting for verification").first().waitFor({ timeout: 10000 });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error("corporate: horizontal overflow " + overflow + "px");
    await q.addScriptTag({ content: AXE });
    const dark = await q.evaluate(() =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
    );
    for (const v of dark.violations) {
      const line = `corporate-phone-dark: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`;
      if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${line}`);
      else a11yNotes.push(line);
    }
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
const axeOn = async (q, name) => {
  await q.addScriptTag({ content: AXE });
  const result = await q.evaluate(() =>
    axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  for (const v of result.violations) {
    const line = `${name}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`;
    if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${line}`);
    else a11yNotes.push(line);
  }
};
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
    if (/@/.test(body)) throw new Error("an email address is shown on the review page");
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
// The job the jobs step posts, for the applications step after it.
let postedTitle = null;
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

    const [job] = await sql`select id, status, ai_round from jobs where title = ${title}`;
    if (job?.status !== "paused" || job.ai_round) throw new Error("job not saved as paused with the AI round off");
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
  try {
    // The jobs step paused it; open it again.
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.emulateMedia({ colorScheme: "light" });
    await q.goto(BASE + "/corporate");
    await q.getByRole("button", { name: `Open again ${title}` }).click();
    await q.getByRole("status").getByText(/Open again\./).waitFor({ timeout: 10000 });

    // The candidate applies: nothing goes without the consent tick.
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(BASE + "/departures");
    const card = p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
    await card.waitFor({ timeout: 10000 });
    await card.getByRole("button", { name: `Apply on CareerMetro: ${title}` }).click();
    await card.getByRole("heading", { name: "Example Labs will see" }).waitFor();
    if (!(await card.getByLabel("When can you join?").evaluate((el) => el === document.activeElement))) throw new Error("focus not on the first field of the consent");
    await card.getByLabel("When can you join?").selectOption({ label: "Within 30 days" });
    await card.getByRole("button", { name: "Send application" }).click();
    await card.getByRole("alert").getByText(/Tick the box to share these with Example Labs/).waitFor();
    await shot("departures-apply-consent");
    await a11y("departures-apply-consent");
    await card.getByRole("checkbox", { name: /I agree to share these with Example Labs/ }).check();
    await card.getByRole("button", { name: "Send application" }).click();
    await card.getByRole("status").getByText("Applied · Applied").waitFor({ timeout: 15000 });

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
    await drawer.getByRole("tab", { name: "Match to this job" }).click();
    await drawer.getByText(/^(Proved|On resume, not proved|Not on resume)$/).first().waitFor();
    if ((await drawer.innerText()).includes(testEmail)) throw new Error("email shown in the candidate drawer");
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
    await p.getByRole("heading", { name: "You can't open the audit" }).waitFor({ timeout: 10000 });

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
    const address = new URL(q.url());
    if ([...address.searchParams.keys()].some((k) => !["job", "band", "page"].includes(k)) || address.searchParams.get("job") !== job.id || address.searchParams.get("band")) throw new Error("the search address holds more than the job and band: " + address.search);
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

    const [app] = await sql`select a.id, a.stage, a.closed_at, a.withdrawn_at, c.purpose, c.withdrawn_at as consent_withdrawn from applications a join jobs j on j.id = a.job_id join consents c on c.id = a.consent_id where j.title = ${title}`;
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
if (a11yNotes.length) console.log("ACCESSIBILITY (moderate/minor, not failing):\n" + a11yNotes.join("\n"));
console.log("PROBLEMS:\n" + (problems.join("\n") || "none"));
if (process.env.GITHUB_ACTIONS) for (const pr of problems) console.log(`::error title=e2e problem::${pr.split("\n")[0]}`);
await b.close();
if (failed || problems.length) process.exit(1);
