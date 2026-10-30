/*
 * The max-data seed (T150): one synthetic member, "Max Data", with every growable list full and every text at its cap,
 * for the oversize check (e2e/oversize.mjs). Run by the CI e2e job against its own local Postgres, after the content seed:
 *
 *   MAX_DATA_ACTION=seed  npx vitest run --config vitest.max-data.config.ts   (removes any earlier copy, then writes)
 *   MAX_DATA_ACTION=clean npx vitest run --config vitest.max-data.config.ts   (removes the member and the peers)
 *
 * It runs under Vitest only so it can use the app's own stores and schema (as the store tests do): the resume's gaps,
 * path and goals are made by getGapsForOwner, getPathForOwner and syncCurrentGoals with the model calls off, and the rest
 * is written straight to the tables. Local databases only (assertLocalDatabase). Synthetic text only, never logged:
 * the log says counts. The member's resume id and username go to e2e/results/max-data.json for the browser check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { mockQuestions, practiceQuestions, roleProfiles, skills as contentSkills } from "@/content";
import { ACCOUNT_POLICY_VERSION } from "@/lib/account/store";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { syncCurrentGoals } from "@/lib/goals/store";
import { interestKey } from "@/lib/me/text";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { builderAnswers } from "@/lib/schemas/builder";
import { profile as profileSchema } from "@/lib/schemas/profile";
import { assertLocalDatabase, cleanMaxData, MAX_DATA_EMAIL, peerEmail } from "./clean.mjs";
import {
  MAX_DATA_NAME,
  MAX_DATA_USERNAME,
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
  v,
} from "./data";

const action = process.env.MAX_DATA_ACTION;
const url = process.env.DATABASE_URL;
const OUT = process.env.MAX_DATA_OUT ?? "e2e/results/max-data.json";

const sqlClient = postgres(url ?? "postgres://unset", { max: 4, onnotice: () => {} });
const db = drizzle(sqlClient, { schema });

const MIN = 60_000;
const DAY = 86_400_000;

/** Inserts in slices, so no statement nears Postgres's 65,535 parameters. */
async function insertAll<T>(rows: T[], write: (slice: T[]) => Promise<unknown>, size = 200) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/** The role with the most skills, so the member has as many gap goals as a role can give (MAX_GAPS). */
function targetRole() {
  return [...roleProfiles].sort((a, b) => b.skills.length - a.skills.length || a.slug.localeCompare(b.slug))[0];
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
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  GAP_LIMITS.explainedPerOwnerPerDay = 0;
  PATH_LIMITS.wordedPerOwnerPerDay = 0;
  try {
    const gaps = await getGapsForOwner(resume.id, owner, role, { db });
    if (!gaps.ok) throw new Error(`gaps: ${gaps.reason}`);
    const path = await getPathForOwner(resume.id, owner, role, 5, { db });
    if (!path.ok) throw new Error(`path: ${path.reason}`);
  } finally {
    GAP_LIMITS.explainedPerOwnerPerDay = limits.explain;
    PATH_LIMITS.wordedPerOwnerPerDay = limits.word;
  }
  await syncCurrentGoals(userId, db);

  // "Your choice" goals up to MAX_CHOICE_GOALS, skills with Practice questions first, so Practice lists the member's.
  const goals = await db.select({ skillId: schema.userGoals.skillId, position: schema.userGoals.position }).from(schema.userGoals).where(eq(schema.userGoals.userId, userId));
  const taken = new Set(goals.map((g) => g.skillId));
  const withQuestions = [...new Set(practiceQuestions.map((q) => q.skillId))];
  const choice = [...withQuestions, ...contentSkills.map((s) => s.id)].filter((id, i, all) => skillName.has(id) && !taken.has(id) && all.indexOf(id) === i).slice(0, SIZES.choiceGoals);
  const last = Math.max(0, ...goals.map((g) => g.position));
  await db.insert(schema.userGoals).values(choice.map((skillId, i) => ({ userId, skillId, source: "user" as const, status: "active" as const, position: last + 1 + i })));
  const practiceSkill = [...goals.map((g) => g.skillId), ...choice].find((id) => withQuestions.includes(id)) ?? null;

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

  // ---- Builder draft at its caps --------------------------------------------------------------------------------
  await db.insert(schema.resumeDrafts).values({ userId, answers: builderAnswers.parse(maxBuilderAnswers(role.slug)) });

  const counts = {
    role: role.slug,
    goals: goals.length + choice.length,
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
    } catch (error) {
      // Leave nothing half-written behind.
      await cleanMaxData(sqlClient);
      throw error;
    }
  });
});
