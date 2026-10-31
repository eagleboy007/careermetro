import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  interests,
  junctionCommentVotes,
  junctionComments,
  junctionPins,
  junctionPostInterests,
  junctionPosts,
  junctionReshares,
  junctionSaves,
  junctionVotes,
  resources,
  skills,
  userGoals,
  userInterests,
  userSettings,
  users,
} from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { goalOnCurrentLine } from "@/lib/gaps/current";
import { initialsOf } from "@/lib/inbox/types";
import { logEvent } from "@/lib/log";
import { roleTitleOf, targetRoleSlugOf } from "@/lib/network/store";
import { JUNCTION_PAGE_SIZE, JUNCTION_PINS_MAX } from "@/lib/schemas/constants";
import {
  catalogCardView,
  commentView,
  feedQuery,
  goalLineView,
  postCardView,
  type CatalogCardView,
  type CommentView,
  type FeedPage,
  type GoalLineView,
  type PostCardView,
} from "@/lib/schemas/junction";
import { DAY_MS, TOP_WINDOW_DAYS } from "@/lib/legal-timings";
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

/** The Library catalog cards for these items, live: an item an admin hid has no card. */
async function catalogCards(ids: (string | null)[], db: Db): Promise<Map<string, CatalogCardView>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes })
    .from(resources)
    .where(and(inArray(resources.id, wanted), isNull(resources.hiddenAt)));
  const out = new Map<string, CatalogCardView>();
  for (const r of rows) {
    const card = catalogCardView.safeParse({ title: r.title.slice(0, 300), provider: r.provider.slice(0, 120), kind: r.kind.slice(0, 40), minutes: Math.max(0, r.minutes) });
    if (card.success) out.set(r.id, card.data);
  }
  return out;
}

/**
 * "Where I am on my line" for each (author, goal) pair, drawn live from the author's goals on their current line (not
 * skipped, in line order): "Step 6 of 9", the skill and whether it is met. A goal that left the line has no line.
 */
