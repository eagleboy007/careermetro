import "server-only";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { interests, junctionCommentVotes, junctionComments, junctionPostInterests, junctionPosts, junctionReshares, junctionSaves, junctionVotes, userSettings, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { initialsOf } from "@/lib/inbox/types";
import { logEvent } from "@/lib/log";
import { roleTitleOf, targetRoleSlugOf } from "@/lib/network/store";
import { JUNCTION_PAGE_SIZE } from "@/lib/schemas/constants";
import { commentView, feedQuery, postCardView, type CommentView, type FeedPage, type PostCardView } from "@/lib/schemas/junction";
import { DAY_MS, TOP_WINDOW_DAYS } from "@/lib/schemas/legal-timings";
import { decodeCursor, encodeCursor } from "./rules";

/*
 * Junction's reads (docs/plans/junction-plan.md section 1, FR-61). Every feed leaves out deleted posts, posts by
 * suspended or deleting accounts and anyone the viewer blocked or who blocked them; a held or pending post reaches only
 * its author, a hidden one only its author's own page (post detail, Your posts). The same rule as `canSeePost` in
 * rules.ts. Pages are keyset (20 a page, "Show more"), never offset. Logs carry event names and counts only.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

/** The most comments one post shows at once (oldest first). */
const COMMENTS_SHOWN = 200;

export type FeedResult =
  | { ok: true; page: FeedPage; needs: "route" | "interests" | null }
  | { ok: false; error: "invalid" | "unavailable" };

/** Microsecond ISO text, so a cursor never skips or repeats posts made in the same millisecond. */
const isoUs = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Who may see post `p` (author `u`) in a feed: the shared rule, held posts to their author only, never hidden ones. */
function feedVisible(viewerId: string): SQL {
  return sql`p.deleted_at is null and u.suspended_at is null and u.deletion_requested_at is null
    and (p.status = 'visible' or (p.author_id = ${viewerId} and p.status in ('held', 'pending')))
    and not exists (select 1 from blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = ${viewerId}))`;
}

async function viewerActive(viewerId: string, db: Db): Promise<boolean> {
  const [me] = await db.select({ suspendedAt: users.suspendedAt, deletionRequestedAt: users.deletionRequestedAt }).from(users).where(eq(users.id, viewerId));
  return !!me && !me.suspendedAt && !me.deletionRequestedAt;
}

type Hit = { id: string; at: string; points: number | null; by: string | null };

/** One feed page of posts, in the tab's order, with the cursor for the next. */
export async function feedFor(viewerId: string, raw: unknown, deps: Deps = {}): Promise<FeedResult> {
  const parsed = feedQuery.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "invalid" };
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!(await viewerActive(viewerId, db))) return { ok: false, error: "unavailable" };
  const q = parsed.data;
  const top = q.feed === "top";
  const cursor = decodeCursor(q.cursor, top);
  if (q.cursor && !cursor) return { ok: false, error: "invalid" };
  const take = JUNCTION_PAGE_SIZE + 1;
  const visible = feedVisible(viewerId);
  let hits: Hit[];

  if (q.feed === "following") {
    const after = cursor ? sql`and (b.at, b.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``;
    const rows = await db.execute<{ id: string; at: string; by: string | null }>(sql`
      with friends as (
        select case when c.user_low = ${viewerId} then c.user_high else c.user_low end as id
        from connections c where c.user_low = ${viewerId} or c.user_high = ${viewerId}
      ),
      items as (
        select p.id, p.created_at as at, null::uuid as by from junction_posts p where p.author_id in (select id from friends)
        union all
        select r.post_id, r.created_at, r.user_id from junction_reshares r
          join users ru on ru.id = r.user_id
          where r.user_id in (select id from friends) and ru.suspended_at is null and ru.deletion_requested_at is null
      ),
      best as (select distinct on (id) id, at, by from items order by id, at desc)
      select b.id, ${isoUs(sql`b.at`)} as at, b.by from best b
        join junction_posts p on p.id = b.id
        join users u on u.id = p.author_id
      where ${visible} ${after}
      order by b.at desc, b.id desc
      limit ${take}`);
    hits = Array.from(rows as unknown as { id: string; at: string; by: string | null }[]).map((r) => ({ ...r, points: null }));
  } else {
    let scope: SQL = sql`true`;
    let needs: "route" | "interests" | null = null;
    if (top) scope = sql`p.created_at >= ${new Date(now.getTime() - TOP_WINDOW_DAYS * DAY_MS).toISOString()}::timestamptz`;
    if (q.feed === "route") {
      const slug = await targetRoleSlugOf(viewerId, db);
      if (!slug) needs = "route";
      else scope = sql`p.route_slug = ${slug}`;
    }
    if (q.feed === "interests") {
      if (q.interestId) {
        scope = sql`exists (select 1 from junction_post_interests pi join interests i on i.id = pi.interest_id
          where pi.post_id = p.id and pi.interest_id = ${q.interestId} and i.hidden_at is null)`;
      } else {
        const [mine] = await db.execute<{ n: number }>(sql`select count(*)::int as n from user_interests where user_id = ${viewerId} and interest_id is not null`);
        if (!mine || !Number((mine as { n: number }).n)) needs = "interests";
        else
          scope = sql`exists (select 1 from junction_post_interests pi join interests i on i.id = pi.interest_id
            where pi.post_id = p.id and i.hidden_at is null
              and pi.interest_id in (select ui.interest_id from user_interests ui where ui.user_id = ${viewerId} and ui.interest_id is not null))`;
      }
    }
    if (needs) return { ok: true, page: { posts: [], nextCursor: null }, needs };
    const after = !cursor
      ? sql``
      : top
        ? sql`and (p.top_points, p.created_at, p.id) < (${cursor.points}::int, ${cursor.at}::timestamptz, ${cursor.id}::uuid)`
        : sql`and (p.created_at, p.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    const order = top ? sql`p.top_points desc, p.created_at desc, p.id desc` : sql`p.created_at desc, p.id desc`;
    const rows = await db.execute<{ id: string; at: string; points: number }>(sql`
      select p.id, ${isoUs(sql`p.created_at`)} as at, p.top_points as points
      from junction_posts p join users u on u.id = p.author_id
      where ${visible} and ${scope} ${after}
      order by ${order}
      limit ${take}`);
    hits = Array.from(rows as unknown as { id: string; at: string; points: number }[]).map((r) => ({ id: r.id, at: r.at, points: top ? Number(r.points) : null, by: null }));
  }

  const more = hits.length > JUNCTION_PAGE_SIZE;
  const shown = hits.slice(0, JUNCTION_PAGE_SIZE);
  const last = shown.at(-1);
  const cards = await cardsFor(viewerId, shown, db);
  logEvent("info", "junction_feed_read", { feed: q.feed, count: cards.length });
  return {
    ok: true,
    page: { posts: cards, nextCursor: more && last ? encodeCursor({ points: last.points, at: last.at, id: last.id }) : null },
    needs: null,
  };
}

