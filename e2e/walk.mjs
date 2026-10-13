// End-to-end walk of the main flow against a running build (see e2e/README.md). Exits non-zero on any failed step,
// browser console error, page error or 5xx response. Screenshots go to e2e/results/.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3211";
const OUT = new URL("./results/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
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
    for (const path of ["/today", "/map", "/departures", "/arrivals", "/inbox", "/me", "/settings"]) {
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
    if ((await drawer.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")) !== "true") throw new Error("ArrowRight did not move to the next tab");
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
    await q.getByRole("link", { name: "Messages", exact: true }).waitFor({ timeout: 10000 });
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

    // An Interviewer on the job: no chats to read yet (assignments come with interviews) and nowhere to write.
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
    await ivp.getByText(/Interviewers read the chats of candidates assigned to them/).waitFor({ timeout: 10000 });
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
    if (steps.join() !== "applied:applied,moved:shortlisted,moved:not_this_time:note,withdrawn:not_this_time") throw new Error("events: " + steps.join());
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
if (a11yNotes.length) console.log("ACCESSIBILITY (moderate/minor, not failing):\n" + a11yNotes.join("\n"));
console.log("PROBLEMS:\n" + (problems.join("\n") || "none"));
await b.close();
if (failed || problems.length) process.exit(1);