async function goalLines(pairs: { userId: string; goalId: string }[], db: Db): Promise<Map<string, GoalLineView>> {
  const authors = [...new Set(pairs.map((p) => p.userId))];
  if (!authors.length) return new Map();
  const rows = await db
    .select({ id: userGoals.id, userId: userGoals.userId, status: userGoals.status, skill: skills.name })
    .from(userGoals)
    .innerJoin(skills, eq(skills.id, userGoals.skillId))
    .where(and(inArray(userGoals.userId, authors), ne(userGoals.status, "skipped"), goalOnCurrentLine))
    .orderBy(asc(userGoals.userId), asc(userGoals.position), asc(userGoals.id));
  const lineOf = new Map<string, typeof rows>();
  for (const r of rows) lineOf.set(r.userId, [...(lineOf.get(r.userId) ?? []), r]);
  const out = new Map<string, GoalLineView>();
  for (const { userId, goalId } of pairs) {
    const line = lineOf.get(userId) ?? [];
    const at = line.findIndex((g) => g.id === goalId);
    if (at < 0) continue;
    const view = goalLineView.safeParse({ step: at + 1, of: line.length, skill: line[at]!.skill.slice(0, 120), met: line[at]!.status === "met" });
    if (view.success) out.set(goalId, view.data);
  }
  return out;
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
        resourceId: junctionPosts.resourceId,
        goalId: junctionPosts.goalId,
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
  const [catalog, lines] = await Promise.all([
    catalogCards(posts.map((p) => p.resourceId), db),
    goalLines(posts.flatMap((p) => (p.goalId ? [{ userId: p.authorId, goalId: p.goalId }] : [])), db),
  ]);

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
      // The card follows the link: a post whose link was edited away, or whose catalog item was hidden, has none.
      catalog: p.linkUrl && p.resourceId ? (catalog.get(p.resourceId) ?? null) : null,
      goal: p.goalId ? (lines.get(p.goalId) ?? null) : null,
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

/* Your posts, Saved, pins and the profile (parts 3 and 4) ------------------------------------------------------------ */

export type ListResult = { ok: true; page: FeedPage } | { ok: false; error: "invalid" | "unavailable" };

/** A keyset page over rows already in order (newest first), as cards. */
async function pageOf(viewerId: string, rows: { id: string; at: string }[], db: Db): Promise<FeedPage> {
  const more = rows.length > JUNCTION_PAGE_SIZE;
  const shown = rows.slice(0, JUNCTION_PAGE_SIZE);
  const last = shown.at(-1);
  const cards = await cardsFor(
    viewerId,
    shown.map((r) => ({ id: r.id, by: null })),
    db,
  );
  return { posts: cards, nextCursor: more && last ? encodeCursor({ points: null, at: last.at, id: last.id }) : null };
}

/**
 * Your posts on /junction/mine, newest first, 20 a page: every post you haven't deleted, held and hidden ones too, with
 * their text (your own content; a hidden one carries its notice on the page).
 */
export async function ownPostsPage(viewerId: string, cursor: string | undefined, deps: Deps = {}): Promise<ListResult> {
  const db = deps.db ?? getDb();
  const at = decodeCursor(cursor, false);
  if (cursor && !at) return { ok: false, error: "invalid" };
  if (!(await viewerActive(viewerId, db))) return { ok: false, error: "unavailable" };
  const after = at ? sql`and (p.created_at, p.id) < (${at.at}::timestamptz, ${at.id}::uuid)` : sql``;
  const rows = await db.execute<{ id: string; at: string }>(sql`
    select p.id, ${isoUs(sql`p.created_at`)} as at from junction_posts p
    where p.author_id = ${viewerId} and p.deleted_at is null ${after}
    order by p.created_at desc, p.id desc
    limit ${JUNCTION_PAGE_SIZE + 1}`);
  return { ok: true, page: await pageOf(viewerId, Array.from(rows as unknown as { id: string; at: string }[]), db) };
}

/** Saved on /junction/mine: the posts you saved that you may still see, newest save first, 20 a page. Private. */
export async function savedPostsPage(viewerId: string, cursor: string | undefined, deps: Deps = {}): Promise<ListResult> {
  const db = deps.db ?? getDb();
  const at = decodeCursor(cursor, false);
  if (cursor && !at) return { ok: false, error: "invalid" };
  if (!(await viewerActive(viewerId, db))) return { ok: false, error: "unavailable" };
  const after = at ? sql`and (s.created_at, p.id) < (${at.at}::timestamptz, ${at.id}::uuid)` : sql``;
  const rows = await db.execute<{ id: string; at: string }>(sql`
    select p.id, ${isoUs(sql`s.created_at`)} as at from junction_saves s
      join junction_posts p on p.id = s.post_id
      join users u on u.id = p.author_id
    where s.user_id = ${viewerId} and ${feedVisible(viewerId)} ${after}
    order by s.created_at desc, p.id desc
    limit ${JUNCTION_PAGE_SIZE + 1}`);
  return { ok: true, page: await pageOf(viewerId, Array.from(rows as unknown as { id: string; at: string }[]), db) };
}

/** Where each of the person's pinned posts sits (1 to 3), by post id. */
export async function pinsOf(userId: string, db: Db = getDb()): Promise<Record<string, number>> {
  const rows = await db.select({ postId: junctionPins.postId, position: junctionPins.position }).from(junctionPins).where(eq(junctionPins.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.postId, r.position]));
}

