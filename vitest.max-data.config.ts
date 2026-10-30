import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// The max-data seed for the oversize check (T150, e2e/max-data/seed.run.ts). It writes to DATABASE_URL, so it runs only
// in the CI e2e job (MAX_DATA_ACTION=seed or clean), never with `npm test`.
export default defineConfig({
  resolve: base.resolve,
  test: { include: ["e2e/max-data/**/*.run.ts"], testTimeout: 5 * 60_000, hookTimeout: 60_000 },
});
