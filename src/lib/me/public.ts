import { meProfile, type MeProfile, type PublicParts, type UserSettings } from "@/lib/schemas";
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
 * What other people see of a profile, at /u/<username> and in "View as others" on /me (handoff section 11): worked
 * out on the server, so nothing hidden ever reaches another person's browser. The switches come from Account settings.
 * Whatever they say, resume lines, the journey, private stats and the resume never show; pay, phone, email and notice
 * period aren't in a profile at all.
 */
export function publicProfile(me: MeProfile, parts: PublicParts): MeProfile {
  return meProfile.parse({
    ...me,
    aim: parts.showTargetRole ? me.aim : null,
    stats: me.stats.filter((s) => !s.private && (parts.showSkills || s.label !== "skills found")),
    journey: [],
    journeyLabel: "",
    experience: parts.showExperience ? me.experience.map((e) => ({ ...e, highlights: [] })) : [],
    experienceTotal: parts.showExperience ? me.experienceTotal : null,
    education: parts.showEducation ? me.education : [],
    skills: {
      have: parts.showSkills ? me.skills.have : [],
      weak: parts.showGaps ? me.skills.weak : [],
      missing: parts.showGaps ? me.skills.missing : [],
    },
    certifications: parts.showCertifications ? me.certifications : [],
    resumeReadOn: null,
  });
}
