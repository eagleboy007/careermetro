import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { reserveCall, settleCall, usedToday } from "./reserve";

// Runs against a real Postgres with migrations applied. Each test uses its own purpose, so other tests' calls today
// don't change the numbers.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const purposes: string[] = [];
const purpose = () => {
  const p = `test-reserve-${Date.now()}-${purposes.length}`;
  purposes.push(p);
  return p;
};
const record = (p: string, ok: boolean, costUsd: number) => ({
  purpose: p,
  model: "claude-opus-5-5",
  promptVersion: "explain-gaps/v1",
  inputRefs: { profileId: "x" },
  inputTokens: 100,
  outputTokens: 50,
  costUsd,
  latencyMs: 900,
  ok,
});

describe.skipIf(!db)("AI call reservations (database)", () => {
  afterAll(async () => {
    for (const p of purposes) await db!.delete(schema.aiCalls).where(eq(schema.aiCalls.purpose, p));
    await sqlClient!.end();
  });

  it("counts a running reservation at its estimate, stops after 10 minutes, and keeps counting it per owner", async () => {
    const p = purpose();
    const mine = sql`${schema.aiCalls.inputRefs}->>'profileId' = 'mine'`;
    await db!.transaction(async (tx) => {
      await reserveCall(tx, { purpose: p, model: "m", promptVersion: "v", inputRefs: { profileId: "mine" } });
      const [old] = await tx.insert(schema.aiCalls).values({ purpose: p, model: "m", promptVersion: "v", inputRefs: { profileId: "mine" }, inputTokens: 0, outputTokens: 0, costUsd: "0", latencyMs: 0, ok: false, status: "reserved" }).returning();
      await tx.update(schema.aiCalls).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.aiCalls.id, old.id));
      await tx.insert(schema.aiCalls).values({ ...record(p, true, 0.25), costUsd: "0.25" });
      expect(await usedToday(tx, p, 0.1, mine)).toEqual({ usd: 0.35, mine: 2 });
    });
  });

  it("settles the answering attempt into the reservation and logs earlier attempts as their own rows", async () => {
    const p = purpose();
    const id = await db!.transaction((tx) => reserveCall(tx, { purpose: p, model: "m", promptVersion: "v", inputRefs: { profileId: "x" } }));
    expect(await settleCall(db!, id, [record(p, false, 0), record(p, true, 0.03)])).toBe(id);
    const rows = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.purpose, p));
    expect(rows.map((r) => [r.id === id, r.status, r.ok, Number(r.costUsd)]).sort()).toEqual([
      [false, null, false, 0],
      [true, "done", true, 0.03],
    ]);
  });

  it("closes a reservation no attempt answered, and never throws", async () => {
    const p = purpose();
    const id = await db!.transaction((tx) => reserveCall(tx, { purpose: p, model: "m", promptVersion: "v", inputRefs: {} }));
    expect(await settleCall(db!, id, [])).toBeNull();
    const [row] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, id));
    expect(row).toMatchObject({ status: "done", ok: false });
    expect(await settleCall(db!, "not-a-uuid", [record(p, true, 0.01)])).toBe("not-a-uuid");
  });
});
