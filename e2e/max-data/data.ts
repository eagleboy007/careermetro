/*
 * The "Max Data" member's synthetic text and lists (T150, testing/oversize/max-data-proposal.md): every text at its cap,
 * mixed through four kinds so each list holds all of them: an 80-character unbroken word followed by ordinary words, an
 * emoji run with no spaces, Hindi (Devanagari), and one unbroken word filling the whole field. Plain data only: the
 * seed (seed.run.ts) writes it and src/lib/schemas/max-data-caps.test.ts checks it against the caps. Nothing here is a
 * real person's.
 */
import {
  BUILDER_ROWS_MAX,
  BUILDER_TEXT_MAX,
  BUILDER_TOOLS_MAX,
  HEADLINE_MAX,
  INTEREST_MAX,
  INTERESTS_MAX,
  JOB_COMPANY_MAX,
  JOB_TITLE_SHOWN,
  ME_EDUCATION_MAX,
  ME_EDUCATION_TEXT_MAX,
  ME_EDUCATION_YEAR_MAX,
  ME_ROLE_TEXT_MAX,
  ME_ROLES_MAX,
  MY_JOB_CITY_MAX,
  MY_JOB_NOTE_MAX,
  PROFILE_CERTIFICATION_NAME_MAX,
  PROFILE_CERTIFICATIONS_MAX,
  PROFILE_HIGHLIGHT_MAX,
  PROFILE_SKILL_NAME_MAX,
  PROFILE_TEXT_MAX,
  STORIES_MAX,
  STORY_BOXES,
  STORY_PART_MAX,
  STORY_TITLE_MAX,
  STORY_WHERE_MAX,
} from "@/lib/schemas/constants";
import { cutText, type Profile } from "@/lib/schemas/profile";
import type { BuilderAnswers } from "@/lib/schemas/builder";

/** The member's sign-in: the test sign-in turns the typed address into MAX_DATA_EMAIL (src/lib/auth/test-user.ts). */
export const MAX_DATA_NAME = "Max Data";
export const MAX_DATA_TYPED_EMAIL = "max-data@example.com";
export const MAX_DATA_USERNAME = "max-data-oversize-check-30char";

/** How many of each list the seed writes; where it is less than the cap, the reason is beside it. */
export const SIZES = {
  // Resume profile: the caps are 40 roles, 100 skills, 20 education and 30 certifications, but Me shows 20 roles, 30
  // skills and 12 education, and the editor shows every row unpaged, so the proposal's Me numbers are used.
  profileRoles: 10,
  highlightsPerRole: 8,
  profileSkills: 30,
  evidencePerSkill: 2,
  profileEducation: ME_EDUCATION_MAX,
  profileCertifications: PROFILE_CERTIFICATIONS_MAX,
  meRoles: ME_ROLES_MAX,
  meEducation: ME_EDUCATION_MAX,
  stories: STORIES_MAX,
  interests: INTERESTS_MAX,
  myJobs: 300,
  inboxThreads: 60,
  /** The one long thread. */
  longThreadMessages: 200,
  /** Each other thread. */
  messagesPerThread: 3,
  messageRequests: 5,
  connections: 150,
  requestsIn: 100,
  requestsOut: 100,
  librarySaved: 200,
  libraryFinished: 200,
  choiceGoals: 20,
  practiceRatings: 620,
  mockSessions: 50,
} as const;

const LONG_WORD = "Supercalifragilisticexpialidociousantidisestablishmentarianismfloccinaucinihilipil".slice(0, 80);
const WORDS = " keeps wrapping across ordinary words so the line has to break cleanly at every width.";
const EMOJI = "🚀📈🎯✨🔥💡🧠📊";
const HINDI = "डेटा विश्लेषण में तीन साल का अनुभव और पाइथन के साथ रोज़ काम। ";

/** Repeats `unit` until it is at least `max` long, then cuts it to `max` UTF-16 units without splitting an emoji. */
function fill(unit: string, max: number, start = ""): string {
  let s = start;
  while (s.length < max) s += unit;
  return cutText(s, max);
}

