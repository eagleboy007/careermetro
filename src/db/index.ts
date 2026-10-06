import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Created on first use, so builds and pages that never touch the database don't need DATABASE_URL. */
export function getDb() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    // prepare: false is required by Supabase's transaction pooler, which serverless functions use.
    instance = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  }
  return instance;
}
