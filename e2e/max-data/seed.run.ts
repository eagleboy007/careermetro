/*
 * The max-data seed (T150): one synthetic member, "Max Data", with every growable list full and every text at its cap,
 * for the oversize check (e2e/oversize.mjs). Run by the CI e2e job against its own local Postgres, after the content seed:
 *
 *   MAX_DATA_ACTION=seed  npx vitest run --config vitest.max-data.config.ts   (removes any earlier copy, then writes)
 *   MAX_DATA_ACTION=clean npx vitest run --config vitest.max-data.config.ts   (removes the member and the peers)
 *
 * It runs under Vitest only so it can use the app's own stores and schema (as the store tests do): the resume's gaps,
 * path and goals are made by getGapsForOwner, getPathForOwner and syncCurrentGoals with the model calls off, and the rest
 * is written straight to the tables. Two destinations (T176): an earlier role first, then the target role chosen with
 * makeDestination, so the Map has an earlier line with MAX_GAPS waiting goals; and opted-in members (riders) on the
 * line's pitstops, some of them connections, for the On your line panel. Local databases only (assertLocalDatabase).
 * Synthetic text only, never logged: the log says counts. The member's resume id and username go to e2e/results/max-data.json for the browser check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { mockQuestions, practiceQuestions, roleProfiles, skills as contentSkills } from "@/content";
import { ACCOUNT_POLICY_VERSION, NAME_PART_MAX } from "@/lib/account/store";
import { makeDestination } from "@/lib/gaps/choose";
import { currentAnalysis } from "@/lib/gaps/current";
import { gapSkillsOf, leftOnEarlierLine } from "@/lib/gaps/destination";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { goalsOf, syncCurrentGoals } from "@/lib/goals/store";
import { pitstopRidersFor } from "@/lib/map/riders";
import { mapLineFor } from "@/lib/map/store";
import { interestKey } from "@/lib/me/text";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { addOwnPitstop, learningSkill, pitstopOptionsFor } from "@/lib/pitstops/store";
import { builderAnswers } from "@/lib/schemas/builder";
import { EVENT_RSVP_STATES, EVENT_TOPICS_MAX, OWN_PITSTOPS_MAX, OWN_PITSTOPS_PER_GOAL, PITSTOP_NAMES_SHOWN } from "@/lib/schemas/constants";
import { gapAnalysis, MAX_GAPS, type Gap, type RoleProfile } from "@/lib/schemas";
import { profile as profileSchema } from "@/lib/schemas/profile";
import { assertLocalDatabase, cleanMaxData, MAX_DATA_EMAIL, peerEmail, riderEmail } from "./clean.mjs";
import {
  EARLIER_OWN_PITSTOP_GOALS,
  earlierGapName,
  LONE_PITSTOPS,
  MAX_DATA_NAME,
  MAX_DATA_USERNAME,
  maxBuilderAnswers,
  maxEvent,
  maxHeadline,
  maxInterests,
  maxJob,
  maxMeEducation,
  maxMeRoles,
  maxMessage,
  maxOwnPitstops,
  maxProfile,
  maxStories,
  OWN_PITSTOP_GOALS,
  peerName,
  RIDER_NAME_PART,
  riderName,
  RIDERS,
  riderUsername,
  SIZES,
  v,
} from "./data";

const action = process.env.MAX_DATA_ACTION;
const url = process.env.DATABASE_URL;
const OUT = process.env.MAX_DATA_OUT ?? "e2e/results/max-data.json";

const sqlClient = postgres(url ?? "postgres://unset", { max: 4, onnotice: () => {} });
const db = drizzle(sqlClient, { schema });

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Inserts in slices, so no statement nears Postgres's 65,535 parameters. */
async function insertAll<T>(rows: T[], write: (slice: T[]) => Promise<unknown>, size = 200) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/** The role with the most skills, so the member has as many gap goals as a role can give (MAX_GAPS). */
function targetRole() {
  return [...roleProfiles].sort((a, b) => b.skills.length - a.skills.length || a.slug.localeCompare(b.slug))[0];
}

/**
 * The earlier destination (C25, T176): the role sharing the fewest skills with the target, so its own gaps wait on the
 * earlier line. Most required skills the target doesn't list, then most required skills, then by slug.
 */
