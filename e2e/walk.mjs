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
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
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
    problems.push(`console@${p.url()}: ${m.text().slice(0, 200)}${m.text().includes("404") ? ` (recent 404s: ${recent404.join(", ")})` : ""}`),
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
let i = 0;
const settled = () =>
  p
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: 60000 })
    .catch(() => {});
const shot = async (name) => p.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-${name}.png`, fullPage: true });
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
  await p.getByRole("link", { name: "Sign in", exact: true }).click();
  await p.waitForURL(/\/sign-in/);
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
  const fresh = await b.newContext({ viewport: { width: 1280, height: 900 } });
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
    for (const path of ["/today", "/map", "/departures", "/inbox", "/me", "/settings"]) {
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
if (a11yNotes.length) console.log("ACCESSIBILITY (moderate/minor, not failing):\n" + a11yNotes.join("\n"));
console.log("PROBLEMS:\n" + (problems.join("\n") || "none"));
await b.close();
if (failed || problems.length) process.exit(1);
