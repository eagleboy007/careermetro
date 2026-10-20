// The signed-in screens the dry run (staging-dry-run.mjs) doesn't reach, on staging or any preview that offers
// "Continue as test user" (docs/staging.md): Network (search, request, accept, and no city on any row), the notification
// bell, the guided resume builder through to Download, Library (Save and "I finished this"), a mock interview round
// started and ended at once, and Departures (save a role and mark it applied). Two fresh test users, each in its own
// browser context, so one can ask the other to connect.
//
//   BASE=https://careermetro-git-staging-career-metro.vercel.app BYPASS=... node scripts/smoke/staging-screens.mjs
//
// The same rules as the dry run: BASE (or the first argument) is the site; BYPASS, when set, is sent as the
// x-vercel-protection-bypass header to that site only, and only when it is a careermetro-*.vercel.app host. The header and
// the test emails are never printed. One line per step, ok or FAIL; the exit code is 1 on any failure. Both test
// accounts are deleted at the end, as prod-smoke.md section 8 says, even after a failure.
// AI spend: the builder's "Review my resume" is one build-resume call; the mock round ends with nothing answered, so it
// asks for no feedback; nothing here uploads a resume or opens gaps. /api/health pings Claude once, as in the dry run.
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
const A = person("a", "Asha", "Indore");
const B = person("b", "Bina", "Pune");

