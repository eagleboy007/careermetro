import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { freeAnswers } from "@/lib/builder/profile";
import { lineSupported } from "@/lib/builder/verify-lines";
import { builderAnswers, type BuilderAnswers, type BuilderReword } from "@/lib/schemas";

/* The build-resume eval (FR-36): synthetic answers in fixtures/evals/builder, scored without the API. */

export type BuildCase = { id: string; answers: BuilderAnswers };

export function loadBuildCases(dir = path.join(process.cwd(), "fixtures/evals/builder")): BuildCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { id: string; answers: unknown };
      return { id: raw.id, answers: builderAnswers.parse(raw.answers) };
    });
}

export type BuildCaseScore = {
  id: string;
  /** The model answered with output that passed the schema. */
  answered: boolean;
  lines: number;
  /** Lines the app would drop: a number or tool the answer doesn't have (made up). */
  unsupported: string[];
  /** Answer ids the model skipped or invented. */
  missingIds: string[];
  extraIds: string[];
  exclamations: number;
};

export function scoreBuild(c: BuildCase, reply: BuilderReword | null): BuildCaseScore {
  const answers = freeAnswers(c.answers);
  const ids = Object.keys(answers);
  const got = reply?.answers ?? [];
  const unsupported = got.flatMap((g) => (answers[g.answerId] ? g.lines.filter((l) => !lineSupported(l, answers[g.answerId], c.answers.tools)) : []));
  const all = got.flatMap((g) => g.lines);
  return {
    id: c.id,
    answered: reply !== null,
    lines: all.length,
    unsupported,
    missingIds: reply ? ids.filter((id) => !got.some((g) => g.answerId === id)) : [],
    extraIds: got.map((g) => g.answerId).filter((id) => !ids.includes(id)),
    exclamations: [...all, ...(reply?.suggestions ?? []).map((s) => s.text)].filter((t) => t.includes("!")).length,
  };
}

export type BuildReport = { promptVersion: string; model: string; cases: BuildCaseScore[]; answeredRate: number; unsupportedLines: number; totalLines: number };

export async function runBuildEval(cases: BuildCase[], reword: (a: BuilderAnswers) => Promise<BuilderReword | null>, meta: { promptVersion: string; model: string }): Promise<BuildReport> {
  const scores: BuildCaseScore[] = [];
  for (const c of cases) scores.push(scoreBuild(c, await reword(c.answers)));
  return {
    ...meta,
    cases: scores,
    answeredRate: scores.length ? scores.filter((s) => s.answered).length / scores.length : 0,
    unsupportedLines: scores.reduce((n, s) => n + s.unsupported.length, 0),
    totalLines: scores.reduce((n, s) => n + s.lines, 0),
  };
}

export function formatBuildEval(r: BuildReport): string {
  const rows = r.cases.map((c) => `| ${c.id} | ${c.answered ? "yes" : "no"} | ${c.lines} | ${c.unsupported.length} | ${[...c.missingIds, ...c.extraIds].join(", ") || "none"} |`);
  return [
    `## build-resume eval (${r.promptVersion}, ${r.model})`,
    "",
    `Answered ${Math.round(r.answeredRate * 100)}% of cases; ${r.unsupportedLines} of ${r.totalLines} lines would be dropped as unsupported.`,
    "",
    "| Case | Answered | Lines | Dropped | Ids wrong |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
