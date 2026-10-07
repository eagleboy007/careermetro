import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Evals call the real Claude API and cost money, so they run only through `npm run eval:parse`, never with `npm test`.
export default defineConfig({
  resolve: base.resolve,
  test: { include: ["src/evals/**/*.eval.ts"], testTimeout: 15 * 60_000 },
});
