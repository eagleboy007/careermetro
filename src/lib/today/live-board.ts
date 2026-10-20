import { departure, type Departure, type JobPost } from "@/lib/schemas";
import { clip } from "@/lib/text";

/*
 * Today's Departures board from live posts (handoff section 5, docs/plans/departures-live-plan.md): open feed posts
 * grouped by role and city, ordered by gaps left. Fit is the same plain-code matcher as /departures (postView), so a
 * row and the posts it stands for always agree. Pure, so tests can use it.
 */

/** Rows the board shows. */
export const BOARD_ROWS = 5;

/** A post as the board reads it: its row on /departures. */
export type BoardPost = Pick<JobPost, "roleSlug" | "city" | "goalsBefore" | "gaps" | "fitNote" | "closed" | "destination">;

function note(gaps: number, destination: boolean): string {
  const lead = gaps === 0 ? "No required gaps in the closest post." : `${gaps === 1 ? "One gap" : `${gaps} gaps`} in the closest post.`;
  return destination ? `${lead} This is your destination.` : lead;
}

/**
 * Up to five rows, one per library role and city, from posts whose fit could be read (a post naming too few skills, a
 * closed post or one no library role matches is left out). Each row counts its posts and takes the closest one's gaps;
 * rows go by gaps left, then the line's own role, then most posts, then name.
 */
export function boardRows(posts: readonly BoardPost[], roleTitle: (slug: string) => string | null): Departure[] {
  type Group = { slug: string; title: string; city: string; posts: BoardPost[] };
  const groups = new Map<string, Group>();
  for (const p of posts) {
    if (p.closed || p.fitNote || !p.roleSlug) continue;
    const title = roleTitle(p.roleSlug);
    if (!title) continue;
    const key = `${p.roleSlug}|${p.city}`;
    const group: Group = groups.get(key) ?? { slug: p.roleSlug, title, city: p.city, posts: [] };
    group.posts.push(p);
    groups.set(key, group);
  }
  const rows = [...groups.values()].map((g) => {
    const best = g.posts.reduce((a, b) => (b.goalsBefore < a.goalsBefore ? b : a));
    return { g, best };
  });
  rows.sort(
    (a, b) =>
      a.best.goalsBefore - b.best.goalsBefore ||
      Number(b.best.destination) - Number(a.best.destination) ||
      b.g.posts.length - a.g.posts.length ||
      a.g.title.localeCompare(b.g.title, "en") ||
      a.g.city.localeCompare(b.g.city, "en"),
  );
  return rows.slice(0, BOARD_ROWS).map(({ g, best }, i) =>
    departure.parse({
      id: `row-${i + 1}`,
      role: clip(g.title, 60),
      where: clip(`${g.city} · ${g.posts.length === 1 ? "1 post" : `${g.posts.length} posts`}`, 60),
      gapsLeft: best.goalsBefore,
      gaps: best.gaps.slice(0, 10).map((x) => ({ status: x.status, name: clip(x.name, 60) })),
      note: note(best.goalsBefore, best.destination),
    }),
  );
}