const KINDS = ["word", "emoji", "hindi", "unbroken"] as const;
export type TextKind = (typeof KINDS)[number];

/** One text of exactly `max` UTF-16 units (an emoji run may end one unit short), of the given kind. */
export function textOf(kind: TextKind, max: number): string {
  switch (kind) {
    case "word":
      return fill(WORDS, max, LONG_WORD).trimEnd();
    case "emoji":
      return fill(EMOJI, max);
    case "hindi":
      return fill(HINDI, max).trimEnd();
    case "unbroken":
      return fill(LONG_WORD, max);
  }
}

/** The i-th text of a list: the four kinds in turn. */
export const v = (i: number, max: number): string => textOf(KINDS[i % KINDS.length], max);

/** The same, starting with a label so list entries stay told apart (interests are unique by their text). */
export const labelled = (label: string, i: number, max: number): string => cutText(`${label} ${v(i, max)}`, max).trimEnd();

const month = (year: number, m: number) => `${year}-${String(m).padStart(2, "0")}`;

/** The resume profile at the T146 caps (each text) and the sizes above (each list). */
export function maxProfile(roleSkillNames: readonly string[]): Profile {
  const roles: Profile["roles"] = Array.from({ length: SIZES.profileRoles }, (_, i) => ({
    title: v(i, PROFILE_TEXT_MAX),
    employer: v(i + 1, PROFILE_TEXT_MAX),
    start: month(2014 + i, (i % 12) + 1),
    end: i === 0 ? null : month(2015 + i, (i % 12) + 1),
    highlights: Array.from({ length: SIZES.highlightsPerRole }, (_, j) => v(i + j, PROFILE_HIGHLIGHT_MAX)),
  }));
  // A few of the target role's own skills, so the analysis has met skills as well as gaps.
  const known = roleSkillNames.slice(0, 4);
  const skills: Profile["skills"] = Array.from({ length: SIZES.profileSkills }, (_, i) => ({
    name: i < known.length ? known[i] : labelled(`Skill ${i + 1}`, i, PROFILE_SKILL_NAME_MAX),
    lastUsed: month(2025, (i % 12) + 1),
    evidence: Array.from({ length: SIZES.evidencePerSkill }, (_, j) => v(i + j + 1, PROFILE_HIGHLIGHT_MAX)),
  }));
  const education: Profile["education"] = Array.from({ length: SIZES.profileEducation }, (_, i) => ({
    qualification: v(i, ME_EDUCATION_TEXT_MAX),
    institution: v(i + 2, ME_EDUCATION_TEXT_MAX),
    year: v(i + 3, ME_EDUCATION_YEAR_MAX),
  }));
  const certifications: Profile["certifications"] = Array.from({ length: SIZES.profileCertifications }, (_, i) => ({
    name: v(i, PROFILE_CERTIFICATION_NAME_MAX),
    earned: month(2023, (i % 12) + 1),
    expires: i % 2 ? "none" : month(2028, (i % 12) + 1),
  }));
  return { headline: v(0, PROFILE_TEXT_MAX), totalYearsExperience: 12, roles, skills, education, certifications };
}

export const maxHeadline = () => v(3, HEADLINE_MAX);

/** Me's hand-added roles: one current, the rest ended, newest first. */
export function maxMeRoles() {
  return Array.from({ length: SIZES.meRoles }, (_, i) => ({
    title: v(i, ME_ROLE_TEXT_MAX),
    employer: v(i + 1, ME_ROLE_TEXT_MAX),
    startMonth: month(2005 + (i % 20), 1),
    endMonth: i === 0 ? null : month(2005 + (i % 20), 12),
    isCurrent: i === 0,
  }));
}

export function maxMeEducation() {
  return Array.from({ length: SIZES.meEducation }, (_, i) => ({
    qualification: v(i + 1, ME_EDUCATION_TEXT_MAX),
    institution: v(i, ME_EDUCATION_TEXT_MAX),
    year: v(i + 2, ME_EDUCATION_YEAR_MAX),
  }));
}

