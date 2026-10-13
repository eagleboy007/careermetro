import type { MeProfile, PublicParts, UserSettings } from "@/lib/schemas";
import { PROFILE_VISIBILITY_LABELS } from "@/lib/schemas/constants";

const PART_NAMES: [keyof PublicParts, string][] = [
  ["showExperience", "experience"],
  ["showEducation", "education"],
  ["showSkills", "skills"],
  ["showCertifications", "certifications"],
  ["showTargetRole", "your target role"],
  ["showGaps", "your gaps"],
];

/** The "Who sees what" summary on /me: who can open the profile, its link, and the parts it shows. */
export function whoSeesFor(settings: UserSettings, username: string | null) {
  return {
    visibility: PROFILE_VISIBILITY_LABELS[settings.visibility],
    link: username,
    shown: PART_NAMES.filter(([key]) => settings[key]).map(([, name]) => name),
  };
}

/**
 * Every key a public profile has. It is built from this list, never by copying the person's own profile, so a field
 * added to MeProfile later stays off /u until it is added here on purpose.
 */
export const PUBLIC_KEYS = [
  "name",
  "headline",
  "aim",
  "stats",
  "journey",
  "journeyLabel",
  "experience",
  "experienceTotal",
  "education",
  "skills",
  "interests",
  "stories",
  "proofs",
  "certifications",
  "resumeReadOn",
  // Nearby lines are only ever the person's own: always null here.
  "nearby",
  "changeRoleHref",
] as const;

/**
 * What other people see of a profile, at /u/<username> and in "View as others" on /me (handoff section 11): worked
 * out on the server, so nothing hidden ever reaches another person's browser. The switches come from Account settings.
 * Whatever they say, resume lines, the journey, stories, interests and proof (until they have switches of their own),
 * private stats and the resume never show; pay, phone, email and notice period aren't in a profile at all. Each part
 * is copied field by field, so nothing rides along unseen.
 */
export function publicProfile(me: MeProfile, parts: PublicParts): MeProfile {
  const out: MeProfile = {
    name: me.name,
    headline: me.headline,
    aim: parts.showTargetRole ? me.aim : null,
    stats: me.stats
      .filter((s) => !s.private && (parts.showSkills || s.label !== "skills found"))
      .map((s) => ({ value: s.value, label: s.label, private: false })),
    journey: [],
    journeyLabel: "",
    experience: parts.showExperience
      ? me.experience.map((e) => ({ id: e.id, title: e.title, employer: e.employer, dates: e.dates, current: e.current, highlights: [] }))
      : [],
    experienceTotal: parts.showExperience ? me.experienceTotal : null,
    education: parts.showEducation ? me.education.map((e) => ({ qualification: e.qualification, institution: e.institution, year: e.year })) : [],
    skills: {
      have: parts.showSkills ? [...me.skills.have] : [],
      weak: parts.showGaps ? [...me.skills.weak] : [],
      missing: parts.showGaps ? [...me.skills.missing] : [],
    },
    interests: [],
    stories: [],
    proofs: [],
    certifications: parts.showCertifications ? me.certifications.map((c) => ({ name: c.name, verified: c.verified })) : [],
    resumeReadOn: null,
    nearby: null,
    changeRoleHref: null,
  };
  return out;
}