/** The posts behind the hits, in the hits' order, as cards for this viewer. A card that doesn't fit is left out. */
async function cardsFor(viewerId: string, hits: Pick<Hit, "id" | "by">[], db: Db): Promise<PostCardView[]> {
  if (!hits.length) return [];
  const ids = hits.map((h) => h.id);
  const resharers = [...new Set(hits.map((h) => h.by).filter((x): x is string => !!x))];
  const [posts, tags, votes, saves, reshares, names] = await Promise.all([
    db
      .select({
        id: junctionPosts.id,
        kind: junctionPosts.kind,
        title: junctionPosts.title,
        body: junctionPosts.body,
        linkUrl: junctionPosts.linkUrl,
        linkHost: junctionPosts.linkHost,
        routeSlug: junctionPosts.routeSlug,
        upvotes: junctionPosts.upvoteCount,
        comments: junctionPosts.commentCount,
        reshares: junctionPosts.reshareCount,
        status: junctionPosts.status,
        createdAt: junctionPosts.createdAt,
        editedAt: junctionPosts.editedAt,
        authorId: junctionPosts.authorId,
        authorName: users.name,
        authorHandle: users.username,
        showRole: userSettings.showTargetRole,
      })
      .from(junctionPosts)
      .innerJoin(users, eq(users.id, junctionPosts.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, junctionPosts.authorId))
      .where(inArray(junctionPosts.id, ids)),
    db
      .select({ postId: junctionPostInterests.postId, id: interests.id, name: interests.name })
      .from(junctionPostInterests)
      .innerJoin(interests, eq(interests.id, junctionPostInterests.interestId))
      .where(and(inArray(junctionPostInterests.postId, ids), isNull(interests.hiddenAt)))
      .orderBy(asc(interests.nameKey)),
    db.select({ postId: junctionVotes.postId }).from(junctionVotes).where(and(eq(junctionVotes.userId, viewerId), inArray(junctionVotes.postId, ids))),
    db.select({ postId: junctionSaves.postId }).from(junctionSaves).where(and(eq(junctionSaves.userId, viewerId), inArray(junctionSaves.postId, ids))),
    db.select({ postId: junctionReshares.postId }).from(junctionReshares).where(and(eq(junctionReshares.userId, viewerId), inArray(junctionReshares.postId, ids))),
    resharers.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, resharers)) : Promise.resolve([] as { id: string; name: string | null }[]),
  ]);
  const byId = new Map(posts.map((p) => [p.id, p] as const));
  const tagsOf = new Map<string, { id: string; name: string }[]>();
  for (const t of tags) tagsOf.set(t.postId, [...(tagsOf.get(t.postId) ?? []), { id: t.id, name: t.name }]);
  const voted = new Set(votes.map((v) => v.postId));
  const saved = new Set(saves.map((v) => v.postId));
  const reshared = new Set(reshares.map((v) => v.postId));
  const nameOf = new Map(names.map((n) => [n.id, displayName(n.name)]));

  return hits.flatMap((h) => {
    const p = byId.get(h.id);
    if (!p) return [];
    const isYou = p.authorId === viewerId;
    const name = displayName(p.authorName);
    // The route label shows only when the author has "Show target role" on (plan section 4, Privacy).
    const route = isYou || p.showRole ? roleTitleOf(p.routeSlug) : null;
    const card = postCardView.safeParse({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      link: p.linkUrl && p.linkHost ? { url: p.linkUrl, host: p.linkHost } : null,
      author: { name, handle: p.authorHandle ?? null, initials: initialsOf(name) || "?", route, isYou },
      routeLabel: route,
      interests: tagsOf.get(p.id) ?? [],
      upvotes: p.upvotes,
      comments: p.comments,
      reshares: p.reshares,
      voted: voted.has(p.id),
      saved: saved.has(p.id),
      reshared: reshared.has(p.id),
      resharedBy: h.by ? (nameOf.get(h.by) ?? null) : null,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      editedAt: p.editedAt?.toISOString() ?? null,
    });
    if (!card.success) logEvent("warn", "junction_card_unshown");
    return card.success ? [card.data] : [];
  });
}