/** Stories with every part full. The first ten answer every box, so each Board column is long; the rest one or two. */
export function maxStories() {
  return Array.from({ length: SIZES.stories }, (_, i) => ({
    title: v(i, STORY_TITLE_MAX),
    whereText: v(i + 1, STORY_WHERE_MAX),
    situation: v(i, STORY_PART_MAX),
    task: v(i + 1, STORY_PART_MAX),
    action: v(i + 2, STORY_PART_MAX),
    result: v(i + 3, STORY_PART_MAX),
    boxes: i < 10 ? [...STORY_BOXES] : [STORY_BOXES[i % STORY_BOXES.length], STORY_BOXES[(i + 1) % STORY_BOXES.length]],
  }));
}

export function maxInterests(): string[] {
  return Array.from({ length: SIZES.interests }, (_, i) => labelled(String(i + 1), i, INTEREST_MAX));
}

/** A note with 200 line breaks, inside the note cap. */
export const MANY_LINES_NOTE = Array.from({ length: 201 }, (_, k) => `line ${String(k).padStart(3, "0")}`).join("\n");

/** One My jobs row's text: a 160-character title, a long company, a long link and a 2,000-character note. */
export function maxJob(i: number) {
  return {
    title: v(i, JOB_TITLE_SHOWN),
    company: v(i + 1, JOB_COMPANY_MAX),
    city: v(i + 2, MY_JOB_CITY_MAX),
    url: `https://example.com/jobs/${i}/${textOf("unbroken", 280)}`,
    note: i === 1 ? MANY_LINES_NOTE : v(i, MY_JOB_NOTE_MAX),
  };
}

/** A message body at the 2,000-character cap; message 0 of the long thread is one unbroken word. */
export const maxMessage = (i: number) => (i === 0 ? textOf("unbroken", 2000) : v(i, 2000));

/** Other members' names: "Peer N" and then the mixed text, so initials and sorting stay readable. */
export const peerName = (n: number) => labelled(`Peer ${n}`, n, 70);

/** The builder's draft at its caps: 20 rows in every list, every text full, every link 300 characters. */
export function maxBuilderAnswers(roleSlug: string): BuilderAnswers {
  const rows = BUILDER_ROWS_MAX;
  const link = (prefix: string) => `${prefix}${textOf("unbroken", 300 - prefix.length)}`;
  return {
    role: { roleSlug, stage: "working", city: v(1, 60) },
    education: Array.from({ length: rows }, (_, i) => ({
      id: `e${i}`,
      degree: v(i, 120),
      college: v(i + 1, 160),
      start: String(2000 + i),
      end: String(2004 + i),
      marks: v(i + 2, 40),
    })),
    projects: Array.from({ length: rows }, (_, i) => ({
      id: `p${i}`,
      name: v(i, 120),
      did: v(i + 1, BUILDER_TEXT_MAX),
      link: link(`https://example.com/p${i}/`),
    })),
    worked: true,
    jobs: Array.from({ length: rows }, (_, i) => ({
      id: `j${i}`,
      kind: (["job", "internship", "freelance", "volunteer"] as const)[i % 4],
      company: v(i + 1, 120),
      title: v(i, 120),
      from: month(2005 + i, 1),
      to: i === 0 ? "now" : month(2005 + i, 12),
      did: v(i + 2, BUILDER_TEXT_MAX),
    })),
    tools: Array.from({ length: BUILDER_TOOLS_MAX }, (_, i) => labelled(`T${i + 1}`, i, 60)),
    noCertificates: false,
    certificates: Array.from({ length: rows }, (_, i) => ({
      id: `c${i}`,
      name: v(i, 160),
      issuer: v(i + 1, 120),
      earned: month(2023, (i % 12) + 1),
      badge: link(`https://example.com/badge/${i}/`),
    })),
    links: {
      github: link("https://github.com/"),
      portfolio: link("https://example.com/portfolio/"),
      linkedin: link("https://www.linkedin.com/in/"),
      email: MAX_DATA_TYPED_EMAIL,
    },
  };
}
