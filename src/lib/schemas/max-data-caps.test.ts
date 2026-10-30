import { describe, expect, it } from "vitest";
import {
  MANY_LINES_NOTE,
  maxBuilderAnswers,
  maxHeadline,
  maxInterests,
  maxJob,
  maxMeEducation,
  maxMeRoles,
  maxMessage,
  maxProfile,
  maxStories,
  peerName,
  SIZES,
  textOf,
} from "../../../e2e/max-data/data";
import { builderAnswers } from "./builder";
import {
  HEADLINE_MAX,
  INTEREST_MAX,
  JOB_COMPANY_MAX,
  JOB_TITLE_SHOWN,
  ME_EDUCATION_TEXT_MAX,
  ME_ROLE_TEXT_MAX,
  MY_JOB_CITY_MAX,
  MY_JOB_NOTE_MAX,
  MY_JOBS_MAX,
  PROFILE_HIGHLIGHT_MAX,
  PROFILE_TEXT_MAX,
  STORIES_MAX,
  STORY_PART_MAX,
} from "./constants";
import { profile } from "./profile";

// The max-data seed (T150) must sit at the caps, never past them: the seed writes straight to the tables, so these
// checks stand in for the forms and stores it skips. Synthetic text only.
describe("max-data seed text", () => {
  it("fills each text to its cap with each of the four kinds", () => {
    expect(textOf("word", 300)).toMatch(/^[A-Za-z]{80} /);
    expect(textOf("unbroken", 300)).toMatch(/^[A-Za-z]{300}$/);
    expect(textOf("emoji", 300)).not.toMatch(/\s/);
    expect(textOf("emoji", 300).length).toBeGreaterThanOrEqual(299);
    expect(textOf("hindi", 300)).toMatch(/[ऀ-ॿ]/);
    for (const kind of ["word", "emoji", "hindi", "unbroken"] as const) expect(textOf(kind, 120).length).toBeLessThanOrEqual(120);
  });

  it("gives a resume profile inside the T146 caps, at full length", () => {
    const p = profile.parse(maxProfile(["SQL", "Python"]));
    expect(p.headline?.length).toBeGreaterThan(PROFILE_TEXT_MAX - 2);
    expect(p.roles).toHaveLength(SIZES.profileRoles);
    expect(p.roles.every((r) => r.highlights.length === SIZES.highlightsPerRole)).toBe(true);
    expect(Math.max(...p.roles.flatMap((r) => r.highlights.map((h) => h.length)))).toBe(PROFILE_HIGHLIGHT_MAX);
    expect(p.skills.slice(0, 2).map((s) => s.name)).toEqual(["SQL", "Python"]);
    expect(p.certifications).toHaveLength(SIZES.profileCertifications);
  });

  it("keeps Me, My jobs, Inbox and builder text inside their caps and the tables' checks", () => {
    expect(maxHeadline().length).toBeLessThanOrEqual(HEADLINE_MAX);
    const roles = maxMeRoles();
    expect(roles.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(roles.every((r) => r.title.length <= ME_ROLE_TEXT_MAX && (r.endMonth === null || r.endMonth >= r.startMonth))).toBe(true);
    expect(maxMeEducation().every((e) => e.qualification.length <= ME_EDUCATION_TEXT_MAX)).toBe(true);
    const stories = maxStories();
    expect(stories).toHaveLength(STORIES_MAX);
    expect(stories.every((s) => s.situation.length <= STORY_PART_MAX && s.boxes.length > 0)).toBe(true);
    const interests = maxInterests();
    expect(interests.every((n) => n.length >= 1 && n.length <= INTEREST_MAX)).toBe(true);
    expect(new Set(interests.map((n) => n.toLowerCase())).size).toBe(interests.length);
    expect(SIZES.myJobs).toBeLessThanOrEqual(MY_JOBS_MAX);
    for (let i = 0; i < 8; i++) {
      const job = maxJob(i);
      expect(job.title.length).toBeLessThanOrEqual(JOB_TITLE_SHOWN);
      expect(job.company.length).toBeLessThanOrEqual(JOB_COMPANY_MAX);
      expect(job.city.length).toBeLessThanOrEqual(MY_JOB_CITY_MAX);
      expect(job.note.length).toBeLessThanOrEqual(MY_JOB_NOTE_MAX);
      expect(job.url).toMatch(/^https:\/\//);
      expect(maxMessage(i).length).toBeLessThanOrEqual(2000);
      expect(peerName(i).length).toBeLessThanOrEqual(80);
    }
    expect(MANY_LINES_NOTE.split("\n")).toHaveLength(201);
    expect(MANY_LINES_NOTE.length).toBeLessThanOrEqual(MY_JOB_NOTE_MAX);
    expect(maxMessage(0)).toMatch(/^[A-Za-z]{2000}$/);
  });

  it("gives a builder draft the builder's own schema keeps whole", () => {
    const raw = maxBuilderAnswers("data-analyst");
    const parsed = builderAnswers.parse(raw);
    expect(parsed.jobs).toHaveLength(20);
    expect(parsed.tools).toHaveLength(30);
    expect(parsed.links.github).toBe(raw.links.github);
    expect(parsed.links.github.length).toBe(300);
  });
});