function earlierRole(target: RoleProfile) {
  const theirs = new Set(target.skills.map((s) => s.skillId));
  const required = (r: RoleProfile) => r.skills.filter((s) => s.importance === "required");
  const apart = (r: RoleProfile) => required(r).filter((s) => !theirs.has(s.skillId)).length;
  return roleProfiles
    .filter((r) => r.slug !== target.slug)
    .sort((a, b) => apart(b) - apart(a) || required(b).length - required(a).length || a.slug.localeCompare(b.slug))[0];
}

/**
 * The earlier role's gaps at MAX_GAPS, none of them a skill of the target role (T176): its own gaps the target doesn't
 * list first, then other taxonomy skills, never one Practice has questions for (so the "Your choice" goals still get
 * those). Real skill ids, so the goals are real; every name at the Map's 80 characters. No role lists MAX_GAPS required
 * skills today, so the list is padded to reach the cap the code allows.
 */
function earlierGaps(own: Gap[], target: RoleProfile, avoid: ReadonlySet<string>): Gap[] {
  const theirs = new Set(target.skills.map((s) => s.skillId));
  const kept = own.filter((g) => !theirs.has(g.skillId));
  const used = new Set([...kept.map((g) => g.skillId), ...avoid, ...theirs]);
  const extra = contentSkills
    .map((s) => s.id)
    .filter((id) => !used.has(id))
    .sort()
    .slice(0, Math.max(0, MAX_GAPS - kept.length))
    .map((skillId): Gap => ({
      skillId,
      skillName: skillId,
      status: "missing",
      resumeQuote: null,
      requirement: "Asked for by this role.",
      explanation: "Nothing in your resume covers this skill yet.",
    }));
  return [...kept, ...extra].slice(0, MAX_GAPS).map((g, i) => ({ ...g, skillName: earlierGapName(i) }));
}

