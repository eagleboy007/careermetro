import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildGapAnalysis, SHOWN_GAPS } from "@/lib/gaps/analysis";
import { explainGaps, type ExplainClient } from "@/lib/gaps/explain";
import type { MatchResult } from "@/lib/gaps/match";
import { loadEvalCases } from "./cases";
import { explainInputs, formatExplainEval, hoursNamed, quotedPhrases, runExplainEval, scoreExplainCase, type ExplainOutcome } from "./explain-eval";

const inputs = explainInputs(loadEvalCases());
const withQuote = inputs.find((i) => i.match.gaps.slice(0, SHOWN_GAPS).some((g) => g.resumeQuote && g.resumeQuote.split(" ").length >= 3))!;

/** The model's words for a case: each gap gets `say(gap)`, the readiness line `readiness`. */
function worded(match: MatchResult, say: (g: MatchResult["gaps"][number]) => string, readiness: string): ExplainOutcome {
  const shown = match.gaps.slice(0, SHOWN_GAPS);
  const bySkill = new Map(shown.map((g) => [g.skillId, say(g)]));
  return { analysis: buildGapAnalysis(match, { readiness, bySkill }), source: "model", calls: [] };
}

describe("explain-gaps eval inputs", () => {
  it("explains the matcher's gaps for the labelled resumes, and has cases with resume quotes to check", () => {
    expect(inputs.length).toBeGreaterThanOrEqual(10);
    expect(inputs.every((i) => i.match.gaps.length > 0 && i.roleTitle)).toBe(true);
    expect(withQuote).toBeDefined();
  });
});

describe("explain-gaps eval scoring", () => {
  it("finds quoted phrases and named hours", () => {
    expect(quotedPhrases(`Your resume says "built a Power BI dashboard" and “Excel pivot tables daily”, but "SQL" alone is short.`)).toEqual([
      "built a Power BI dashboard",
      "Excel pivot tables daily",
    ]);
    expect(hoursNamed("About 40 hours, maybe a 1,200-hour stretch, or 3 hrs a week.")).toEqual([40, 1200, 3]);
    // Both ends of a range, and decimals read whole (T70).
    expect(hoursNamed("Plan on 40-60 hours, 40 to 60 hours or 1.5 hours a day.")).toEqual([40, 60, 40, 60, 1.5]);
  });

  it("counts a quote of the role title or of another gap as given, not invented (T61)", () => {
    const { id, match } = withQuote;
    const other = match.gaps.find((g) => g.requirement.split(/\s+/).length >= 3)!;
    const out = worded(match, () => `The role asks for "${other.requirement}" and the title says "Senior Data Analyst Lead".`, `About ${match.readiness.estimatedHours} hours.`);
    expect(scoreExplainCase(id, match, out, "Senior Data Analyst Lead").inventedQuotes).toEqual([]);
    expect(scoreExplainCase(id, match, out).inventedQuotes).toEqual(Array(Math.min(SHOWN_GAPS, match.gaps.length)).fill("Senior Data Analyst Lead"));
  });

  it("passes words that quote only the resume and keep the matcher's hours", () => {
    const { id, match } = withQuote;
    const hours = match.readiness.estimatedHours;
    const out = worded(match, (g) => (g.resumeQuote ? `Your resume says "${g.resumeQuote}" but shows no project.` : `Your resume shows nothing for ${g.skillName}.`), `About ${hours} hours, as an estimate.`);
    expect(scoreExplainCase(id, match, out)).toMatchObject({ id, model: true, inventedQuotes: [], wrongHours: [], tooLong: 0, exclamations: 0 });
  });

  it("catches an invented quote, changed hours, an exclamation mark and a long explanation", () => {
    const { id, match } = withQuote;
    const hours = match.readiness.estimatedHours;
    const long = Array.from({ length: 50 }, () => "word").join(" ");
    const [first] = match.gaps;
    const out = worded(match, (g) => (g === first ? `You wrote "led a team of forty analysts" here!` : long), `About ${hours + 10} hours.`);
    const r = scoreExplainCase(id, match, out);
    expect(r.inventedQuotes).toEqual(["led a team of forty analysts"]);
    expect(r.wrongHours).toEqual([hours + 10]);
    expect(r.exclamations).toBe(1);
    expect(r.tooLong).toBe(Math.min(SHOWN_GAPS, match.gaps.length) - 1);
  });

  it("counts the template fallback as no model words", () => {
    const { id, match } = inputs[0]!;
    expect(scoreExplainCase(id, match, { analysis: buildGapAnalysis(match, null), source: "template", calls: [] }).model).toBe(false);
  });
});

describe("explain-gaps eval run", () => {
  it("runs explainGaps over every case with a stand-in client, so the real run only swaps the client", async () => {
    const create = vi.fn(async (body: { messages: { content: string }[] }) => {
      const data = JSON.parse(body.messages[0]!.content.replace(/^<analysis>\n|\n<\/analysis>$/g, "")) as { estimatedHours: number; gaps: { skillId: string; skill: string }[] };
      const text = JSON.stringify({
        readiness: `About ${data.estimatedHours} hours of work, as an estimate.`,
        gaps: data.gaps.map((g) => ({ skillId: g.skillId, explanation: `Your resume shows little for ${g.skill}.` })),
      });
      return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 300 } as Anthropic.Beta.BetaUsage, content: [{ type: "text", text }] };
    });
    const client = { beta: { messages: { create } } } as unknown as ExplainClient;
    const report = await runExplainEval(inputs, (match, roleTitle) => explainGaps(match, roleTitle, { eval: "explain" }, client), { promptVersion: "explain-gaps/v1", model: "stand-in" });
    expect(create).toHaveBeenCalledTimes(inputs.length);
    expect(report).toMatchObject({ modelRate: 1, inventedQuotes: 0, wrongHours: 0, exclamations: 0, models: ["claude-opus-5-5"] });
    expect(report.costUsd).toBeGreaterThan(0);
    const md = formatExplainEval(report);
    expect(md).toContain("Model words used 100%");
    expect(md.split("\n").filter((l) => l.startsWith(`| ${inputs[0]!.id} |`))).toHaveLength(1);
  });
});