/** Never lets the bypass value or a test email reach the log, whatever an error message carries. */
const redact = (s) => {
  let out = String(s);
  for (const secret of [BYPASS, A.email, A.email.toLowerCase(), B.email, B.email.toLowerCase()]) if (secret) out = out.split(secret).join("[hidden]");
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
/**
 * One browser context per test user, as in the dry run: reduced motion, and the bypass header on every request of the
 * context, so requests to any other host are refused: the header never leaves for a third party (the Vercel toolbar, a
 * font host, a company's job post opened by Apply).
 */
for (const u of [A, B]) {
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
let n = 0;
const failedSteps = new Set();
const path = (p) => {
  try {
    return new URL(p.url()).pathname;
  } catch {
    return "?";
  }
};
/**
 * One line per step, on one user's page (its path is printed and, on a failure, its screenshot kept). A failed
 * `critical` step skips everything after it; `needs` names earlier steps this one can't run without. A step may return
 * a note (such as "skipped: no posts"), printed after its path.
 */
const step = async (name, u, fn, { critical = false, needs = [] } = {}) => {
  const missing = blockedBy || needs.find((s) => failedSteps.has(s));
  if (missing) {
    failed++;
    failedSteps.add(name);
    console.log("FAIL", name, `(skipped: "${missing}" failed)`);
    return false;
  }
  const p = u.page;
  try {
    const note = await fn(p);
    console.log("ok  ", name, "->", path(p), ...(note ? [`(${note})`] : []));
    return true;
  } catch (e) {
    failed++;
    failedSteps.add(name);
    console.log("FAIL", name, "@", path(p), redact(e?.message ?? e).split("\n")[0].slice(0, 300));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Staging screens::${redact(name)}`);
    if (SHOTS) {
      // The email field and any line with a test address are masked.
      const mask = [p.locator('input[type="email"], input[name="email"]'), p.getByText(EMAIL_DOMAIN, { exact: false })];
      await p.screenshot({ path: `${SHOTS}/screens-${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9.-]+/gi, "-")}.png`, fullPage: true, mask }).catch(() => {});
    }
    if (critical) blockedBy = name;
    return false;
  }
};
// The same wait as the walk and the dry run.
const settled = (p) =>
  p
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: 90000 })
    .catch(() => {});
const open = async (p, route) => {
  await p.goto(BASE + route);
  await p.waitForLoadState("networkidle");
  await settled(p);
};
/** A toast or status line with these words (the Library and Departures toasts are role=status). */
const toast = (p, text) => p.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: 15000 });
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
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  return path(p);
};
/** Sign up as a new test user: Create your account with the name, then Today. */
const signUp = async (u) => {
  const p = u.page;
  const landed = await testSignIn(u);
  if (!landed.startsWith("/sign-up/finish")) throw new Error(`a new address should go to Create your account, went to ${landed}`);
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
const row = (p, u) => p.locator("main li[data-person]").filter({ hasText: u.name });
const bell = (p) => p.locator("header button[data-bell]");

await step("1.1 health answers ok", A, async () => {
  const res = await A.ctx.request.get(BASE + "/api/health", { timeout: 60000 });
  if (res.status() === 401 || res.status() === 403) throw new Error(`HTTP ${res.status()}: Deployment Protection blocked it; BYPASS is missing or wrong`);
  const body = await res.json().catch(() => ({}));
  if (res.status() !== 200 || body.ok !== true) {
    throw new Error(`HTTP ${res.status()}: database ${body.database}, schema ${body.schema}, claude ${body.claude}${body.missingSecrets ? `, missing ${body.missingSecrets}` : ""}`);
  }
}, { critical: true });

await step("sign up test user A: Create your account, then Today", A, () => signUp(A), { critical: true });
await step("sign up test user B in a second browser: Create your account, then Today", B, () => signUp(B), { critical: true });

// ---- Network, and the bell -------------------------------------------------------------------------------------------
for (const u of [A, B]) {
  await step(`network 1 ${u.tag.toUpperCase()} picks a Current city in Settings (only companies see it)`, u, async (p) => {
    await open(p, "/settings");
    await p.getByRole("combobox", { name: /^Current city/ }).selectOption(u.city);
    await p.getByRole("button", { name: "Save changes", exact: true }).click();
    await p.getByText("Settings saved.", { exact: true }).waitFor({ state: "attached", timeout: 15000 });
  });
}

await step("network 2 B turns on Let people find me", B, async (p) => {
  await open(p, "/network");
  await p.getByRole("tablist", { name: "Your network", exact: true }).waitFor();
  const findMe = p.getByRole("checkbox", { name: "Let people find me", exact: true });
  await findMe.waitFor({ state: "attached" });
  if (!(await findMe.isChecked())) {
    await findMe.check({ force: true });
    await p.getByText("People can now find you by name.", { exact: true }).waitFor({ timeout: 15000 });
  }
});

await step("network 3 A finds B by name in Find people, with no city on the row", A, async (p) => {
  await open(p, "/network");
  await p.getByRole("tablist", { name: "Your network", exact: true }).getByRole("tab", { name: /^Find/ }).click();
  await p.getByRole("searchbox", { name: "Find people by name or @handle", exact: true }).fill(B.last);
  await p.getByRole("button", { name: "Search", exact: true }).click();
  await row(p, B).waitFor({ timeout: 15000 });
  await noCityOnRows(p);
}, { needs: ["network 2 B turns on Let people find me"] });

await step("network 4 A sends B a request: Connect, How do you know them, Send request", A, async (p) => {
  await row(p, B).getByRole("button", { name: `Connect with ${B.name}`, exact: true }).click();
  await p.getByRole("group", { name: `How you know ${B.name}`, exact: true }).getByRole("button", { name: "Send request", exact: true }).click();
  await p.getByText(`Request sent to ${B.first}. It shows under Sent until they answer.`, { exact: true }).waitFor({ timeout: 15000 });
}, { needs: ["network 3 A finds B by name in Find people, with no city on the row"] });

await step("bell 1 B's bell rings, its list has A's request, and the row opens Network on Requests", B, async (p) => {
  await open(p, "/today");
  await bell(p).waitFor();
  const label = await bell(p).getAttribute("aria-label");
  if (!/^Notifications, \d+ new$/.test(label ?? "")) throw new Error(`the bell reads "${label}", not "Notifications, N new"`);
  await bell(p).click();
  const item = p.getByRole("link", { name: `${A.name} asked to connect.`, exact: false });
  await item.waitFor({ timeout: 15000 });
  await item.click();
  await p.waitForURL(/\/network\?tab=requests/, { timeout: 15000 });
}, { needs: ["network 4 A sends B a request: Connect, How do you know them, Send request"] });

await step("network 5 B accepts on Requests; A's row shows no city before or after", B, async (p) => {
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
  await noCityOnRows(p);
}, { needs: ["network 4 A sends B a request: Connect, How do you know them, Send request"] });

await step("bell 2 A's bell lists B's accept; A's Connections show B with no city", A, async (p) => {
  await open(p, "/today");
  await bell(p).click();
  await p.getByRole("link", { name: `${B.name} accepted your request.`, exact: false }).waitFor({ timeout: 15000 });
  await p.keyboard.press("Escape");
  await open(p, "/network");
  await p.getByRole("tab", { name: /^Connections/, selected: true }).waitFor({ timeout: 15000 });
  await row(p, B).waitFor({ timeout: 15000 });
  await noCityOnRows(p);
}, { needs: ["network 5 B accepts on Requests; A's row shows no city before or after"] });

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
  const tick = panel.getByRole("checkbox", { name: "I finished this" });
  await tick.check();
  await toast(p, "Marked finished.");
  if (!(await tick.isChecked())) throw new Error("I finished this didn't stay ticked");
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

// ---- Clean-up: delete both test accounts, even after a failure ------------------------------------------------------
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
  await p.waitForURL(/\/account\/deleted/, { timeout: 30000 });
  u.deleted = true;
  await p.goto(BASE + "/today");
  await p.waitForURL(/\/sign-in/, { timeout: 30000 });
};

// The clean-up runs whatever failed before it, so a preview never keeps a half-checked account.
blockedBy = "";
for (const u of [B, A]) {
  if (u.signedUp && !u.deleted) await step(`8 delete test user ${u.tag.toUpperCase()}: /account/deleted, then signed out`, u, () => deleteAccount(u));
}

await browser.close();
console.log(failed ? `${failed} step(s) failed on ${BASE}` : `All steps passed on ${BASE}`);
process.exit(failed ? 1 : 0);
