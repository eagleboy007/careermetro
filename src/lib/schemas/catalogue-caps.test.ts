import { describe, expect, it } from "vitest";
import { interestTopics, mockQuestions, practiceQuestions, resources, roleProfiles, roleTracks, skills } from "@/content";
import { buildLibrary, type CatalogRow } from "@/lib/library/build";
import { exampleMapLine } from "@/lib/map/fixtures";
import { matchListFor } from "@/lib/match/build";
import { bankViewFor, mockRoles, type MockRoleProfile } from "@/lib/mock/rules";
import { certificatesFor } from "@/lib/proofs/eligible";
import { timetableFor, topicsOf } from "@/lib/timetable/match";
import { exampleRide } from "@/lib/today/fixtures";
import {
  interestTopicsFile,
  libraryGoal,
  mapGoal,
  matchList,
  mockBankFile,
  mockPageView,
  mockQuestion,
  practiceView,
  provePitstop,
  roleTracksFile,
  timetableView,
  type MockQuestion,
  type Profile,
  type RoleProfile,
} from ".";
import { GOAL_CERTIFICATES_MAX, LIBRARY_ITEMS_MAX } from "./constants";

/*
 * Caps on lists that grow with the content catalogue (roles, skills, resources, mock questions, certificates). Each
 * test pushes the whole current catalogue through the schema or builder, and where it is cheap twice the catalogue
 * (slugs and ids suffixed), so the next batch from Data research can't make a page throw. What stays capped on
 * purpose is listed under "Deliberate caps" in docs/STATUS.md.
 */

const twice = <T>(list: readonly T[], copy: (item: T) => T): T[] => [...list, ...list.map(copy)];
const roles2x: RoleProfile[] = twice(roleProfiles, (r) => ({ ...r, slug: `${r.slug}-x2`, title: `${r.title} 2` }));
const skillName = new Map(skills.map((s) => [s.id, s.name]));