async function seed() {
  const now = new Date();
  const role = targetRole();
  const skillName = new Map(contentSkills.map((s) => [s.id, s.name]));
  const roleSkillNames = role.skills.map((s) => skillName.get(s.skillId)).filter((n): n is string => !!n);
  const profile = profileSchema.parse(maxProfile(roleSkillNames));

  // ---- The member and the peers ----------------------------------------------------------------------------------
  const [member] = await db
    .insert(schema.users)
    .values({
      email: MAX_DATA_EMAIL,
      // The test sign-in's subject for this address (src/lib/auth/test-user.ts), so "Continue as test user" finds the account.
      authSubject: `test:${MAX_DATA_EMAIL}`,
      name: MAX_DATA_NAME,
      firstName: "Max",
      lastName: "Data",
      ageConfirmedAt: now,
      lastSeenAt: now,
      username: MAX_DATA_USERNAME,
      usernameChangedAt: now,
      headline: maxHeadline(),
      // The Timetable's in-person events are in Pune.
      city: "Pune",
    })
    .returning({ id: schema.users.id });
  const userId = member.id;
  await db.insert(schema.consents).values({ userId, email: MAX_DATA_EMAIL, purpose: "account", policyVersion: ACCOUNT_POLICY_VERSION });
  // Everything on the profile shows, to everyone signed in, so /u/<username> has the most it can hold.
  await db.insert(schema.userSettings).values({
    userId,
    profileVisibility: "signed_in",
    showTargetRole: true,
    showGaps: true,
    gapsVisibleTo: "profile",
  });
  // Elite on (free in the beta): the Library shelf and the mock interview open.
  await db.insert(schema.userPlans).values({ userId, eliteSince: now, badgeShown: true });

  const peerCount = SIZES.connections + SIZES.requestsIn + SIZES.requestsOut;
  const peers = await db
    .insert(schema.users)
    .values(
      Array.from({ length: peerCount }, (_, n) => ({
        email: peerEmail(n),
        name: peerName(n),
        firstName: "Peer",
        ageConfirmedAt: now,
        headline: v(n + 1, 80),
      })),
    )
    .returning({ id: schema.users.id, email: schema.users.email });
  const peerIds = peers.sort((a, b) => a.email.localeCompare(b.email)).map((p) => p.id);
  const connected = peerIds.slice(0, SIZES.connections);
  const asking = peerIds.slice(SIZES.connections, SIZES.connections + SIZES.requestsIn);
  const asked = peerIds.slice(SIZES.connections + SIZES.requestsIn);

  // ---- Resume, gaps, path and goals (the app's own stores, model calls off) --------------------------------------
  const [resume] = await db
    .insert(schema.resumes)
    .values({ userId, mimeType: "text/plain", sizeBytes: 20_000, status: "parsed" })
    .returning({ id: schema.resumes.id });
  await db.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true });
  // A second, Latin-only resume at the same caps, only for timing the PDF: the export refuses the first one's Hindi and
  // emoji by design (422). A day older, so the first stays the current resume everywhere else.
  const [pdfResume] = await db
    .insert(schema.resumes)
    .values({ userId, mimeType: "text/plain", sizeBytes: 20_000, status: "parsed", createdAt: new Date(now.getTime() - DAY) })
    .returning({ id: schema.resumes.id });
  await db.insert(schema.profiles).values({ resumeId: pdfResume.id, version: 1, data: profileSchema.parse(maxProfile([], true)), confirmedByUser: true });
  const owner = { userId };
  const withQuestions = [...new Set(practiceQuestions.map((q) => q.skillId))];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  GAP_LIMITS.explainedPerOwnerPerDay = 0;
  PATH_LIMITS.wordedPerOwnerPerDay = 0;

  // ---- Own pitstops on the Map (FR-58, T172), through the app's store so its name check and limits apply ---------
  // OWN_PITSTOPS_MAX in all, across every goal: OWN_PITSTOPS_PER_GOAL on each goal in turn, gap goals first (they are
  // the Map's line and draw spurs), then the lone names one a goal so their spurs show the name. The first of each call
  // has a free course if the catalog offers one for its goal. Called twice: on the earlier role's goals before the
  // change of destination (T176), then on the current line's.
  const names = maxOwnPitstops();
  let ownPitstops = 0;
  let ownCourse = false;
  const addOwn = async (goals: Awaited<ReturnType<typeof goalsOf>>) => {
    const first = ownPitstops;
    for (const goal of goals) {
      const take = ownPitstops < names.length - LONE_PITSTOPS ? OWN_PITSTOPS_PER_GOAL : 1;
      for (const title of names.slice(ownPitstops, ownPitstops + take)) {
        const offered = ownPitstops === first ? (await pitstopOptionsFor([{ goalId: goal.id, skillId: learningSkill(goal)!, used: [] }], db)).get(goal.id) : undefined;
        const resourceId = offered?.[0]?.id ?? null;
        const added = await addOwnPitstop(userId, { goalId: goal.id, title, resourceId }, { db, now });
        if (!added.ok) throw new Error(`own pitstop ${ownPitstops + 1}: ${added.error}`);
        ownCourse ||= Boolean(resourceId);
        ownPitstops++;
      }
    }
  };
  const openGoals = async () =>
    (await goalsOf(userId, db))
      .filter((g) => learningSkill(g))
      .sort((a, b) => Number(a.source !== "gap") - Number(b.source !== "gap") || a.position - b.position);

  // ---- The earlier destination first (change of destination, C25, T176) -----------------------------------------
  // Its analysis is the member's first, so it becomes the destination as a first analysis does; its gaps are then set to
  // MAX_GAPS skills the target role doesn't list, each name at the Map's 80. Its path and goals follow, and its first
  // goals get their own pitstops. Then the target role's analysis waits for "Make this my destination", which the seed
  // presses (makeDestination), so the earlier role becomes the Map's earlier line with every goal waiting there.
  const earlier = earlierRole(role);
  let earlierLeft = 0;
  try {
    const before = await getGapsForOwner(resume.id, owner, earlier, { db });
    if (!before.ok) throw new Error(`earlier gaps: ${before.reason}`);
    const gaps = earlierGaps(before.analysis.gaps, role, new Set([...before.analysis.metSkillIds, ...withQuestions]));
    await db.update(schema.gapAnalyses).set({ result: gapAnalysis.parse({ ...before.analysis, gaps }) }).where(eq(schema.gapAnalyses.id, before.analysisId));
    const beforePath = await getPathForOwner(resume.id, owner, earlier, 5, { db });
    if (!beforePath.ok) throw new Error(`earlier path: ${beforePath.reason}`);
    await syncCurrentGoals(userId, db);
    await addOwn((await openGoals()).filter((g) => g.source === "gap").slice(0, EARLIER_OWN_PITSTOP_GOALS));

    const gaps2 = await getGapsForOwner(resume.id, owner, role, { db });
    if (!gaps2.ok) throw new Error(`gaps: ${gaps2.reason}`);
    const chosen = await makeDestination(userId, { analysisId: gaps2.analysisId }, { db, now });
    if (!chosen.ok || !chosen.changed) throw new Error(`destination: ${chosen.ok ? "unchanged" : chosen.error}`);
    const path = await getPathForOwner(resume.id, owner, role, 5, { db });
    if (!path.ok) throw new Error(`path: ${path.reason}`);
    earlierLeft = gaps.length;
  } finally {
    GAP_LIMITS.explainedPerOwnerPerDay = limits.explain;
    PATH_LIMITS.wordedPerOwnerPerDay = limits.word;
  }
  await syncCurrentGoals(userId, db);
  const current = await currentAnalysis(userId, db);
  if (current?.result.roleSlug !== role.slug) throw new Error("the target role is not the destination");
  const lineGaps = gapSkillsOf(current);

  // "Your choice" goals up to MAX_CHOICE_GOALS, skills with Practice questions first, so Practice lists the member's.
  // Only goals on the current line count from here on: the earlier role's wait on its line (leftOnEarlierLine).
  const allGoals = await db
    .select({ skillId: schema.userGoals.skillId, position: schema.userGoals.position, source: schema.userGoals.source })
    .from(schema.userGoals)
    .where(eq(schema.userGoals.userId, userId));
  const goals = allGoals.filter((g) => !leftOnEarlierLine(g, lineGaps));
  const taken = new Set(allGoals.map((g) => g.skillId));
  const choice = [...withQuestions, ...contentSkills.map((s) => s.id)].filter((id, i, all) => skillName.has(id) && !taken.has(id) && all.indexOf(id) === i).slice(0, SIZES.choiceGoals);
  const last = Math.max(0, ...allGoals.map((g) => g.position));
  await db.insert(schema.userGoals).values(choice.map((skillId, i) => ({ userId, skillId, source: "user" as const, status: "active" as const, position: last + 1 + i })));
  const practiceSkill = [...goals.map((g) => g.skillId), ...choice].find((id) => withQuestions.includes(id)) ?? null;

  // The rest of the own pitstops on the current line's goals (the earlier role's took the first): full goals, then the
  // lone names.
  const open = (await openGoals()).filter((g) => !leftOnEarlierLine(g, lineGaps)).slice(0, OWN_PITSTOP_GOALS - EARLIER_OWN_PITSTOP_GOALS);
  await addOwn(open);

  // ---- On your line (C13, T176): opted-in members on every goal of the current line, some of them connections ------
  // Each with "Show my pitstop on the map" on and a goal of their own choice on each of the line's gap skills (a chosen
  // goal is always on its person's line), so whichever pitstop the Map opens on shows the count and the names.
  const riderSkills = [...(lineGaps ?? [])];
  const riders = await db
    .insert(schema.users)
    .values(
      Array.from({ length: RIDERS.total }, (_, n) => {
        const [firstName, lastName] = riderName(n).split(" ");
        return {
          email: riderEmail(n),
          name: riderName(n),
          firstName,
          lastName,
          ageConfirmedAt: now,
          username: riderUsername(n),
          usernameChangedAt: now,
          headline: v(n + 2, 80),
        };
      }),
    )
    .returning({ id: schema.users.id, email: schema.users.email });
  const riderIds = riders.sort((a, b) => a.email.localeCompare(b.email)).map((r) => r.id);
  await db.insert(schema.userSettings).values(riderIds.map((id) => ({ userId: id, profileVisibility: "signed_in" as const, showOnMap: true })));
  await insertAll(
    riderIds.flatMap((id) => riderSkills.map((skillId, i) => ({ userId: id, skillId, source: "user" as const, status: "active" as const, position: i }))),
    (rows) => db.insert(schema.userGoals).values(rows),
  );
  // The first ones are connections: PITSTOP_NAMES_SHOWN named, the rest "and N more"; the others count but stay unnamed.
  await db
    .insert(schema.connections)
    .values(riderIds.slice(0, RIDERS.connected).map((p) => (userId < p ? { userLow: userId, userHigh: p } : { userLow: p, userHigh: userId })).map((c) => ({ ...c, how: "same_line" as const })));

  // ---- Me: added roles, education, stories, interests --------------------------------------------------------------
  await db.insert(schema.meRoles).values(maxMeRoles().map((r) => ({ userId, ...r })));
  await db.insert(schema.meEducation).values(maxMeEducation().map((e) => ({ userId, ...e })));
  const stories = maxStories();
  const storyAt = (i: number) => new Date(now.getTime() - i * MIN);
  const storyRows = await db
    .insert(schema.stories)
    .values(
      stories.map((s, i) => ({
        userId,
        title: s.title,
        whereText: s.whereText,
        situation: s.situation,
        task: s.task,
        action: s.action,
        result: s.result,
        source: "user",
        createdAt: storyAt(i),
        updatedAt: storyAt(i),
      })),
    )
    .returning({ id: schema.stories.id, updatedAt: schema.stories.updatedAt });
  // Matched back by their times, which differ by a minute each (titles repeat).
  const storyIndex = new Map(stories.map((_, i) => [storyAt(i).getTime(), i]));
  await db.insert(schema.storyBoxes).values(storyRows.flatMap((row) => stories[storyIndex.get(row.updatedAt.getTime())!].boxes.map((box) => ({ storyId: row.id, box }))));
  await db.insert(schema.userInterests).values(maxInterests().map((name) => ({ userId, name, nameKey: interestKey(name) })));

  // ---- My jobs: 300 jobs added from other sites, each with a long note -------------------------------------------
  const requiredIds = role.skills.filter((s) => s.importance === "required").map((s) => s.skillId).slice(0, 6);
  const checks = await db
    .insert(schema.jobChecks)
    .values(
      Array.from({ length: SIZES.myJobs }, (_, i) => {
        const job = maxJob(i);
        return {
          resumeId: resume.id,
          roleSlug: role.slug,
          company: job.company,
          title: job.title,
          requiredSkillIds: requiredIds,
          textHash: `max-data-${i}`,
          url: job.url,
          source: "pasted" as const,
          city: job.city,
          description: i < 5 ? v(i, 20_000) : null,
          createdAt: new Date(now.getTime() - i * MIN),
        };
      }),
    )
    .returning({ id: schema.jobChecks.id, textHash: schema.jobChecks.textHash });
  const checkId = new Map(checks.map((c) => [c.textHash, c.id]));
  await insertAll(
    Array.from({ length: SIZES.myJobs }, (_, i) => {
      // Saved, Applied, Heard back, Interview, Offer, Not this time, Withdrawn in turn.
      const stage = i % 7 === 0 ? null : i % 7;
      const at = new Date(now.getTime() - i * MIN);
      return {
        userId,
        jobCheckId: checkId.get(`max-data-${i}`)!,
        savedAt: at,
        stage,
        appliedAt: stage ? at : null,
        interviewAt: stage === 3 ? new Date(now.getTime() + (i + 1) * DAY) : null,
        closedAt: stage === 5 || stage === 6 ? at : null,
        note: maxJob(i).note,
        statusAt: at,
        updatedAt: at,
      };
    }),
    (rows) => db.insert(schema.jobSaves).values(rows),
  );

  // ---- Network: connections, requests to the member, requests from the member -----------------------------------
  const pair = (a: string, b: string) => (a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a });
  await db.insert(schema.connections).values(connected.map((p, i) => ({ ...pair(userId, p), how: "worked_together" as const, createdAt: new Date(now.getTime() - i * MIN) })));
  await db.insert(schema.connectionRequests).values([
    ...asking.map((p, i) => ({ fromUser: p, toUser: userId, how: "same_line" as const, createdAt: new Date(now.getTime() - i * MIN) })),
    ...asked.map((p, i) => ({ fromUser: userId, toUser: p, how: "studied_together" as const, createdAt: new Date(now.getTime() - i * MIN) })),
  ]);

  // ---- Inbox: 60 chats with connections (one of 200 long messages) and a few message requests --------------------
  const threads = [
    ...connected.slice(0, SIZES.inboxThreads - SIZES.messageRequests).map((p) => ({ peer: p, status: "open" as const })),
    ...asking.slice(0, SIZES.messageRequests).map((p) => ({ peer: p, status: "request" as const })),
  ];
  const convs = await db
    .insert(schema.conversations)
    .values(threads.map((t, i) => ({ kind: "direct" as const, status: t.status, startedBy: t.status === "request" ? t.peer : userId, lastMessageAt: new Date(now.getTime() - i * MIN) })))
    .returning({ id: schema.conversations.id, lastMessageAt: schema.conversations.lastMessageAt });
  convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  await db.insert(schema.conversationMembers).values(
    convs.flatMap((c, i) => [
      // Every other chat unread, so the list shows both.
      { conversationId: c.id, userId, lastReadAt: i % 2 ? c.lastMessageAt : null },
      { conversationId: c.id, userId: threads[i].peer, lastReadAt: c.lastMessageAt },
    ]),
  );
  const messages = convs.flatMap((c, i) => {
    const count = i === 0 ? SIZES.longThreadMessages : SIZES.messagesPerThread;
    return Array.from({ length: count }, (_, k) => ({
      conversationId: c.id,
      // A request holds only the asker's messages; open chats go back and forth.
      senderId: threads[i].status === "request" || k % 2 === 0 ? threads[i].peer : userId,
      body: maxMessage(i === 0 ? k : i + k),
      createdAt: new Date(c.lastMessageAt.getTime() - (count - 1 - k) * 1000),
    }));
  });
  await insertAll(messages, (rows) => db.insert(schema.messages).values(rows));

  // ---- Library: saved and finished ------------------------------------------------------------------------------
  const resources = await db
    .select({ id: schema.resources.id })
    .from(schema.resources)
    .where(and(isNull(schema.resources.hiddenAt), eq(schema.resources.healthy, true)))
    .orderBy(asc(schema.resources.url))
    .limit(SIZES.librarySaved + SIZES.libraryFinished);
  await insertAll(
    resources.map((r, i) => {
      const at = new Date(now.getTime() - i * MIN);
      return i < SIZES.librarySaved ? { userId, resourceId: r.id, savedAt: at, updatedAt: at } : { userId, resourceId: r.id, finishedAt: at, updatedAt: at };
    }),
    (rows) => db.insert(schema.userResources).values(rows),
  );

  // ---- Practice: 620 ratings on one goal's skill, inside the 30 days answers are kept -----------------------------
  let ratings = 0;
  if (practiceSkill) {
    const ids = practiceQuestions.filter((q) => q.skillId === practiceSkill).map((q) => q.id);
    const span = 29 * DAY;
    const rows = Array.from({ length: SIZES.practiceRatings }, (_, i) => ({
      userId,
      skillId: practiceSkill,
      questionId: ids[i % ids.length],
      answer: v(i, 1000),
      confidence: (i % 4) + 1,
      createdAt: new Date(now.getTime() - span + Math.floor((i * span) / SIZES.practiceRatings)),
    }));
    await insertAll(rows, (slice) => db.insert(schema.practiceAnswers).values(slice));
    ratings = rows.length;
  }

  // ---- Mock interviews: 50 ended Quick rounds on earlier days (none running, none counted today) ------------------
  const bank = mockQuestions.filter((q) => q.kind === "open" && q.roleSlugs.includes(role.slug)).map((q) => q.id);
  let sessions = 0;
  if (bank.length) {
    const rows = Array.from({ length: SIZES.mockSessions }, (_, i) => {
      const startedAt = new Date(now.getTime() - (i + 2) * DAY);
      return {
        userId,
        roleSlug: role.slug,
        length: "quick" as const,
        focus: "mix" as const,
        questionIds: Array.from({ length: Math.min(4, bank.length) }, (_, k) => bank[(i + k) % bank.length]),
        startedAt,
        endedAt: new Date(startedAt.getTime() + 10 * MIN),
      };
    });
    await db.insert(schema.mockSessions).values(rows);
    sessions = rows.length;
  }

  // ---- Timetable: events on the member's goals, every text at its cap -----------------------------------------------
  const eventGoals = [...goals.map((g) => g.skillId), ...choice].slice(0, EVENT_TOPICS_MAX);
  const eventRows = await db
    .insert(schema.events)
    .values(
      Array.from({ length: SIZES.events }, (_, i) => {
        const startsAt = new Date(now.getTime() + HOUR + (i % 50) * DAY);
        return { source: "feed" as const, status: "live" as const, ...maxEvent(i), startsAt, endsAt: new Date(startsAt.getTime() + 2 * HOUR) };
      }),
    )
    .returning({ id: schema.events.id });
  await insertAll(
    eventRows.flatMap((e) => eventGoals.map((topic) => ({ eventId: e.id, kind: "skill" as const, topic }))),
    (rows) => db.insert(schema.eventTopics).values(rows),
  );
  // Going rows are prep tasks for the first goal (Timetable PR 3), so Today's ride shows one at its caps on event 50's day.
  const prepGoal = goals[0]?.skillId ?? null;
  const marks: { userId: string; eventId: string; state: (typeof EVENT_RSVP_STATES)[number]; goalSkillId?: string | null }[] = [];
  eventRows.forEach((e, i) => {
    if (i % 4 === 1) marks.push({ userId, eventId: e.id, state: "saved" });
    if (i % 4 === 2) marks.push({ userId, eventId: e.id, state: "going", goalSkillId: prepGoal });
  });
  await db.insert(schema.eventRsvps).values(marks);

  // ---- Builder draft at its caps --------------------------------------------------------------------------------
  await db.insert(schema.resumeDrafts).values({ userId, answers: builderAnswers.parse(maxBuilderAnswers(role.slug)) });

  // ---- What the Map will show (T176): read back through the Map's own readers, so a wrong seed fails here -----------
  const line = await mapLineFor(userId, db, now);
  const people = line ? await pitstopRidersFor(userId, line.goals.map((g) => g.skillId), db) : [];

  const counts = {
    role: role.slug,
    earlierRole: earlier.slug,
    earlierGaps: earlierLeft,
    earlierLeft: line?.previous?.left.length ?? 0,
    earlierCame: line?.previous?.came.length ?? 0,
    earlierOwn: line?.previous?.left.filter((g) => g.ownPitstops === OWN_PITSTOPS_PER_GOAL).length ?? 0,
    riders: riderIds.length,
    riderPitstops: people.length,
    riderCount: people[0]?.count ?? 0,
    riderNames: people[0]?.names.length ?? 0,
    goals: goals.length + choice.length,
    ownPitstops,
    ownPitstopGoals: EARLIER_OWN_PITSTOP_GOALS + open.length,
    ownCourse,
    profileRoles: profile.roles.length,
    meRoles: SIZES.meRoles,
    stories: storyRows.length,
    myJobs: SIZES.myJobs,
    chats: convs.length,
    messages: messages.length,
    connections: connected.length,
    requestsIn: asking.length,
    requestsOut: asked.length,
    library: resources.length,
    practiceRatings: ratings,
    mockSessions: sessions,
    events: eventRows.length,
  };
  // Counts and ids only: no text.
  console.log("max-data seed:", JSON.stringify(counts));
  mkdirSync(OUT.replace(/\/[^/]*$/, ""), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ resumeId: resume.id, pdfResumeId: pdfResume.id, username: MAX_DATA_USERNAME, counts }, null, 2));
  return counts;
}

