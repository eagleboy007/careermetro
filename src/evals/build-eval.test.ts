import { describe, expect, it } from "vitest";
import { formatBuildEval, loadBuildCases, runBuildEval, scoreBuild } from "./build-eval";

// The build-resume eval's scoring, without the API: runs in CI with `npm test`.
describe("build-resume eval scoring", () => {
  const cases = loadBuildCases();

  it("loads the synthetic cases", () => {
    expect(cases.map((c) => c.id)).toEqual(["fresher-security-lab", "switcher-data-analyst", "vague-answers"]);
  });

  it("counts made-up numbers and tools, and wrong or missing answer ids", () => {
    const c = cases.find((x) => x.id === "fresher-security-lab")!;
    const score = scoreBuild(c, {
      answers: [
        { answerId: "p:p1", lines: ["Set up Wazuh on 3 home machines", "Monitored 50 machines with Splunk!"] },
        { answerId: "p:zz", lines: ["Something"] },
      ],
      suggestions: [],
    });
    expect(score.unsupported).toEqual(["Monitored 50 machines with Splunk!"]);
    expect(score.missingIds).toEqual(["j:j1"]);
    expect(score.extraIds).toEqual(["p:zz"]);
    expect(score.exclamations).toBe(1);
  });

  it("reports a case the model didn't answer", async () => {
    const report = await runBuildEval(cases, async () => null, { promptVersion: "build-resume/v1", model: "test" });
    expect(report.answeredRate).toBe(0);
    expect(formatBuildEval(report)).toContain("build-resume/v1");
  });
});
