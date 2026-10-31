// Builds the expert review pack from src/content: one CSV per field of role profiles, one for the timed-test
// questions, one for the Practice bank and one for certifications awaiting review, plus a README. Re-run after any content change:
//   node scripts/review/build-review-pack.mjs [outDir]   (default docs/review/pack)
// Only content files are read. No resumes, no user data.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

/** The review files, by field, from the closest-role families (fixtures/evals/closest/role-families.json). */
export const FIELDS = [
  { file: "roles-cloud.csv", name: "Cloud and infrastructure", families: ["infra-cloud"] },
  { file: "roles-security.csv", name: "Security", families: ["security"] },
  { file: "roles-data.csv", name: "Data, analytics and AI", families: ["data-analytics", "data-engineering", "data-science-ml"] },
  { file: "roles-enterprise-apps.csv", name: "Enterprise apps (SAP, Oracle, Salesforce, ServiceNow and others)", families: ["enterprise-apps"] },
  { file: "roles-testing.csv", name: "Testing and quality", families: ["quality"] },
  { file: "roles-other.csv", name: "Software, hardware, delivery and marketing", families: ["backend", "frontend-mobile", "hardware", "delivery", "marketing"] },
  { file: "roles-business.csv", name: "Sales, finance, HR and operations", families: ["sales", "finance", "hr", "operations"] },
  { file: "roles-core-engineering.csv", name: "Core engineering (mechanical, electrical and civil)", families: ["core-engineering"] },
  { file: "roles-legal.csv", name: "Legal and compliance", families: ["legal"] },
  { file: "roles-healthcare-admin.csv", name: "Healthcare administration (coding, billing, hospital operations and claims)", families: ["healthcare-admin"] },
  { file: "roles-hospitality.csv", name: "Hospitality (hotels, food and beverage)", families: ["hospitality"] },
];

export const ANSWER_COLUMNS = ["Agree (yes / no)", "Change to", "Comment"];
const ROLE_COLUMNS = ["Ref", "Role", "Section", "Item", "Detail", ...ANSWER_COLUMNS];

const IMPORTANCE = { required: "Required", nice_to_have: "Nice to have" };

/**
 * Changes Development made to a drafted role after an eval showed a problem, or when a new profile took over some of its
 * titles (F0, F1, TG1, B5 and TG2, 2026-10-31). Each one waits for the field's reviewer: the line's Detail says what changed and why. Remove an entry once the role is reviewed.
 */
export const SIGN_OFF = [
  { ref: "export-import-executive#years", note: "Starts at 1 year (was 2): EXIM and export documentation executives are commonly hired at 0-2 years." },
  { ref: "it-auditor#skill:domain-bfsi", note: "Nice to have (was Required): IT auditors work in every sector, not only banking and insurance." },
  { ref: "salesforce-developer#skill:salesforce-clouds", note: "Required (was Nice to have): developers build on Sales or Service Cloud from day one." },
  { ref: "salesforce-developer#skill:salesforce-security-model", note: "New Required skill: profiles, permission sets, sharing, and CRUD/FLS checks in code." },
  { ref: "management-trainee#title", note: "Grouped with sales roles (drafted under operations): most campus management trainee programmes start in sales." },
  { ref: "management-trainee#skill:financial-statement-analysis", note: "Nice to have (was Required): trainees learn it on the programme." },
  { ref: "site-reliability-engineer#titles", note: "\"Production Engineer\" removed: in India it usually means a manufacturing role, now its own profile." },
  { ref: "vlsi-design-engineer#titles", note: "\"Design Verification Engineer\", \"ASIC Verification Engineer\" and \"Verification Engineer\" removed: chip verification is now its own profile (Design Verification Engineer)." },
  { ref: "it-service-delivery-manager#title", note: "Grouped with infrastructure and cloud roles (drafted under delivery): its skills are IT operations ones (ITSM, major incidents, SLAs), shared with application support and technical account managers." },
  { ref: "front-office-executive-hotel#skill:cross-selling-upselling", note: "Nice to have (was Required): none of the hotel front office posts the draft is built on ask for upselling." },
  { ref: "corporate-legal-associate#skill:clm-platforms", note: "New Nice to have skill: in-house legal teams route, approve and store contracts in a contract management tool." },
  { ref: "sap-security-grc-consultant#title", note: "Grouped with security roles (drafted under enterprise apps): its key skills are security ones (SAP authorizations, GRC Access Control, access audits), and the nearest roles for its resume are information security analyst and IT auditor." },
  { ref: "fraud-analyst#skill:data-visualization", note: "Nice to have (was Required): none of the posts the draft cites asks for dashboards. As required, it made Fraud Analyst the closest role for data analyst and BPO quality resumes on SQL, Excel and dashboards alone." },
  { ref: "trust-and-safety-analyst#skill:data-visualization", note: "Nice to have (was Required): only Google analyst posts seen through aggregators ask for dashboards. As required, it made Trust and Safety Analyst a Nearby line for every data analyst resume." },
];
const signOffNote = new Map(SIGN_OFF.map((c) => [c.ref, c.note]));

