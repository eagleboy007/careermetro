import { describe, expect, it } from "vitest";
import roleTracksJson from "@/content/role-tracks.json";
import { roleProfiles, roleTracks, skills } from "@/content";
import { exampleGoalsWithTracks } from "@/lib/today/fixtures";
import { MAX_TRACKS_PER_ROLE } from "./constants";
import { roleTrackProblems, roleTracksFile, trackChoice, trackPicker, type RoleTracksFile } from "./role-track";
import { goalsSummary } from "./today";

const taxonomy = new Set(skills.map((s) => s.id));
const role = {
  slug: "example-role",
  skills: [
    { skillId: "sql", importance: "required" as const, expectation: "e", postingShare: null },
    { skillId: "python", importance: "required" as const, expectation: "e", postingShare: null },
    { skillId: "excel", importance: "required" as const, expectation: "e", postingShare: null },
    { skillId: "statistics", importance: "required" as const, expectation: "e", postingShare: null },
    { skillId: "aws", importance: "required" as const, expectation: "e", postingShare: null, oneOf: "cloud" },
    { skillId: "azure", importance: "required" as const, expectation: "e", postingShare: null, oneOf: "cloud" },
    { skillId: "tableau", importance: "nice_to_have" as const, expectation: "e", postingShare: null },
  ],
};
const track = (over: Partial<RoleTracksFile["roles"][number]["tracks"][number]> = {}) => ({
  id: "bi",
  name: "BI",
  blurb: "Dashboards",
  description: "Dashboards.",
  add: ["tableau"],
  drop: [],
  first: [],
  reviewed: false,
  ...over,
});
const file = (tracks: ReturnType<typeof track>[], roleSlug = role.slug): RoleTracksFile => ({ reviewed: false, note: "n", roles: [{ roleSlug, tracks }] });

describe("role tracks content", () => {
  it("reads, and every track and the file wait for review", () => {
    const parsed = roleTracksFile.parse(roleTracksJson);
    expect(parsed.reviewed).toBe(false);
    expect(parsed.roles.flatMap((r) => r.tracks).every((t) => t.reviewed === false)).toBe(true);
    expect(roleTracks.length).toBe(parsed.roles.length);
  });

  it("passes the checks against the role profiles and the taxonomy", () => {
    expect(roleTrackProblems(roleTracksFile.parse(roleTracksJson), roleProfiles, taxonomy)).toEqual([]);
  });

  it("names only role profiles, each once, with at most five tracks and unique ids", () => {
    const slugs = new Set(roleProfiles.map((r) => r.slug));
    expect(roleTracks.every((r) => slugs.has(r.roleSlug))).toBe(true);
    expect(new Set(roleTracks.map((r) => r.roleSlug)).size).toBe(roleTracks.length);
    for (const r of roleTracks) {
      expect(r.tracks.length).toBeLessThanOrEqual(MAX_TRACKS_PER_ROLE);
      expect(new Set(r.tracks.map((t) => t.id)).size).toBe(r.tracks.length);
    }
  });

  it("refuses more than five tracks in the schema", () => {
    const six = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}`, name: `T${i}` }));
    expect(roleTracksFile.safeParse(file(six)).success).toBe(false);
  });
});

describe("roleTrackProblems", () => {
  it("accepts a track that edits its role's own skills", () => {
    expect(roleTrackProblems(file([track({ drop: ["excel"], first: ["tableau", "sql"] })]), [role], taxonomy)).toEqual([]);
  });

  it("finds unknown roles and skills, repeats and empty tracks", () => {
    expect(roleTrackProblems(file([track()], "no-such-role"), [role], taxonomy)).toEqual(["no-such-role: no such role profile"]);
    expect(roleTrackProblems(file([track({ add: ["not-a-skill"] })]), [role], taxonomy).join()).toContain("not-a-skill is not in the taxonomy");
    expect(roleTrackProblems(file([track(), track()]), [role], taxonomy).join()).toContain("id used twice");
    expect(roleTrackProblems(file([track(), track({ id: "other" })]), [role], taxonomy).join()).toContain("name used twice");
    expect(roleTrackProblems(file([track({ add: [] })]), [role], taxonomy).join()).toContain("changes nothing");
    const twice = { reviewed: false, note: "n", roles: [file([track()]).roles[0], file([track()]).roles[0]] };
    expect(roleTrackProblems(twice, [role], taxonomy).join()).toContain("listed twice");
  });

  it("keeps add to nice-to-haves, drop to required skills outside a group, and first to what the track requires", () => {
    expect(roleTrackProblems(file([track({ add: ["sql"] })]), [role], taxonomy).join()).toContain("adds sql");
    expect(roleTrackProblems(file([track({ drop: ["tableau"] })]), [role], taxonomy).join()).toContain("drops tableau");
    expect(roleTrackProblems(file([track({ drop: ["aws"] })]), [role], taxonomy).join()).toContain("drops aws");
    expect(roleTrackProblems(file([track({ add: [], first: ["tableau"] })]), [role], taxonomy).join()).toContain("puts tableau first");
    expect(roleTrackProblems(file([track({ drop: ["sql"], first: ["sql"] })]), [role], taxonomy).join()).toContain("puts sql first");
    expect(roleTrackProblems(file([track({ first: ["azure"] })]), [role], taxonomy).join()).toContain("puts azure first");
  });

  it("keeps at least three required skills", () => {
    expect(roleTrackProblems(file([track({ add: [], drop: ["sql", "python", "excel", "statistics"] })]), [role], taxonomy).join()).toContain("fewer than 3");
  });

  it("lets one track be reviewed on its own, but a file marked reviewed has no unreviewed track", () => {
    expect(roleTrackProblems(file([track({ reviewed: true }), track({ id: "other", name: "Other" })]), [role], taxonomy)).toEqual([]);
    expect(roleTrackProblems({ ...file([track()]), reviewed: true }, [role], taxonomy).join()).toContain("not reviewed in a file marked reviewed");
  });
});

describe("trackChoice and trackPicker", () => {
  it("takes a track id or null, nothing else", () => {
    expect(trackChoice.safeParse("bi-reporting").success).toBe(true);
    expect(trackChoice.safeParse(null).success).toBe(true);
    for (const bad of ["", "BI", "a b", 3, undefined, "x".repeat(61)]) expect(trackChoice.safeParse(bad).success).toBe(false);
  });

  it("needs the current track among unique options", () => {
    const option = (id: string | null) => ({ id, name: id ?? "Data Analyst", blurb: "b", goals: 3, met: 1, firstGoals: ["SQL"], moreGoals: 1 });
    expect(trackPicker.safeParse({ role: "Data Analyst", current: null, options: [option(null), option("bi")] }).success).toBe(true);
    expect(trackPicker.safeParse({ role: "Data Analyst", current: "x", options: [option(null), option("bi")] }).success).toBe(false);
    expect(trackPicker.safeParse({ role: "Data Analyst", current: null, options: [option(null), option(null)] }).success).toBe(false);
  });

  it("reads the /design example of Your goals with the picker", () => {
    expect(goalsSummary.parse(exampleGoalsWithTracks).picker?.options).toHaveLength(5);
  });
});
