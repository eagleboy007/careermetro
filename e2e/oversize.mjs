// The oversize check (T150, testing/oversize/max-data-proposal.md): signs in as the synthetic "Max Data" member that
// e2e/max-data/seed.run.ts filled to every cap, and opens each signed-in page at 390x844 and 1280x800, in light and dark.
// It fails on sideways spill (scrollWidth past the window, with the elements that stick out), on a page taller than its
// limit, on the resume PDF taking more than 10 s, and on any page error, console error, 4xx/5xx page or 5xx response.
// A screenshot of every page and size goes to e2e/results/oversize/, its height in the file name. Removes the member at
// the end, after a failure too. The text is synthetic, so the offending elements' text can be printed.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { assertLocalDatabase, cleanMaxData } from "./max-data/clean.mjs";

const BASE = process.env.BASE ?? "http://localhost:3211";
const OUT = new URL("./results/oversize/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const seed = JSON.parse(readFileSync(new URL("./results/max-data.json", import.meta.url), "utf8"));

/**
 * Page height limits in CSS px (the proposal starts every page at 12,000). A page over its limit grows without bound or
 * needs paging. Raised only where the page shows every row by design, at the seed's sizes (record changes here):
 * A page's `phoneLimit`, where it has one, replaces its limit at 390 px.
 * - My jobs, 16,000: the first CI run (2026-10-30) measured 13,586 at 390 px with its 20-row page (T147), each row with
 *   a three-line note (T148) and 160-character title, company and city that wrap. Already paged, so the limit rises.
 * - /me and /u (T162, C23): every list section now shows 3 items, newest first, then "Show N more"; the first run
 *   measured /me at 53,777 (List) and 37,075 (Board) and /u at 20,075 at 390 px. Estimates at 390 px for the full
 *   account, folded: header, stats, plan card and journey about 750; Experience about 3,100 (the 3 newest roles: one or
 *   two resume roles with 8 highlights of 300 characters, about 1,400 each, and added roles with none); Education 3 rows
 *   about 600; Skills 3 chips a column, stacked, about 700; Nearby lines about 800; Interests, Practice confidence and
 *   Proof of work about 600; the rail below (resume card, 3 certificates, who sees what) about 1,100. Stories add about
 *   1,300 on the Board (one row of six columns, 3 closed cards each) or about 3,600 in List (six boxes of 3 cards, about
 *   180 px each). So me-board about 9,000 (limit 12,000) and me-list about 11,300 (limit 14,000). /u shows no
 *   resume lines, journey, plan card, practice or Nearby: about 4,600 (limit 8,000). Retune from the next run's table.
 * - /resume (T162, C23): the profile editor opens one section at a time, About you first, the others a heading and a
 *   summary line. About 1,500 (limit 6,000); the first run, with every field open, measured 35,231.
 */
const DEFAULT_LIMIT = 12_000;
const PAGES = [
  { name: "today", path: "/today" },
  // The seed's own pitstops draw spurs on the line (T172): each spur label must stay inside the map's viewBox.
  { name: "map", path: "/map", spurs: true },
  // T176: the Map with a side panel open, each at the Map's own limit (DEFAULT_LIMIT; the panel sits beside the map at
  // 1280 and under it at 390). The earlier line's panel (C25) lists the seed's MAX_GAPS waiting goals, 80-character
  // names, the first with "3 pitstops added by you, kept": about 20 rows of 60 to 100 px at 390 plus the map, a first
  // estimate. The On your line panel (C13) shows the count and three 40-character connection names, a few hundred px.
  { name: "map-earlier", path: "/map", open: "earlier" },
  { name: "map-people", path: "/map", open: "people" },
  // My jobs: 20 full rows at 1280 px. At 390 px (C24) 10 folded rows of about 80 px before Show more, plus the header,
  // tabs, filters and the add box: about 2,500, an estimate, so 4,000 is the phone height check.
  { name: "my-jobs", path: "/departures?tab=mine", limit: 12_000, phoneLimit: 4_000 },
  { name: "me-board", path: "/me", limit: 12_000 },
  { name: "me-list", path: "/me", limit: 14_000, layout: "List" },
  { name: "profile", path: `/u/${seed.username}`, limit: 8_000 },
  { name: "library", path: "/library" },
  { name: "library-saved", path: "/library?tab=saved" },
  { name: "library-finished", path: "/library?tab=finished" },
  { name: "practice", path: "/practice" },
  { name: "mock", path: "/mock" },
  { name: "inbox", path: "/inbox" },
  { name: "network", path: "/network" },
  // 20 event cards at their caps (230 seeded, 200 kept, then Show more) and the rail: a first estimate (T165). On a
  // phone 10 cards (T168): 20 measured 15,038 at 390, so about 7,600 plus the filters.
  { name: "timetable", path: "/timetable", limit: 20_000, phoneLimit: 12_000 },
  { name: "resume", path: `/resume/${seed.resumeId}`, limit: 6_000 },
  { name: "builder", path: "/builder" },
];
const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const PDF_LIMIT_MS = 10_000;
/** Screenshots stop here; Chromium draws taller pages slowly and the height is in the file name anyway. */
const SHOT_MAX_PX = 16_000;

const failures = [];
const rows = [];
const fail = (line) => {
  failures.push(line);
  console.log("FAIL", line);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=oversize::${line.replace(/\n/g, " ")}`);
};

/** A request through a page's API context, sent again once on a reset socket, never on an HTTP status (as in walk.mjs, T171). */
const api = async (q, method, url, options) => {
  try {
    return await q.request[method](url, options);
  } catch (e) {
    if (!/ECONNRESET|socket hang up/.test(e.message)) throw e;
    return q.request[method](url, options);
  }
};

/** Width, height and, when the page spills sideways, the innermost elements past the window's right edge. */
const measure = (q) =>
  q.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const out = { scrollWidth: doc.scrollWidth, scrollHeight: doc.scrollHeight, innerWidth: vw, offenders: [] };
    if (out.scrollWidth <= vw + 1) return out;
    // Inside a box that scrolls or clips sideways (the Me board, a code block) an element may run past the edge
    // without moving the page, so those are left out.
    const boxed = (el) => {
      for (let a = el.parentElement; a && a !== document.body && a !== doc; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== "visible") return true;
      }
      return false;
    };
    const wide = [...document.body.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && !boxed(el);
    });
    const set = new Set(wide);
    out.offenders = wide
      .filter((el) => ![...el.children].some((c) => set.has(c)))
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") ?? "").slice(0, 100),
        right: Math.round(el.getBoundingClientRect().right),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      }));
    return out;
  });

/**
 * The Map's spur labels (T172): the text of each "Added by you" spur, its getBBox against its SVG's viewBox once the
 * fonts are in. A label past the viewBox is cut off, since the map scales the viewBox to its box.
 */
const spurLabels = (q) =>
  q.evaluate(async () => {
    await document.fonts.ready;
    const texts = [...document.querySelectorAll('svg g[role="button"][aria-label^="Added by you"] text')];
    const outside = [];
    for (const t of texts) {
      const vb = t.ownerSVGElement.viewBox.baseVal;
      const b = t.getBBox();
      if (b.x < vb.x - 0.5 || b.y < vb.y - 0.5 || b.x + b.width > vb.x + vb.width + 0.5 || b.y + b.height > vb.y + vb.height + 0.5) {
        outside.push({
          text: (t.textContent ?? "").trim().slice(0, 40),
          box: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`,
          viewBox: `${vb.x},${vb.y} ${vb.width}x${vb.height}`,
        });
      }
    }
    return { count: texts.length, outside };
  });

