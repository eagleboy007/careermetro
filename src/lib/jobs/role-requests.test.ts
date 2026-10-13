import { eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { LIMITS } from "@/lib/shared-limit";
import { countRoleRequest } from "./role-requests";

vi.mock("server-only", () => ({}));

// role_requests against a real Postgres with migrations applied. Titles carry a random word per run, so parallel runs
// and other test files never share a row.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const word = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const run = word();

describe.skipIf(!db)("role requests (database)", () => {
  afterAll(async () => {
    await db!.delete(schema.roleRequests).where(like(schema.roleRequests.title, `%${run}%`));
    await db!.delete(schema.rateLimits).where(sql`${schema.rateLimits.bucket} in (${LIMITS.roleRequestsPerOwner.bucket}, ${LIMITS.roleRequestTitlePerOwner.bucket})`);
    await sqlClient!.end();
  });

  const rowOf = async (title: string) => (await db!.select().from(schema.roleRequests).where(eq(schema.roleRequests.title, title)))[0];

  it("counts a typed title, normalised, once per person a day, and anyone else again", async () => {
    const title = `Blockchain  Developer ${run}`;
    const stored = `blockchain developer ${run}`;
    expect(await countRoleRequest(title, { sessionId: `${run}-a` }, { db: db! })).toBe("counted");
    const first = await rowOf(stored);
    expect(first).toMatchObject({ title: stored, count: 1 });

    // The same person again, in any spelling, doesn't add to it.
    expect(await countRoleRequest(` BLOCKCHAIN developer ${run} `, { sessionId: `${run}-a` }, { db: db! })).toBe("repeat");
    expect((await rowOf(stored)).count).toBe(1);

    expect(await countRoleRequest(title, { userId: "00000000-0000-4000-8000-000000000001" }, { db: db! })).toBe("counted");
    const second = await rowOf(stored);
    expect(second.count).toBe(2);
    expect(second.firstSeen).toEqual(first.firstSeen);
    expect(second.lastSeen.getTime()).toBeGreaterThanOrEqual(first.lastSeen.getTime());
  });

  it("stops one person from counting more than the daily number of titles", async () => {
    const owner = { sessionId: `${run}-many` };
    const outcomes = [];
    for (let i = 0; i <= LIMITS.roleRequestsPerOwner.max; i++) outcomes.push(await countRoleRequest(`role ${word()} ${run}`, owner, { db: db! }));
    expect(outcomes.filter((o) => o === "counted")).toHaveLength(LIMITS.roleRequestsPerOwner.max);
    expect(outcomes.at(-1)).toBe("limit");
  });

  it("skips titles we can't keep and roles we already have, without counting them against the person", async () => {
    const owner = { sessionId: `${run}-skip` };
    expect(await countRoleRequest("priya@example.com", owner, { db: db! })).toBe("skipped");
    expect(await countRoleRequest("98765 43210", owner, { db: db! })).toBe("skipped");
    expect(await countRoleRequest("Data Analyst", owner, { db: db! })).toBe("known");
    expect(await countRoleRequest("  data   analyst ", owner, { db: db! })).toBe("known");
    expect(await rowOf("data analyst")).toBeUndefined();
  });

  it("keeps nothing about the person: only the title, the count and when", async () => {
    const columns = await db!.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'role_requests' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["title", "count", "first_seen", "last_seen"]);
    await countRoleRequest(`Quantum Engineer ${run}`, { sessionId: `${run}-private-session` }, { db: db! });
    const row = await rowOf(`quantum engineer ${run}`);
    expect(JSON.stringify(row)).not.toContain("private-session");
  });

  it("never throws: a database error is logged by name and the title is not", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const broken = {
      insert: () => {
        throw Object.assign(new Error(`Failed query params: secret title ${run}`), { code: "57P01" });
      },
    } as never;
    expect(await countRoleRequest(`secret title ${run}`, { sessionId: `${run}-broken` }, { db: broken })).toBe("failed");
    expect(lines.join(" ")).toContain("role_request_failed");
    expect(lines.join(" ")).not.toContain("secret title");
    spy.mockRestore();
  });
});