describe("max-data member", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it(`${action ?? "no MAX_DATA_ACTION"}`, async () => {
    if (action !== "seed" && action !== "clean") throw new Error("set MAX_DATA_ACTION to seed or clean");
    assertLocalDatabase(url);
    const removed = await cleanMaxData(sqlClient);
    console.log(`max-data: removed ${removed} earlier accounts`);
    if (action === "clean") return;
    try {
      const counts = await seed();
      expect(counts.myJobs).toBe(SIZES.myJobs);
      expect(counts.goals).toBeGreaterThan(SIZES.choiceGoals);
      expect(counts.ownPitstops).toBe(OWN_PITSTOPS_MAX);
      // T176: the earlier line holds MAX_GAPS waiting goals, the first with their own pitstops, and the people panel a
      // count and names on the line's pitstops.
      expect(RIDER_NAME_PART).toBe(NAME_PART_MAX);
      expect(counts.earlierGaps).toBe(MAX_GAPS);
      expect(counts.earlierLeft + counts.earlierCame).toBe(MAX_GAPS);
      expect(counts.earlierLeft).toBe(MAX_GAPS);
      expect(counts.earlierOwn).toBe(EARLIER_OWN_PITSTOP_GOALS);
      expect(counts.riderPitstops).toBeGreaterThan(0);
      expect(counts.riderCount).toBe(RIDERS.total);
      expect(counts.riderNames).toBe(Math.min(PITSTOP_NAMES_SHOWN, RIDERS.connected));
    } catch (error) {
      // Leave nothing half-written behind.
      await cleanMaxData(sqlClient);
      throw error;
    }
  });
});