/**
 * Opens one of the Map's side panels (T176) from the keyboard, as a person would, so a mark under another one still
 * opens: "earlier" is the earlier line (C25), "people" the On your line count and names (C13), on the pitstop the Map
 * opens on or, failing that, the "you are here" one. Throws when the panel doesn't show what the seed put there.
 */
async function openPanel(q, open) {
  const aside = q.locator('aside[aria-label="Pitstop details"]');
  if (open === "earlier") {
    const mark = q.locator("svg g[data-earlier]").first();
    if (!(await mark.count())) throw new Error("no earlier line on the map, though the seed changes destination");
    await mark.focus();
    await q.keyboard.press("Enter");
    await aside.getByText("Stayed on this line", { exact: true }).waitFor({ timeout: 5000 });
    const rows = await aside.locator("ul > li").count();
    if (rows < 20) throw new Error(`the earlier line's panel lists ${rows} goals, not the seed's 20`);
    return;
  }
  const people = aside.locator("[data-pitstop-people]");
  if (!(await people.count())) {
    const here = q.locator('svg g[role="button"][aria-label*="you are here"]').first();
    if (await here.count()) {
      await here.focus();
      await q.keyboard.press("Enter");
    }
  }
  await people.first().waitFor({ timeout: 5000 });
  const text = (await people.first().textContent()) ?? "";
  if (!/\d+ people on this pitstop/.test(text)) throw new Error("the people panel shows no count");
  if (!(await people.first().locator("li").count())) throw new Error("the people panel names no connections, though the seed connects riders");
}