/**
 * One post for its detail page: what the feeds show, plus the author's own hidden post (with its notice on their page).
 * Null when it isn't there for this viewer.
 */
export async function postById(viewerId: string, postId: string, deps: Deps = {}): Promise<PostCardView | null> {
  const db = deps.db ?? getDb();
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !(await viewerActive(viewerId, db))) return null;
  const rows = await db.execute<{ id: string }>(sql`
    select p.id from junction_posts p join users u on u.id = p.author_id
    where p.id = ${postId} and p.deleted_at is null and u.suspended_at is null and u.deletion_requested_at is null
      and (p.status = 'visible' or p.author_id = ${viewerId})
      and not exists (select 1 from blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = ${viewerId}))`);
  const hit = Array.from(rows as unknown as { id: string }[])[0];
  if (!hit) return null;
  const [card] = await cardsFor(viewerId, [{ id: hit.id, by: null }], db);
  return card ?? null;
}

/**
 * A post's comments, oldest first, for a viewer who may see the post: visible ones by active accounts with no block
 * either way, and the viewer's own held or hidden ones. A comment names its author without a route label (only posts
 * carry one, and only when the author shows their target role).
 */
export async function commentsFor(viewerId: string, postId: string, deps: Deps = {}): Promise<CommentView[]> {
  const db = deps.db ?? getDb();
  if (!(await postById(viewerId, postId, deps))) return [];
  const rows = await db
    .select({
      id: junctionComments.id,
      postId: junctionComments.postId,
      body: junctionComments.body,
      upvotes: junctionComments.upvoteCount,
      status: junctionComments.status,
      createdAt: junctionComments.createdAt,
      authorId: junctionComments.authorId,
      authorName: users.name,
      authorHandle: users.username,
      voted: sql<boolean>`exists (select 1 from ${junctionCommentVotes} v where v.comment_id = ${junctionComments.id} and v.user_id = ${viewerId})`,
    })
    .from(junctionComments)
    .innerJoin(users, eq(users.id, junctionComments.authorId))
    .where(
      and(
        eq(junctionComments.postId, postId),
        isNull(junctionComments.deletedAt),
        isNull(users.suspendedAt),
        isNull(users.deletionRequestedAt),
        sql`(${junctionComments.status} = 'visible' or ${junctionComments.authorId} = ${viewerId})`,
        sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = ${junctionComments.authorId}) or (b.blocker_id = ${junctionComments.authorId} and b.blocked_id = ${viewerId}))`,
      ),
    )
    .orderBy(asc(junctionComments.createdAt), asc(junctionComments.id))
    .limit(COMMENTS_SHOWN);
  return rows.flatMap((r) => {
    const name = displayName(r.authorName);
    const view = commentView.safeParse({
      id: r.id,
      postId: r.postId,
      body: r.body,
      author: { name, handle: r.authorHandle ?? null, initials: initialsOf(name) || "?", route: null, isYou: r.authorId === viewerId },
      upvotes: r.upvotes,
      voted: !!r.voted,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    });
    if (!view.success) logEvent("warn", "junction_comment_unshown");
    return view.success ? [view.data] : [];
  });
}
