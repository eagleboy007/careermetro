// Mines public job postings from Greenhouse, Lever and Ashby job-board APIs (public, meant for
// syndication) and measures how often each taxonomy skill appears per CareerMetro role.
// Output is aggregate only: no posting text is stored, just titles, URLs and counts.
// Usage: node scripts/jd-mining/mine.mjs <outDir>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const outDir = process.argv[2] ?? join(root, "data/jd-snapshot");
const boards = JSON.parse(readFileSync(join(root, "scripts/jd-mining/boards.json"), "utf8"));
const skills = JSON.parse(readFileSync(join(root, "src/content/skills.json"), "utf8"));
const roleSlugs = readdirSync(join(root, "src/content/roles")).map((f) => f.replace(/\.json$/, ""));

const SENIOR = /\b(director|head of|vice president|vp|principal|staff|chief|intern|internship)\b/i;
const ROLE_TITLES = {
  "data-analyst": /\b(data|analytics|bi|business intelligence|product|insights|reporting) analyst\b/i,
  "business-analyst": /\bbusiness (systems )?analyst\b/i,
  "java-backend-developer": /\b(back[- ]?end|java|server[- ]side)\b.*\b(engineer|developer)\b|\b(software|backend) (engineer|developer)\b.*\bjava\b/i,
  "frontend-developer": /\b(front[- ]?end|ui|react|web)\b.*\b(engineer|developer)\b/i,
  "full-stack-developer": /\bfull[- ]?stack\b/i,
  "data-scientist": /\b(data scientist|machine learning scientist|applied scientist|ml scientist)\b/i,
  "product-manager": /\b(product manager|product owner|associate product manager)\b/i,
  "qa-automation-engineer": /\b(qa|sdet|test|testing|quality|automation test)\b.*\b(engineer|analyst|developer)\b|\bsdet\b/i,
  "devops-engineer": /\b(devops|site reliability|sre|cloud engineer|platform engineer|infrastructure engineer|cloud ops)\b/i,
  "digital-marketing-executive": /\b(digital|performance|growth|paid|search|seo|sem|social media|content|lifecycle|email) market(ing|er)\b|\b(seo|sem|ppc|paid social|paid search) (specialist|executive|manager|associate)\b/i,
};
const MANAGER_OK = new Set(["product-manager", "digital-marketing-executive"]);
const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|gurgaon|gurugram|noida|delhi|new delhi|kolkata|ahmedabad|jaipur|kochi)\b/i;

function classify(title, text) {
  if (SENIOR.test(title)) return null;
  for (const [slug, re] of Object.entries(ROLE_TITLES)) {
    if (!roleSlugs.includes(slug) || !re.test(title)) continue;
    if (!MANAGER_OK.has(slug) && /\bmanager\b/i.test(title)) continue;
    if (slug === "java-backend-developer" && !/\bjava\b/i.test(title + " " + text)) continue;
    return slug;
  }
  return null;
}

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const plain = (html) => decode(decode(html ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One regex per skill over its id, name and aliases. Word-ish boundaries that allow "c++", "node.js", "ci/cd".
const skillMatchers = skills.map((s) => {
  const terms = [...new Set([s.name, ...s.aliases, s.id.replace(/-/g, " ")].map(norm))].filter((t) => t.length > 1);
  return { id: s.id, re: new RegExp(`(?<![a-z0-9])(${terms.map(escape).join("|")})(?![a-z0-9])`, "i") };
});
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

// Candidate new skills: tech-looking tokens (mixed case, digits, dots or plus signs) not already in the taxonomy.
const TECHY = /\b([A-Z][a-zA-Z0-9]*[A-Z0-9.+#][a-zA-Z0-9.+#]*|[A-Z][a-z]+(?:\.js|JS|DB|QL)|[A-Z]{2,6})\b/g;
const STOP = new Set(["US", "USA", "UK", "EU", "AI", "ML", "OR", "AND", "THE", "EEO", "HR", "CEO", "CTO", "PTO", "OTE", "USD", "INR", "LLC", "INC", "FAQ", "IT", "ID", "OK", "WFH", "APAC", "EMEA", "NA", "GDPR", "DEI"]);

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

const roles = Object.fromEntries(roleSlugs.map((r) => [r, { postings: [], skillHits: {}, skillHitsIndia: {}, candidates: {} }]));
for (const p of postings) {
  const slug = classify(p.title, p.text);
  if (!slug) continue;
  const r = roles[slug];
  const india = INDIA.test(p.location);
  r.postings.push({ title: p.title, company: p.company, location: p.location, url: p.url, india });
  for (const m of skillMatchers) {
    if (m.re.test(p.text) || m.re.test(p.title)) {
      r.skillHits[m.id] = (r.skillHits[m.id] ?? 0) + 1;
      if (india) r.skillHitsIndia[m.id] = (r.skillHitsIndia[m.id] ?? 0) + 1;
    }
  }
  for (const tok of new Set(p.text.match(TECHY) ?? [])) {
    if (STOP.has(tok) || knownTerms.has(norm(tok))) continue;
    r.candidates[tok] = (r.candidates[tok] ?? 0) + 1;
  }
}

mkdirSync(outDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const summary = { fetchedOn: today, totalPostings: postings.length, sources: sourceLog, roles: {} };
const freqRows = [["role", "skill_id", "postings_with_skill", "role_postings", "share", "india_postings_with_skill", "india_role_postings", "india_share"]];
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
  Object.entries(r.candidates)
    .filter(([, c]) => n && c / n >= 0.08 && c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .forEach(([t, c]) => candRows.push([slug, t, c, n, (c / n).toFixed(2)]));
  for (const p of r.postings) postingRows.push([slug, p.company, p.title, p.location, p.india ? "yes" : "no", p.url]);
}
const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "role-skill-frequency.csv"), csv(freqRows));
writeFileSync(join(outDir, "candidate-skills.csv"), csv(candRows));
writeFileSync(join(outDir, "postings.csv"), csv(postingRows));
console.log(JSON.stringify(summary.roles, null, 2));
console.log(`Boards ok: ${sourceLog.filter((s) => s.ok).length}/${sourceLog.length}, postings: ${postings.length}`);