/** Waits for the page's own loading states to end, as the walk does. */
async function settle(q) {
  await q.locator("main").first().waitFor({ timeout: 20000 });
  await q
    .getByText(/Comparing your resume|Building your path|Loading…/)
    .first()
    .waitFor({ state: "detached", timeout: 30000 })
    .catch(() => {});
  await q.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
}

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let exitCode = 0;
try {
  // ---- Sign in once as the member (the test sign-in finds the seeded account by its subject) ----------------------
  const signIn = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const s = await signIn.newPage();
  await s.goto(BASE + "/today");
  await s.waitForURL(/\/sign-in/, { timeout: 15000 });
  await s.locator('input[name="name"]').fill("Max Data");
  await s.locator('input[name="email"]').fill("max-data@example.com");
  await s.locator('form button[type="submit"]').last().click();
  await s.waitForURL(/\/today/, { timeout: 20000 });
  const storageState = await signIn.storageState();
  await signIn.close();

  // ---- Light and dark side by side, each through both sizes and every page ----------------------------------------
  const run = async (scheme) => {
    const ctx = await b.newContext({ viewport: SIZES[0], colorScheme: scheme, reducedMotion: "reduce", storageState });
    const q = await ctx.newPage();
    let at = "";
    q.on("pageerror", (e) => fail(`${at}: page error: ${e.message.slice(0, 200)}`));
    q.on("console", (m) => m.type() === "error" && !m.text().includes("[Report Only]") && fail(`${at}: console error: ${m.text().slice(0, 200)}`));
    q.on("response", (r) => r.status() >= 500 && fail(`${at}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
    try {
      for (const size of SIZES) {
        await q.setViewportSize(size);
        for (const page of PAGES) {
          at = `${page.name} ${size.width} ${scheme}`;
          const limit = (size.width < 760 ? page.phoneLimit : undefined) ?? page.limit ?? DEFAULT_LIMIT;
          try {
            const started = Date.now();
            const res = await q.goto(BASE + page.path, { timeout: 30000 });
            if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status() ?? "no response"}`);
            if (new URL(q.url()).pathname.startsWith("/sign-in")) throw new Error("sent to sign-in");
            await settle(q);
            if (page.layout) {
              const group = q.getByRole("group", { name: "Layout" }).first();
              await group.getByRole("button", { name: page.layout, exact: true }).click();
              await group.getByRole("button", { name: page.layout, exact: true, pressed: true }).waitFor({ timeout: 5000 });
            }
            if (page.open) await openPanel(q, page.open);
            if (await q.getByText("Something went wrong").count()) throw new Error("error page");
            const m = await measure(q);
            const ms = Date.now() - started;
            rows.push({ at, height: m.scrollHeight, limit, width: `${m.scrollWidth}/${m.innerWidth}`, ms });
            if (m.scrollWidth > m.innerWidth + 1) {
              const list = m.offenders.map((o) => `  <${o.tag} class="${o.cls}"> right ${o.right}px: "${o.text}"`).join("\n");
              fail(`${at}: scrolls sideways (scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth})\n${list}`);
            }
            if (m.scrollHeight > limit) fail(`${at}: ${m.scrollHeight}px tall, over its ${limit}px limit`);
            if (page.spurs) {
              const spurs = await spurLabels(q);
              if (!spurs.count) fail(`${at}: no spur labels on the map, though the seed adds pitstops of the member's own`);
              for (const o of spurs.outside) fail(`${at}: spur label "${o.text}" (box ${o.box}) runs outside the map's viewBox ${o.viewBox}`);
            }
            const file = `${OUT}${scheme}-${size.width}-${page.name}-h${m.scrollHeight}.jpg`;
            await q.screenshot({
              path: file,
              type: "jpeg",
              quality: 45,
              fullPage: true,
              ...(m.scrollHeight > SHOT_MAX_PX ? { clip: { x: 0, y: 0, width: size.width, height: SHOT_MAX_PX } } : {}),
            });
          } catch (e) {
            fail(`${at}: ${e.message.split("\n")[0]}`);
            await q.screenshot({ path: `${OUT}fail-${scheme}-${size.width}-${page.name}.jpg`, type: "jpeg", quality: 45 }).catch(() => {});
          }
        }
      }
      // The resume download at the caps (T146's PDF wrap), timed once, from the light run. The main resume has Hindi
      // and emoji, which the PDF's font can't draw, so its PDF is refused by design (UnprintableTextError, 422, "use
      // the Word file"): that refusal is checked, and the 10 s limit is timed on the seed's second resume, the same
      // caps in Latin text only (long unbroken words, 300-character highlights).
      if (scheme === "light") {
        at = "resume PDF (Hindi and emoji)";
        const refused = await api(q, "get", `${BASE}/api/resume/${seed.resumeId}/export?format=pdf`, { timeout: 60000 });
        if (refused.status() !== 422 || !/can't print/.test(await refused.text())) fail(`${at}: HTTP ${refused.status()}, not the "can't print" refusal`);
        at = "resume PDF (Latin)";
        const started = Date.now();
        const pdf = await api(q, "get", `${BASE}/api/resume/${seed.pdfResumeId}/export?format=pdf`, { timeout: 60000 });
        const ms = Date.now() - started;
        const body = await pdf.body();
        rows.push({ at, height: "-", limit: "-", width: "-", ms });
        if (pdf.status() !== 200 || !body.subarray(0, 5).toString("latin1").startsWith("%PDF-")) fail(`${at}: HTTP ${pdf.status()}, not a PDF`);
        else if (ms > PDF_LIMIT_MS) fail(`${at} took ${ms} ms, over ${PDF_LIMIT_MS} ms`);
      }
    } finally {
      await ctx.close();
    }
  };
  // Settled, not all: a run that throws must not leave the other running while the browser closes.
  for (const r of await Promise.allSettled([run("light"), run("dark")])) if (r.status === "rejected") fail(`oversize: ${String(r.reason?.message ?? r.reason).split("\n")[0]}`);
} catch (e) {
  fail(`oversize: ${e.message.split("\n")[0]}`);
} finally {
  await b.close();
  // Every page's numbers, pass or fail, so the limits can be tuned from a run.
  console.log("\npage                               height   limit  scrollWidth/innerWidth  ms");
  for (const r of rows) console.log(`${r.at.padEnd(34)} ${String(r.height).padStart(6)}  ${String(r.limit).padStart(6)}  ${r.width.padStart(10)}  ${r.ms}`);
  try {
    assertLocalDatabase(process.env.DATABASE_URL);
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      console.log(`max-data: removed ${await cleanMaxData(sql)} accounts`);
    } finally {
      await sql.end();
    }
  } catch (e) {
    fail(`clean-up: ${e.message.split("\n")[0]}`);
  }
  if (failures.length) exitCode = 1;
  console.log(failures.length ? `\n${failures.length} oversize failure(s)` : "\noversize: every page fits");
}
process.exit(exitCode);
