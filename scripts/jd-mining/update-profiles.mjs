// Copies measured skill shares from a job-posting snapshot into the role profiles.
// Skills, importance and wording stay hand-edited; only postingShare and the snapshot source line change.
// Usage: node scripts/jd-mining/update-profiles.mjs data/jd-snapshots/<date>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const snapshotDir = process.argv[2];
if (!snapshotDir) throw new Error("Pass the snapshot folder, e.g. data/jd-snapshots/2026-10-06");

const summary = JSON.parse(readFileSync(join(snapshotDir, "summary.json"), "utf8"));
const [header, ...rows] = readFileSync(join(snapshotDir, "role-skill-frequency.csv"), "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split(",").map((v) => v.replace(/^"|"$/g, "")));
const col = (name) => header.indexOf(name);
const share = new Map(rows.map((r) => [`${r[col("role")]}|${r[col("skill_id")]}`, Number(r[col("share")])]));
const snapshotPath = relative(root, snapshotDir).replace(/\\/g, "/");
const MARKER = "Skill shares measured on";
const MIN_POSTINGS = 20;

const rolesDir = join(root, "src/content/roles");
for (const file of readdirSync(rolesDir)) {
  const path = join(rolesDir, file);
  const role = JSON.parse(readFileSync(path, "utf8"));
  const stats = summary.roles[role.slug];
  const measured = stats && stats.postings > 0;
  for (const s of role.skills) {
    s.postingShare = measured ? (share.get(`${role.slug}|${s.skillId}`) ?? 0) : null;
  }
  role.sources = role.sources.filter((s) => !s.description.startsWith(MARKER));
  if (measured) {
    const small = stats.postings < MIN_POSTINGS ? " Small sample, so treat the shares as rough." : "";
    role.sources.push({
      description: `${MARKER} ${stats.postings} public job postings (${stats.indiaPostings} in India) from ${stats.companies} companies on Greenhouse, Lever and Ashby job boards, fetched ${summary.fetchedOn}.${small}`,
      url: `https://github.com/eagleboy007/careermetro/tree/main/${snapshotPath}`,
    });
  }
  writeFileSync(path, JSON.stringify(role, null, 2) + "\n");
  console.log(`${role.slug}: ${measured ? `${stats.postings} postings` : "not measured"}`);
}