export function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV with a byte-order mark, so Excel opens the file as UTF-8 (₹, dashes and accents stay readable). */
export const csv = (rows) => "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function loadContent() {
  const dir = new URL("src/content/roles/", root);
  const roles = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")))
    .sort((a, b) => a.title.localeCompare(b.title));
  const skills = new Map(read("src/content/skills.json").map((s) => [s.id, s.name]));
  const families = read("fixtures/evals/closest/role-families.json").families;
  const bank = read("src/content/mock-bank.json").questions;
  const practice = read("src/content/practice-questions.json");
  const certifications = read("src/content/certifications.json");
  return { roles, skills, families, bank, practice, certifications };
}

/** One review line per field of a role: title, summary, each normal-day duty, typical titles, years, each skill. */
export function roleRows(role, skills) {
  const ref = (part) => `${role.slug}#${part}`;
  const rows = [
    [ref("title"), role.title, "Title", role.title, ""],
    [ref("summary"), role.title, "Summary", role.summary, ""],
    ...role.dailyDuties.map((d, i) => [ref(`day:${i + 1}`), role.title, "A normal day", d, ""]),
    [ref("titles"), role.title, "Job titles it covers", role.typicalTitles.join("; "), ""],
    [ref("years"), role.title, "Experience (years)", `${role.experienceBand.minYears}-${role.experienceBand.maxYears}`, ""],
  ];
  for (const s of role.skills) {
    const kind = s.oneOf ? `${IMPORTANCE[s.importance]}, one of (${role.skills.filter((o) => o.oneOf === s.oneOf).map((o) => skills.get(o.skillId) ?? o.skillId).join(" / ")})` : IMPORTANCE[s.importance];
    rows.push([ref(`skill:${s.skillId}`), role.title, `Skill: ${kind}`, skills.get(s.skillId) ?? s.skillId, s.expectation]);
  }
  return rows.map((r) => {
    const note = signOffNote.get(r[0]);
    return [...r.slice(0, 4), note ? [r[4], `Changed since the draft, awaiting your sign-off: ${note}`].filter(Boolean).join("\n") : r[4], "", "", ""];
  });
}

/** One review line per certification awaiting review: what it proves and touches, and the roles that recommend it. */
export function certificationRows(certifications, roles, skills) {
  const names = (ids) => ids.map((id) => skills.get(id) ?? id).join("; ");
  return certifications
    .filter((c) => c.reviewed === false)
    .map((c) => {
      const by = roles.flatMap((r) => (r.certifications ?? []).filter((rc) => rc.certId === c.id).map((rc) => `${r.title} (${rc.importance})`));
      return [c.id, c.name, c.issuer, names(c.proves), names(c.partial), by.join("; "), "", "", ""];
    });
}

export function buildPack() {
  const { roles, skills, families, bank, practice, certifications } = loadContent();
  const familyOf = new Map(Object.entries(families).flatMap(([fam, slugs]) => slugs.map((s) => [s, fam])));
  /** @type {Record<string, string>} */
  const files = {};
  const counts = [];
  const awaiting = roles.filter((r) => r.reviewedBy === null);
  for (const field of FIELDS) {
    const inField = awaiting.filter((r) => field.families.includes(familyOf.get(r.slug)));
    files[field.file] = csv([ROLE_COLUMNS, ...inField.flatMap((r) => roleRows(r, skills))]);
    counts.push(`| ${field.name} | \`${field.file}\` | ${inField.length} |`);
  }
  const unplaced = awaiting.filter((r) => !familyOf.has(r.slug)).map((r) => r.slug);
  if (unplaced.length) throw new Error(`roles with no field: ${unplaced.join(", ")}`);

  const choice = bank.filter((q) => q.kind === "choice" && q.reviewed === false);
  files["timed-test-questions.csv"] = csv([
    ["Ref", "Skill", "Level", "Question", "Options", "Marked answer", "Why", ...ANSWER_COLUMNS],
    ...choice.map((q) => [
      q.id,
      skills.get(q.skillId) ?? q.skillId,
      q.level,
      q.question,
      q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n"),
      `${String.fromCharCode(65 + q.answer)}. ${q.options[q.answer]}`,
      q.explanation,
      "",
      "",
      "",
    ]),
  ]);
  files["practice-questions.csv"] = csv([
    ["Ref", "Skill", "Level", "Question", "A strong answer covers", ...ANSWER_COLUMNS],
    ...practice.map((q) => [q.id, skills.get(q.skillId) ?? q.skillId, q.level, q.question, q.lookFor, "", "", ""]),
  ]);
  const certRows = certificationRows(certifications, roles, skills);
  files["certifications.csv"] = csv([["Ref", "Name", "Issuer", "Proves", "Partial", "Roles", ...ANSWER_COLUMNS], ...certRows]);
  files["README.md"] = readme(counts, awaiting.length, choice.length, practice.length, certRows.length);
  return files;
}