describe("catalogue caps", () => {
  it("has the catalogue these tests are sized against", () => {
    expect(roleProfiles.length).toBeGreaterThanOrEqual(74);
    expect(skills.length).toBeGreaterThanOrEqual(246);
    expect(resources.length).toBeGreaterThanOrEqual(680);
  });

  it("files a mock question under every role, twice over", () => {
    const slugs = roles2x.map((r) => r.slug);
    for (const q of mockQuestions) expect(mockQuestion.safeParse({ ...q, roleSlugs: slugs }).success).toBe(true);
  });

  it("reads a bank file twice the size of today's", () => {
    const copy = (q: MockQuestion): MockQuestion =>
      q.kind === "open" ? { ...q, id: `${q.id}-x2`, followUps: q.followUps?.map((f) => ({ ...f, id: `${f.id}-x2` })) } : { ...q, id: `${q.id}-x2` };
    expect(mockBankFile.safeParse({ note: "Every question, twice.", questions: twice(mockQuestions, copy) }).success).toBe(true);
  });

  it("builds /mock with every role, twice over, and a bank that files every open question under one role", () => {
    const every: MockRoleProfile = { slug: "every-role", title: "Every role", skills: skills.map((s) => ({ skillId: s.id, importance: "required" })) };
    const open = mockQuestions.filter((q) => q.kind === "open");
    const bank = twice(open, (q) => ({ ...q, id: `${q.id}-x2`, topic: `${q.topic.slice(0, 36)} x2` })).map((q) => ({ ...q, roleSlugs: [every.slug] }));
    const view = bankViewFor(bank, every, true, true);
    expect(view.items).toHaveLength(open.length * 2);
    const roles = mockRoles(mockQuestions, roles2x, true);
    const page = mockPageView.safeParse({ elite: true, role: roles[0], roles, bank: view, test: null, interview: null, job: null });
    expect(page.error).toBeUndefined();
  });

  it("lists every role on Match, twice over", () => {
    const rows = roles2x.map((r, i) => {
      const open = r.skills.filter((s) => s.importance === "required" && !s.oneOf).map((s) => skillName.get(s.skillId) ?? s.skillId);
      return { slug: r.slug, title: r.title, onLine: i === 0, required: open.length, met: 0, open, hours: 10 * open.length, jobs: 0 };
    });
    expect(matchList.safeParse({ resumeId: null, weeklyHours: 6, roles: rows }).error).toBeUndefined();
  });

  it("builds Match for a resume that shows every skill, against every role twice over", () => {
    const profile: Profile = {
      headline: null,
      totalYearsExperience: 5,
      roles: [],
      skills: skills.map((s) => ({ name: s.name, lastUsed: null, evidence: [`Used ${s.name} every day at work to ship reports`] })),
      education: [],
      certifications: [],
    };
    const list = matchListFor({ profile, targetSlug: roles2x[0].slug, resumeId: null, weeklyHours: 6, roles: roles2x, now: new Date("2026-10-29T00:00:00Z") });
    expect(list.roles.length).toBeLessThanOrEqual(roles2x.length);
    // Every skill against every role twice: seconds on CI, more with each role batch.
  }, 60_000);

  it("takes tracks for every role, twice over", () => {
    const tracks = roleTracks[0].tracks;
    const file = { reviewed: false, note: "Every role, twice.", roles: roles2x.map((r) => ({ roleSlug: r.slug, tracks })) };
    expect(roleTracksFile.safeParse(file).error).toBeUndefined();
  });

  it("builds the Library from every resource, five times over, with every one saved and ticked", () => {
    const rows = resources.map((r, i): CatalogRow => ({ id: `res-${i}`, title: r.title, url: r.url, provider: r.provider, kind: r.kind, minutes: r.minutes, free: r.free, skillIds: r.skillIds }));
    // Five copies: past the 3,000 the Library used to take.
    const catalog = [1, 2, 3, 4, 5].flatMap((k) => rows.map((r) => ({ ...r, id: `${r.id}-x${k}` })));
    expect(catalog.length).toBeLessThanOrEqual(LIBRARY_ITEMS_MAX);
    const ids = catalog.map((r) => r.id);
    const view = buildLibrary({
      role: null,
      pathHref: null,
      goals: [],
      learnSkill: new Map(),
      catalog,
      languageByUrl: new Map(),
      skillNames: skillName,
      ticked: new Set(),
      ride: null,
      marks: { saved: ids, ticked: ids, added: [] },
    });
    expect(view.items).toHaveLength(catalog.length);
    expect(view.saved).toHaveLength(catalog.length);
  });

  it("lists every certificate on our list on one goal, twice over, on the Map, Today and the Library", () => {
    const all = certificatesFor(skills.map((s) => s.id));
    expect(all.length).toBeGreaterThan(0);
    const certs = twice(all, (c) => ({ ...c, id: `${c.id}-x2` }));
    expect(certs.length).toBeLessThanOrEqual(GOAL_CERTIFICATES_MAX);
    expect(mapGoal.safeParse({ ...exampleMapLine.goals[0], certificates: certs }).error).toBeUndefined();
    expect(provePitstop.safeParse({ ...(exampleRide.prove ?? {}), certificates: certs }).error).toBeUndefined();
    const goal = { goalId: null, skillId: "sql", name: "SQL", status: "missing", learnPitstop: 1, provePitstop: 2, now: false, learnDone: false, resourceIds: [] };
    expect(libraryGoal.safeParse({ ...goal, certificates: certs.map(({ name, issuer }) => ({ name, issuer })) }).error).toBeUndefined();
  });

  it("shows Practice for every skill in the taxonomy, with twice a skill's questions", () => {
    const question = practiceQuestions[0];
    const asked = practiceQuestions.filter((q) => q.skillId === question.skillId).map((q) => ({ id: q.id, question: q.question, lookFor: q.lookFor }));
    const questions = twice(asked, (q) => ({ ...q, id: `${q.id}-x2` }));
    const view = {
      skills: skills.map((s) => ({ skillId: s.id, name: s.name, tag: "ahead", questions, ratings: [] })),
      left: null,
      noQuestions: [],
      job: null,
    };
    expect(practiceView.safeParse(view).error).toBeUndefined();
  });

  it("reads an interest topic list twice the size of today's", () => {
    const copy = twice(interestTopics, (t) => ({ ...t, key: `${t.key}-x2`, aliases: t.aliases.map((a) => `${a} x2`), ambiguous: t.ambiguous.map((a) => `${a} x2`) }));
    expect(interestTopicsFile.safeParse(copy).error).toBeUndefined();
  });

  it("tags one event with at most 5 of its topics, goals first, for a person whose goals are the whole taxonomy (T165)", () => {
    const names = skills.map((s) => s.name).join(", ");
    const topics = topicsOf(names, names);
    const startsAt = new Date("2026-10-16T12:30:00Z");
    const event = {
      id: "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
      title: "Every skill night",
      organiser: "Example Meetup",
      kind: "meetup" as const,
      startsAt,
      endsAt: startsAt,
      online: true,
      city: null,
      venue: null,
      cost: "Free",
      sourceUrl: "https://events.example.org/every",
      status: "live" as const,
      topics,
      rsvp: null,
    };
    const person = { city: null, radiusKm: 25, online: true, goalSkillIds: skills.map((s) => s.id), interestKeys: interestTopics.map((t) => t.key) };
    const view = timetableFor([event], person, new Date("2026-10-14T06:30:00Z"));
    expect(topics.length).toBeGreaterThan(5);
    expect(view.groups[0].events[0].tags).toHaveLength(5);
    expect(view.groups[0].events[0].tags.every((t) => t.kind === "goal")).toBe(true);
    expect(timetableView.safeParse(view).error).toBeUndefined();
  });
});
