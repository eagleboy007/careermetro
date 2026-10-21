// Mines public job postings from Greenhouse, Lever and Ashby job-board APIs (public, meant for
// syndication) and measures how often each taxonomy skill appears per CareerMetro role.
// Output is aggregate only: no posting text is stored, just titles, URLs and counts.
// Usage: node scripts/jd-mining/mine.mjs <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv as csv } from "../../src/lib/market/csv.mjs";
import { classify, escape, hasSkill, INDIA, norm, plain, ROLE_TITLES, skillMatchersFor } from "../../src/lib/departures/feed-rules.mjs";

const root = new URL("../../", import.meta.url).pathname;
const outDir = process.argv[2] ?? join(root, "data/jd-snapshot");
const boards = JSON.parse(readFileSync(join(root, "scripts/jd-mining/boards.json"), "utf8"));
const skills = JSON.parse(readFileSync(join(root, "src/content/skills.json"), "utf8"));
const certifications = JSON.parse(readFileSync(join(root, "src/content/certifications.json"), "utf8"));

// The live role from the title, the India test and the taxonomy matchers are shared with the daily Departures feed
// (src/lib/departures/feed-rules.mjs, docs/plans/departures-live-plan.md).
const skillMatchers = skillMatchersFor(skills);
const certMatchers = certifications.map((c) => ({
  id: c.id,
  re: new RegExp(`(?<![A-Za-z0-9])(${[c.name, ...c.aliases].map((t) => escape(norm(t))).join("|")})(?![A-Za-z0-9])`, "i"),
}));
const knownTerms = new Set(skills.flatMap((s) => [s.id, s.name, ...s.aliases].map(norm)));

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "CareerMetro research (github.com/eagleboy007/careermetro)" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const fetchers = {
  async greenhouse(board) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    return data.jobs.map((j) => ({ title: j.title, location: j.location?.name ?? "", url: j.absolute_url, text: plain(j.content) }));
  },
  async lever(board) {
    const data = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return data.map((j) => ({
      title: j.text,
      location: [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(", "),
      url: j.hostedUrl,
      text: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text} ${plain(l.content)}`), j.additionalPlain].join(" "),
    }));
  },
  async ashby(board) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
    return data.jobs.map((j) => ({
      title: j.title,
      location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join(", "),
      url: j.jobUrl,
      text: j.descriptionPlain ?? plain(j.descriptionHtml),
    }));
  },
};

// Candidate new skills: tech-looking tokens (inner capitals, digits, dots or plus signs) not already in the
// taxonomy. All-caps words are skipped: in postings they are mostly headings, places and legal acronyms.
const TECHY = /\b[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]*|\.js|\+\+|#)+[a-zA-Z0-9]*\b/g;
const STOP = new Set(["LinkedIn", "YouTube", "TikTok", "DoorDash", "SeatGeek", "OpenAI", "iOS", "eBay", "PhD", "McKinsey", "UeA", "PayPal", "GitHub", "WhatsApp"]);
const sourceLog = [];
const postings = [];
for (const [ats, list] of Object.entries(boards)) {
  for (const board of list) {
    try {
      const jobs = await fetchers[ats](board);
      sourceLog.push({ ats, board, jobs: jobs.length, ok: true });
      for (const j of jobs) postings.push({ ...j, company: board, ats });
    } catch (e) {
      sourceLog.push({ ats, board, jobs: 0, ok: false, error: String(e.message ?? e) });
    }
  }
}

const roles = Object.fromEntries(Object.keys(ROLE_TITLES).map((r) => [r, { postings: [], skillHits: {}, skillHitsIndia: {}, certHits: {}, candidates: {} }]));
// The same posting is often listed once per city; count it once.
const seen = new Set();
for (const p of postings) {
  const slug = classify(p.title, p.text);
  if (!slug) continue;
  const key = `${p.company}|${norm(p.title)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const r = roles[slug];
  const india = INDIA.test(p.location);
  r.postings.push({ title: p.title, company: p.company, location: p.location, url: p.url, india });
  for (const m of skillMatchers) {
    if (hasSkill(m, p.text) || hasSkill(m, p.title)) {
      r.skillHits[m.id] = (r.skillHits[m.id] ?? 0) + 1;
      if (india) r.skillHitsIndia[m.id] = (r.skillHitsIndia[m.id] ?? 0) + 1;
    }
  }
  for (const c of certMatchers) {
    if (c.re.test(p.text)) r.certHits[c.id] = (r.certHits[c.id] ?? 0) + 1;
  }
  for (const tok of new Set(p.text.match(TECHY) ?? [])) {
    if (STOP.has(tok) || /^[A-Z0-9.+#]+$/.test(tok) || knownTerms.has(norm(tok))) continue;
    r.candidates[tok] = (r.candidates[tok] ?? 0) + 1;
  }
}

mkdirSync(outDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const summary = { fetchedOn: today, totalPostings: postings.length, sources: sourceLog, roles: {} };
const freqRows = [["role", "skill_id", "postings_with_skill", "role_postings", "share", "india_postings_with_skill", "india_role_postings", "india_share"]];
const certRows = [["role", "cert_id", "postings_with_cert", "role_postings", "share"]];
const candRows = [["role", "term", "postings", "role_postings", "share"]];
const postingRows = [["role", "company", "title", "location", "india", "url"]];
for (const [slug, r] of Object.entries(roles)) {
  const n = r.postings.length;
  const nIn = r.postings.filter((p) => p.india).length;
  summary.roles[slug] = { postings: n, indiaPostings: nIn, companies: new Set(r.postings.map((p) => p.company)).size };
  for (const [id, c] of Object.entries(r.skillHits).sort((a, b) => b[1] - a[1])) {
    const ci = r.skillHitsIndia[id] ?? 0;
    freqRows.push([slug, id, c, n, n ? (c / n).toFixed(2) : "0", ci, nIn, nIn ? (ci / nIn).toFixed(2) : ""]);
  }
  for (const [id, c] of Object.entries(r.certHits).sort((a, b) => b[1] - a[1])) {
    certRows.push([slug, id, c, n, n ? (c / n).toFixed(2) : "0"]);
  }
  Object.entries(r.candidates)
    .filter(([, c]) => n && c / n >= 0.08 && c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .forEach(([t, c]) => candRows.push([slug, t, c, n, (c / n).toFixed(2)]));
  for (const p of r.postings) postingRows.push([slug, p.company, p.title, p.location, p.india ? "yes" : "no", p.url]);
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "role-skill-frequency.csv"), csv(freqRows));
writeFileSync(join(outDir, "role-cert-frequency.csv"), csv(certRows));
writeFileSync(join(outDir, "candidate-skills.csv"), csv(candRows));
writeFileSync(join(outDir, "postings.csv"), csv(postingRows));
console.log(JSON.stringify(summary.roles, null, 2));
console.log(`Boards ok: ${sourceLog.filter((s) => s.ok).length}/${sourceLog.length}, postings: ${postings.length}`);
