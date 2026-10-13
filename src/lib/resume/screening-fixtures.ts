import { roleProfiles } from "@/content";
import { postingRole } from "@/lib/jobs/groups";
import type { Profile, ScreeningView } from "@/lib/schemas";
import { buildScreeningView } from "./screening";

/*
 * Example screening checks (FR-34) for /design. The profile is synthetic, but the keywords are worked out by the real
 * matcher over live role profiles, so every keyword on screen is one the check would list.
 */

const now = new Date("2026-10-13T00:00:00Z");

const exampleProfile: Profile = {
  headline: "MIS Executive",
  totalYearsExperience: 2,
  roles: [
    {
      title: "MIS Executive",
      employer: "Example Co-operative Bank",
      start: "2024-06",
      end: null,
      highlights: ["Built Excel dashboards with pivot tables for 3 branch managers", "Wrote SQL queries for the monthly branch report"],
    },
  ],
  skills: [
    { name: "Excel", lastUsed: null, evidence: ["Built Excel dashboards with pivot tables for 3 branch managers"] },
    { name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for the monthly branch report"] },
  ],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2024" }],
  certifications: [],
};

const role = (slug: string) => roleProfiles.find((r) => r.slug === slug)!;

/** A two-column PDF with a photo, a renamed summary and a renamed experience heading, against Data Analyst. */
export const exampleScreeningPdf: ScreeningView = buildScreeningView({
  against: "role",
  profile: exampleProfile,
  role: role("data-analyst"),
  stored: {
    version: 1,
    layout: { fileType: "pdf", tables: null, columns: true, images: 1, textBoxes: null, headerFooterText: null },
    headings: { summary: "renamed", experience: "renamed", education: "standard", skills: "standard", projects: "not_found", certifications: "not_found" },
  },
  now,
});

/** A Word file with a table and contact details in the header, against Cloud Engineer (a "one of these" group). */
export const exampleScreeningDocx: ScreeningView = buildScreeningView({
  against: "role",
  profile: exampleProfile,
  role: role("cloud-engineer"),
  stored: {
    version: 1,
    layout: { fileType: "docx", tables: 1, columns: false, images: 0, textBoxes: 2, headerFooterText: true },
    headings: { summary: "standard", experience: "standard", education: "not_found", skills: "standard", projects: "not_found", certifications: "not_found" },
  },
  now,
});

/** A pasted job the resume fully covers, from a clean Word file: nothing to fix. */
export const exampleScreeningReady: ScreeningView = buildScreeningView({
  against: "job",
  profile: exampleProfile,
  role: postingRole({ requiredSkillIds: ["excel", "sql"], niceSkillIds: [] }, now),
  stored: {
    version: 1,
    layout: { fileType: "docx", tables: 0, columns: false, images: 0, textBoxes: 0, headerFooterText: false },
    headings: { summary: "standard", experience: "standard", education: "standard", skills: "standard", projects: "not_found", certifications: "not_found" },
  },
  now,
});

/** A resume uploaded before the check: no flags, so it asks for the file again. */
export const exampleScreeningOld: ScreeningView = buildScreeningView({
  against: "job",
  profile: exampleProfile,
  role: postingRole({ requiredSkillIds: ["excel", "sql", "tableau"], niceSkillIds: [] }, now),
  stored: null,
  now,
});

/** Pasted resume text: keywords and headings, no layout. */
export const exampleScreeningPasted: ScreeningView = { ...exampleScreeningReady, layout: { state: "pasted" } };
