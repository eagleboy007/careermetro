import { z } from "zod";
import { MAX_TRACKS_PER_ROLE } from "./constants";
import type { RoleProfile } from "./role-profile";

/*
 * Role tracks (v44 gap list item 11, docs/plans/tracks-plan.md): the kinds of work within a role, such as BI and
 * reporting or Product analytics for a Data Analyst. A track is a deterministic edit of its role's own skill list, so
 * gap matching stays code over the taxonomy: `add` makes nice-to-have skills of the role required, `drop` makes required
 * skills nice to have, and `first` puts skills first on the line, in that order. Hand-written content, never written by
 * the model; `reviewed` stays false until someone who works in the role checks it, and production offers only reviewed
 * tracks.
 */

const slug = z.string().regex(/^[a-z0-9-]+$/).max(60);
const skillIds = z.array(slug).max(10);

export const roleTrack = z.strictObject({
  id: slug,
  /** The chip's words and the option's title. */
  name: z.string().min(1).max(40),
  /** The option's small line, before the goal count, such as "Dashboards, Power BI". */
  blurb: z.string().min(1).max(40),
  /** One line on the kind of work, for the review draft. */
  description: z.string().min(1).max(160),
  add: skillIds,
  drop: skillIds,
  first: skillIds,
  reviewed: z.boolean(),
});
export type RoleTrack = z.infer<typeof roleTrack>;

export const roleTracks = z.strictObject({
  roleSlug: slug,
  tracks: z.array(roleTrack).min(1).max(MAX_TRACKS_PER_ROLE),
});
export type RoleTracks = z.infer<typeof roleTracks>;

/**
 * src/content/role-tracks.json: a note on where the content came from, each role's tracks, and `reviewed`, true only
 * once every track in it has been reviewed. Production goes by each track's own flag.
 */
export const roleTracksFile = z.strictObject({
  reviewed: z.boolean(),
  note: z.string().min(1).max(1000),
  roles: z.array(roleTracks).max(200),
});
export type RoleTracksFile = z.infer<typeof roleTracksFile>;

/** Fewest required skills a track may leave its role with. */
export const MIN_TRACK_REQUIRED = 3;

/**
 * The checks that need the role profiles and the taxonomy: every skill id exists, each track edits only its role's
 * own skills (`add` a nice-to-have, `drop` a required skill outside any "one of these" group, `first` a skill the track
 * requires and that isn't in a group), each track changes something, ids and names are unique within a role, a role is
 * listed once, a track leaves at least MIN_TRACK_REQUIRED required skills, and a file marked reviewed has no unreviewed
 * track. Returns the problems, none when it reads.
 */
export function roleTrackProblems(file: RoleTracksFile, roles: readonly Pick<RoleProfile, "slug" | "skills">[], taxonomy: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const bySlug = new Map(roles.map((r) => [r.slug, r]));
  const seenRoles = new Set<string>();
  for (const { roleSlug, tracks } of file.roles) {
    const role = bySlug.get(roleSlug);
    if (!role) {
      problems.push(`${roleSlug}: no such role profile`);
      continue;
    }
    if (seenRoles.has(roleSlug)) problems.push(`${roleSlug}: listed twice`);
    seenRoles.add(roleSlug);
    const skill = new Map(role.skills.map((s) => [s.skillId, s]));
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const t of tracks) {
      const at = `${roleSlug}/${t.id}`;
      if (ids.has(t.id)) problems.push(`${at}: id used twice`);
      if (names.has(t.name.toLowerCase())) problems.push(`${at}: name used twice`);
      ids.add(t.id);
      names.add(t.name.toLowerCase());
      if (file.reviewed && !t.reviewed) problems.push(`${at}: not reviewed in a file marked reviewed`);
      if (!t.add.length && !t.drop.length && !t.first.length) problems.push(`${at}: changes nothing`);
      const all = [...t.add, ...t.drop, ...t.first];
      for (const id of all) if (!taxonomy.has(id)) problems.push(`${at}: ${id} is not in the taxonomy`);
      for (const list of [t.add, t.drop, t.first]) if (new Set(list).size !== list.length) problems.push(`${at}: a skill is listed twice`);
      for (const id of t.add) if (skill.get(id)?.importance !== "nice_to_have") problems.push(`${at}: adds ${id}, not a nice-to-have of the role`);
      for (const id of t.drop) {
        const s = skill.get(id);
        if (s?.importance !== "required" || s.oneOf !== undefined) problems.push(`${at}: drops ${id}, not a required skill outside a group`);
        if (t.add.includes(id)) problems.push(`${at}: adds and drops ${id}`);
      }
      for (const id of t.first) {
        const s = skill.get(id);
        const required = t.add.includes(id) || (s?.importance === "required" && s.oneOf === undefined && !t.drop.includes(id));
        if (!required) problems.push(`${at}: puts ${id} first, which the track doesn't require on its own`);
      }
      const left = role.skills.filter((s) => (s.importance === "required" && !t.drop.includes(s.skillId)) || t.add.includes(s.skillId)).length;
      if (left < MIN_TRACK_REQUIRED) problems.push(`${at}: leaves fewer than ${MIN_TRACK_REQUIRED} required skills`);
    }
  }
  return problems;
}

/** "Switch track": a track id of the person's goal role, or null for the whole role. */
export const trackChoice = z.union([slug, z.null()]);

/** One option in the Track picker on Your goals, worked out on the server. */
export const trackOption = z.strictObject({
  /** Null for the whole role. */
  id: slug.nullable(),
  name: z.string().min(1).max(60),
  blurb: z.string().min(1).max(60),
  /** Goals on this track, met ones included. */
  goals: z.number().int().min(0).max(40),
  met: z.number().int().min(0).max(40),
  /** The track's first open goals by name, for the preview. */
  firstGoals: z.array(z.string().min(1).max(80)).max(3),
  /** Open goals after `firstGoals`. */
  moreGoals: z.number().int().min(0).max(40),
});
export type TrackOption = z.infer<typeof trackOption>;

/** The Track picker: the destination role's title, the options (the whole role first) and the one in use. */
export const trackPicker = z
  .strictObject({
    role: z.string().min(1).max(80),
    current: slug.nullable(),
    options: z.array(trackOption).min(2).max(MAX_TRACKS_PER_ROLE + 1),
  })
  .refine((p) => p.options.some((o) => o.id === p.current), { message: "the current track is an option" })
  .refine((p) => new Set(p.options.map((o) => o.id)).size === p.options.length, { message: "options are unique" });
export type TrackPicker = z.infer<typeof trackPicker>;
