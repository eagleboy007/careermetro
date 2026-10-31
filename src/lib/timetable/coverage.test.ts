import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import type { EventFeed, InterestTopic, ManualEvent, Skill } from "@/lib/schemas";
import { eventCoverage, timetableCovers, type CoverageContent } from "./coverage";

// Synthetic taxonomy, topics, events and feeds only.
const skill = (id: string, name: string, aliases: string[] = [], ambiguous: string[] = []): Skill => ({ id, name, category: "tools", aliases, ambiguous, implies: [], scoring: "gap" }) as Skill;
const topic = (key: string, label: string, aliases: string[], ambiguous: string[] = []): InterestTopic => ({ key, label, aliases, ambiguous });
const event = (title: string, topics: string[]): ManualEvent => ({
  title,
  organiser: "Example Circle",
  kind: "meetup",
  startsAt: "2026-11-14T17:00:00+05:30",
  endsAt: "2026-11-14T20:00:00+05:30",
  online: false,
  city: "Pune",
  venue: "Baner, Pune",
  cost: "",
  topics,
  sourceUrl: "https://events.example.org/one",
  checkedOn: "2026-10-31",
  dateEvidence: "14 November 2026, 5 pm",
});
const confsFeed = (on: boolean, words: string[]): EventFeed => ({
  id: "confs-tech",
  name: "Synthetic confs.tech feed",
  organiser: "confs.tech listing",
  format: "confs-tech",
  urls: words.map((w) => `https://raw.example.org/conferences/{year}/${w}.json`),
  termsUrl: "https://raw.example.org/terms",
  termsReadOn: on ? "2026-10-31" : null,
  on,
  note: "Synthetic, for tests.",
});

const SKILLS = [
  skill("ci-cd", "CI/CD", ["continuous integration"]),
  skill("kubernetes", "Kubernetes", ["k8s"]),
  skill("python", "Python"),
  skill("rust", "Rust"),
  skill("financial-modeling", "Financial modeling", ["financial modelling"]),
  skill("tally", "Tally", ["tally erp"]),
  skill("excel", "Excel", ["ms excel"], ["excel"]),
];
const TOPICS = [
  topic("ai", "AI", ["ai", "genai"]),
  topic("devops", "DevOps", ["devops", "ci/cd", "kubernetes"]),
  topic("accounting-tax", "Accounting and tax", ["accounting and tax", "accounting", "tally", "tax"], ["tax"]),
  topic("finance", "Finance", ["finance", "financial analysis"], ["finance"]),
];
const content = (over: Partial<CoverageContent> = {}): CoverageContent => ({
  skills: SKILLS,
  topics: TOPICS,
  manualEvents: [event("Platforms for AI meetup", ["ci-cd"])],
  feeds: [confsFeed(false, ["rust"])],
  ...over,
});

describe("eventCoverage (T181)", () => {
  it("covers the skills a hand-entered event lists and the topics its title names", () => {
    const c = eventCoverage(content());
    expect(c.skills.has("ci-cd")).toBe(true);
    expect(c.topics.has("ai")).toBe(true);
  });

  it("lets a skill and a topic that share a word cover each other", () => {
    const c = eventCoverage(content());
    // CI/CD is listed; DevOps shares "ci/cd", and Kubernetes shares "kubernetes" with DevOps.
    expect(c.topics.has("devops")).toBe(true);
    expect(c.skills.has("kubernetes")).toBe(true);
  });

  it("does not count a topic with no event source behind it", () => {
    const c = eventCoverage(content());
    expect(c.topics.has("accounting-tax")).toBe(false);
    expect(c.topics.has("finance")).toBe(false);
    expect(c.skills.has("tally")).toBe(false);
    expect(c.skills.has("financial-modeling")).toBe(false);
  });

  it("reads a confs.tech feed's topic words only while the feed is on", () => {
    expect(eventCoverage(content()).skills.has("rust")).toBe(false);
    expect(eventCoverage(content({ feeds: [confsFeed(true, ["rust"])] })).skills.has("rust")).toBe(true);
  });

  it("switches a new field on by itself when an event for it is added", () => {
    const c = eventCoverage(content({ manualEvents: [event("GST and Tally workshop", ["tally"])] }));
    expect(c.skills.has("tally")).toBe(true);
    expect(c.topics.has("accounting-tax")).toBe(true);
  });

  it("never links on an ambiguous word", () => {
    const c = eventCoverage(content({ manualEvents: [event("Tax filing clinic", ["python"])] }));
    expect(c.topics.has("accounting-tax")).toBe(false);
  });

  it("reads nothing from a file that is not a list", () => {
    const c = eventCoverage(content({ manualEvents: { not: "a list" }, feeds: [] }));
    expect(c.skills.size).toBe(0);
    expect(c.topics.size).toBe(0);
  });
});

describe("timetableCovers (T181)", () => {
  it("is true when a goal skill is covered", () => {
    expect(timetableCovers({ goalSkillIds: ["financial-modeling", "kubernetes"], interestKeys: [] }, content())).toBe(true);
  });

  it("is true when an interest maps to a covered topic", () => {
    expect(timetableCovers({ goalSkillIds: ["financial-modeling"], interestKeys: ["genai"] }, content())).toBe(true);
  });

  it("is false for a non-tech field, even when the interest maps to a topic", () => {
    expect(timetableCovers({ goalSkillIds: ["financial-modeling", "tally"], interestKeys: ["accounting"] }, content())).toBe(false);
  });

  it("is false for an interest that maps to no topic and no goals", () => {
    expect(timetableCovers({ goalSkillIds: [], interestKeys: ["public speaking"] }, content())).toBe(false);
  });

  it("is true with no goals and no interests: adding them is the fix", () => {
    expect(timetableCovers({ goalSkillIds: [], interestKeys: [] }, content())).toBe(true);
  });
});

describe("the shipped events and topics (T181)", () => {
  const goalsOf = (slug: string) => roleProfiles.find((r) => r.slug === slug)!.skills.map((s) => s.skillId);

  it("list nothing yet for finance, HR, accounts or mechanical roles, even with a matching interest", () => {
    for (const slug of ["financial-analyst", "hr-generalist", "accounts-executive", "graduate-engineer-trainee-mechanical"]) {
      expect(timetableCovers({ goalSkillIds: goalsOf(slug), interestKeys: ["accounting", "human resources", "manufacturing"] })).toBe(false);
    }
  });

  it("cover a DevOps role and an AI interest", () => {
    expect(timetableCovers({ goalSkillIds: goalsOf("devops-engineer"), interestKeys: [] })).toBe(true);
    expect(timetableCovers({ goalSkillIds: [], interestKeys: ["genai"] })).toBe(true);
  });
});
