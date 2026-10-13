import { SECTION_KEYS, type HeadingFlags, type HeadingState, type SectionKey } from "@/lib/schemas";

/**
 * FR-34: section headings. A line counts as a heading only when the whole line (or the label before a colon, as in
 * "Skills: SQL, Excel") is one of the names below, so ordinary sentences never match. Only the state of each section
 * is kept (standard, renamed or not found), never the heading's words.
 *
 * Standard names are the ones screening software is built around: the FR-20 download's heading and its common long
 * forms. Renamed ones are other names people use for the same section, which some software doesn't file correctly.
 */
const NAMES: Record<SectionKey, { standard: string[]; renamed: string[] }> = {
  summary: {
    standard: ["summary", "professional summary", "career summary", "profile summary", "executive summary"],
    renamed: [
      "profile",
      "about me",
      "about",
      "objective",
      "career objective",
      "objectives",
      "professional profile",
      "personal statement",
      "introduction",
      "who i am",
      "overview",
      "snapshot",
      "professional snapshot",
      "career overview",
      "personal profile",
    ],
  },
  experience: {
    standard: [
      "experience",
      "work experience",
      "professional experience",
      "employment history",
      "work history",
      "employment",
      "relevant experience",
      "internship experience",
      "internships",
      "experience and internships",
    ],
    renamed: [
      "career history",
      "professional journey",
      "my journey",
      "career journey",
      "journey",
      "where i have worked",
      "where i've worked",
      "work life",
      "employment record",
      "professional background",
      "career highlights",
      "positions held",
      "career path",
      "organisational experience",
      "organizational experience",
      "career",
      "jobs",
      "roles",
      "professional history",
    ],
  },
  education: {
    standard: ["education", "education and training", "education & training", "academic qualifications", "educational qualifications", "educational qualification", "academic qualification"],
    renamed: [
      "academics",
      "academic background",
      "academic credentials",
      "academic details",
      "academic profile",
      "educational background",
      "educational details",
      "education details",
      "qualifications",
      "qualification",
      "schooling",
      "studies",
      "learning",
      "scholastic record",
      "scholastics",
      "academia",
    ],
  },
  skills: {
    standard: ["skills", "technical skills", "key skills", "core skills", "skills and tools", "skills & tools", "it skills"],
    renamed: [
      "skill set",
      "skillset",
      "core competencies",
      "competencies",
      "areas of expertise",
      "expertise",
      "tech stack",
      "toolkit",
      "toolbox",
      "what i know",
      "what i do",
      "strengths",
      "technical proficiency",
      "proficiencies",
      "technologies",
      "tools",
      "abilities",
      "capabilities",
      "superpowers",
    ],
  },
  projects: {
    standard: ["projects", "academic projects", "personal projects", "key projects", "project experience", "selected projects"],
    renamed: ["portfolio", "things i have built", "things i've built", "what i have built", "work samples", "project work", "case studies", "side projects"],
  },
  certifications: {
    standard: ["certifications", "certification", "licenses and certifications", "licenses & certifications", "certificates", "certifications and training"],
    renamed: [
      "credentials",
      "courses",
      "courses and certificates",
      "online courses",
      "trainings",
      "training",
      "professional development",
      "learning and development",
      "badges",
      "accreditations",
      "awards and certifications",
    ],
  },
};

const lookup = new Map<string, { key: SectionKey; state: HeadingState }>();
for (const key of SECTION_KEYS) {
  for (const n of NAMES[key].standard) lookup.set(n, { key, state: "standard" });
  for (const n of NAMES[key].renamed) if (!lookup.has(n)) lookup.set(n, { key, state: "renamed" });
}

/** A line as a heading candidate: bullets, numbering, trailing colons and spacing removed, lower case. */
function candidate(line: string): string {
  return line
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[\s\-–—•·*#>|=_~]+|[\s\-–—•·*#|=_~:.]+$/g, "")
    .replace(/^\d{1,2}[.)]\s*/, "")
    // Letter-spaced headings: "S K I L L S".
    .replace(/^(?:\p{L} ){2,}\p{L}$/u, (m) => m.replace(/ /g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** What a resume line says about a section, if it is a heading. */
export function readHeading(line: string): { key: SectionKey; state: HeadingState } | null {
  if (line.length > 60) return null;
  const whole = lookup.get(candidate(line));
  if (whole) return whole;
  // "Skills: SQL, Excel" heads the section on the same line. Only standard names count this way: a label such as
  // "Tools:" or "Training:" also opens ordinary lines inside a job or a project.
  const label = /^([^:]{2,40}):/.exec(line);
  const inline = label ? lookup.get(candidate(label[1])) : undefined;
  return inline?.state === "standard" ? inline : null;
}

/**
 * The state of each standard section in a resume's text: standard when any heading for it uses a standard name,
 * renamed when the only headings for it use another known name, else not found.
 */
export function detectHeadings(text: string): HeadingFlags {
  const flags = Object.fromEntries(SECTION_KEYS.map((k) => [k, "not_found"])) as HeadingFlags;
  for (const line of text.split("\n")) {
    const found = readHeading(line.trim());
    if (!found) continue;
    if (found.state === "standard" || flags[found.key] === "not_found") flags[found.key] = found.state;
  }
  return flags;
}
