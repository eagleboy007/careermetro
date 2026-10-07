import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evalCase, type EvalCase } from "@/lib/schemas";

const casesDir = join(process.cwd(), "fixtures/evals");

/** Loads and validates every eval case in fixtures/evals. */
export function loadEvalCases(dir = casesDir): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => evalCase.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}