function readme(counts, roleCount, choiceCount, practiceCount, certCount) {
  return `# CareerMetro expert review pack

Generated from \`src/content\` by \`node scripts/review/build-review-pack.mjs\`. Do not edit these files by hand in the repo; re-run the script after content changes.

## What we ask (about 5 minutes to read)

CareerMetro tells job seekers in India which skills a role needs and how to prove them. Each line below is one thing we say about a role or one test question. We need someone who works in that field to say whether it is right for India today.

1. Open the file for your field in Excel or Google Sheets.
2. Read each line. Fill in **one** of the last three columns:
   - **Agree (yes / no)**: write \`yes\` if the line is right as it is.
   - **Change to**: write what it should say instead (for a skill, you can also write \`remove\`, or change Required to Nice to have).
   - **Comment**: anything else, such as a missing skill or a duty that is rare in India.
3. Leave the first column (**Ref**) as it is. It is how we find the line again.
4. Add missing skills or duties as new lines at the end of a role: copy the role's name into **Role**, and write them in **Change to**.
5. Send the file back. Blank lines count as "not reviewed", never as "agree".

In the role files, **Section** says what the line is: the summary, "A normal day" (daily duties), the job titles it covers, the years of experience, or a skill. A skill is **Required**, **Nice to have**, or **one of** a group (the person needs any one of the listed skills). **Detail** says what a person in the role is expected to do with that skill; that sentence is the level we expect.

In the timed-test file, check that the marked answer is the only right one, the question is fair for the level (L1 is basic, L2 working, L3 expert), and the explanation is correct. In the Practice file, check the question and what a strong answer covers.

In the certifications file, **Proves** lists skills that holding the certificate shows on its own, and **Partial** skills it only touches. Put a skill in Proves only when the issuer's official exam outline names it. Until someone checks the outline, a skill proposed for Proves waits at the start of Partial; write it in **Change to** if the outline names it. **Roles** lists the roles that recommend it, as recommended or optional; say if it is wrong for a role, retired or renamed.

## Files

| Field | File | Roles awaiting review |
| --- | --- | --- |
${counts.join("\n")}

| Questions | File | Lines |
| --- | --- | --- |
| Timed test (multiple choice, hidden until reviewed) | \`timed-test-questions.csv\` | ${choiceCount} |
| Practice bank (open questions) | \`practice-questions.csv\` | ${practiceCount} |

| Certifications | File | Lines |
| --- | --- | --- |
| Certifications awaiting review (what each proves, and the roles that recommend it) | \`certifications.csv\` | ${certCount} |

${roleCount} role profiles await review in all.

## Changed since the draft, awaiting sign-off

Development changed these lines after a test showed a problem. Their **Detail** ends with a note that begins "Changed since the draft". Please say yes, or what it should be.

${SIGN_OFF.map((c) => `- \`${c.ref}\`: ${c.note}`).join("\n")}

## How answers flow back into the app

1. Save the returned file in \`/mnt/project-files/careermetro/review/returned/\`, with the reviewer's name and the date in the file name.
2. Development runs \`node scripts/review/read-review.mjs <returned file>\`. It lists every line with an answer, grouped by role or question, and flags any Ref the current pack no longer holds (a removed role, skill, duty, question or certification, or one reviewed since).
3. Development makes the changes in \`src/content\` in one PR. For a role, it sets \`reviewedBy\` (the reviewer's name and field) and \`updatedOn\`; for a timed-test question or a certification, it sets \`reviewed: true\`. Practice questions have no review mark: a change is edited in place in \`src/content/practice-questions.json\`, and the Practice file keeps listing every question. The usual checks (the matcher and closest-role evals) run in CI.
4. The pack is generated again from the new content, so reviewed roles, timed-test questions and certifications drop out of it.

Reviewers' names go in the content only with their consent. Nothing in this pack comes from a user.
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "docs/review/pack";
  mkdirSync(out, { recursive: true });
  const files = buildPack();
  for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), body);
  console.log(`wrote ${Object.keys(files).length} files to ${out}`);
}
