import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Instance = ReturnType<typeof drizzle<typeof schema>>;
// Kept on globalThis, not in a module variable: Next bundles route handlers and pages separately, and each bundle's
// copy of this module would open its own pool. The upload load test saw 6 connections in one server that way.
const shared = globalThis as typeof globalThis & { careermetroDb?: Instance };

/** Created on first use, so builds and pages that never touch the database don't need DATABASE_URL. */
export function getDb() {
  if (!shared.careermetroDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    // prepare: false is required by Supabase's transaction pooler, which serverless functions use. One pool of 5 per
    // server process (e2e/load-upload.mjs checks it).
    shared.careermetroDb = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  }
  return shared.careermetroDb;
}