/** The "Junction posts" profile switch (user_settings.show_junction_posts); on unless the person turned it off. */
export async function junctionPostsShownFor(userId: string, db: Pick<Db, "select"> = getDb()): Promise<boolean> {
  const [row] = await db.select({ on: userSettings.showJunctionPosts }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row?.on ?? true;
}

export type PinnedPosts = { posts: PostCardView[]; total: number };

/**
 * "On Junction" on a profile (plan section 4, Privacy): the owner's pinned posts (up to 3, in pin order) the viewer may
 * see, and how many of the owner's posts the viewer may see in all. Null when the owner turned "Junction posts" off;
 * the owner's own Me passes `own` and always sees theirs. The caller has already decided the viewer may open the profile.
 */
export async function pinnedForProfile(viewerId: string, ownerId: string, { own = false, ...deps }: Deps & { own?: boolean } = {}): Promise<PinnedPosts | null> {
  const db = deps.db ?? getDb();
  if (!own && !(await junctionPostsShownFor(ownerId, db))) return null;
  if (!(await viewerActive(viewerId, db))) return null;
  const visible = own ? sql`p.deleted_at is null and p.status <> 'hidden'` : feedVisible(viewerId);
  const [pinned, total] = await Promise.all([
    db.execute<{ id: string }>(sql`
      select p.id from junction_pins pin
        join junction_posts p on p.id = pin.post_id
        join users u on u.id = p.author_id
      where pin.user_id = ${ownerId} and p.author_id = ${ownerId} and ${visible}
      order by pin.position asc
      limit ${JUNCTION_PINS_MAX}`),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from junction_posts p join users u on u.id = p.author_id
      where p.author_id = ${ownerId} and ${visible}`),
  ]);
  const ids = Array.from(pinned as unknown as { id: string }[]);
  const n = Number(Array.from(total as unknown as { n: number }[])[0]?.n ?? 0);
  return {
    posts: await cardsFor(
      viewerId,
      ids.map((r) => ({ id: r.id, by: null })),
      db,
    ),
    total: n,
  };
}

/* The rail and the composer ----------------------------------------------------------------------------------------- */

export type JunctionRailData = {
  /** Your posts: how many, and the upvotes and reshares on them. */
  yours: { posts: number; upvotes: number; reshares: number };
  /** Your interests, the same rows as Me's (oldest first, as Me lists them). */
  interests: string[];
  /** On your route this week: the most used interest tags on route posts from the last 7 days, with counts. */
  routeTags: { id: string; name: string; count: number }[];
  routeLabel: string | null;
};

const ROUTE_TAGS_SHOWN = 5;

/** The rail beside the feed (plan section 4): Your posts, Your interests and On your route this week. */
export async function junctionRail(viewerId: string, deps: Deps = {}): Promise<JunctionRailData> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const slug = await targetRoleSlugOf(viewerId, db);
  const [stats, mine, tags] = await Promise.all([
    db.execute<{ posts: number; upvotes: number; reshares: number }>(sql`
      select count(*)::int as posts, coalesce(sum(upvote_count), 0)::int as upvotes, coalesce(sum(reshare_count), 0)::int as reshares
      from junction_posts where author_id = ${viewerId} and deleted_at is null`),
    db.select({ name: userInterests.name }).from(userInterests).where(eq(userInterests.userId, viewerId)).orderBy(asc(userInterests.createdAt), asc(userInterests.nameKey)),
    slug
      ? db.execute<{ id: string; name: string; n: number }>(sql`
          select i.id, i.name, count(*)::int as n
          from junction_posts p
            join users u on u.id = p.author_id
            join junction_post_interests pi on pi.post_id = p.id
            join interests i on i.id = pi.interest_id
          where p.route_slug = ${slug} and p.created_at >= ${new Date(now.getTime() - TOP_WINDOW_DAYS * DAY_MS).toISOString()}::timestamptz
            and i.hidden_at is null and p.status = 'visible' and ${feedVisible(viewerId)}
          group by i.id, i.name
          order by n desc, i.name asc
          limit ${ROUTE_TAGS_SHOWN}`)
      : Promise.resolve([]),
  ]);
  const s = Array.from(stats as unknown as { posts: number; upvotes: number; reshares: number }[])[0];
  return {
    yours: { posts: Number(s?.posts ?? 0), upvotes: Number(s?.upvotes ?? 0), reshares: Number(s?.reshares ?? 0) },
    interests: mine.map((m) => m.name),
    routeTags: Array.from(tags as unknown as { id: string; name: string; n: number }[]).map((t) => ({ id: t.id, name: t.name, count: Number(t.n) })),
    routeLabel: roleTitleOf(slug),
  };
}

export type ComposerData = {
  /** The person's target role, for "My route"; null without one (a sample resume aims at nothing). */
  routeLabel: string | null;
  /** The person's interests that are listed, to tag a post with. */
  interests: { id: string; name: string }[];
  /** What "Show where I am on my line" would attach now, drawn live; null with no active goal. */
  goal: GoalLineView | null;
};

/** What the composer offers this person: My route, their interests and the goal line it would show. */
export async function composerFor(viewerId: string, deps: Deps = {}): Promise<ComposerData> {
  const db = deps.db ?? getDb();
  const [slug, tags, current] = await Promise.all([
    targetRoleSlugOf(viewerId, db),
    db
      .select({ id: interests.id, name: interests.name })
      .from(userInterests)
      .innerJoin(interests, eq(interests.id, userInterests.interestId))
      .where(and(eq(userInterests.userId, viewerId), isNull(interests.hiddenAt)))
      .orderBy(asc(userInterests.createdAt), asc(interests.nameKey)),
    // The same goal createPost attaches: the person's first active goal.
    db.select({ id: userGoals.id }).from(userGoals).where(and(eq(userGoals.userId, viewerId), eq(userGoals.status, "active"))).orderBy(asc(userGoals.position)).limit(1),
  ]);
  const goalId = current[0]?.id;
  const goal = goalId ? ((await goalLines([{ userId: viewerId, goalId }], db)).get(goalId) ?? null) : null;
  return { routeLabel: roleTitleOf(slug), interests: tags, goal };
}

/* Today's tip ------------------------------------------------------------------------------------------------------- */

export type LineTip = { initials: string; quote: string; who: string };

/** How far back Today looks for a tip on the viewer's goal. */
const TIP_WINDOW_DAYS = 30;

/**
 * The tip on Today's "On your line right now" (handoff section 5): the best visible Junction post from the last 30 days
 * whose author showed "where I am on my line" on a goal with the same skill as the viewer's current goal. Its title is
 * the quote, never its body. Not the viewer's own, nobody blocked either way, no suspended or deleting author. Null
 * when there is none.
 */
export async function lineTipFor(viewerId: string, skillId: string, deps: Deps = {}): Promise<LineTip | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const rows = await db.execute<{ title: string; name: string | null; skill: string; status: string }>(sql`
    select p.title, u.name, s.name as skill, g.status::text as status
    from junction_posts p
      join users u on u.id = p.author_id
      join user_goals g on g.id = p.goal_id and g.user_id = p.author_id
      join skills s on s.id = g.skill_id
    where g.skill_id = ${skillId} and p.author_id <> ${viewerId} and p.status = 'visible'
      and p.created_at >= ${new Date(now.getTime() - TIP_WINDOW_DAYS * DAY_MS).toISOString()}::timestamptz
      and ${feedVisible(viewerId)}
    order by p.top_points desc, p.created_at desc, p.id desc
    limit 1`);
  const hit = Array.from(rows as unknown as { title: string; name: string | null; skill: string; status: string }[])[0];
  if (!hit) return null;
  const name = displayName(hit.name);
  const who = hit.status === "met" ? `${name} met the ${hit.skill} goal · on Junction` : `${name}, on the ${hit.skill} goal · on Junction`;
  return { initials: (initialsOf(name) || "?").slice(0, 3), quote: hit.title.slice(0, 200), who: who.slice(0, 120) };
}
