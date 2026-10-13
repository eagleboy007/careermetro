import { afterEach, describe, expect, it, vi } from "vitest";
import { nearbyLines } from "@/lib/schemas";
import { nearbyOrNothing } from "./safe";

describe("nearbyOrNothing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes good lines through", () => {
    const good = { lines: [], closest: null };
    expect(nearbyOrNothing(() => good)).toBe(good);
  });

  it("on a parse failure logs nearby_failed with the field paths only, and gives nothing so the page still renders", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = {
      lines: [
        {
          slug: "secret-role",
          title: "Kubernetes Wizard",
          experience: "2 to 5 years",
          shared: 2,
          total: 0,
          sharedSkills: [{ name: "Kubernetes", byProof: false }],
          onResume: ["Terraform"],
          toAdd: [],
          crossSkillIds: [],
        },
      ],
      closest: null,
    };
    expect(nearbyOrNothing(() => nearbyLines.parse(bad))).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logged.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", event: "nearby_failed", error: "zod" });
    expect(line.paths).toContain("lines.0.total");
    const text = logged.mock.calls[0][0] as string;
    for (const word of ["Kubernetes", "Terraform", "Wizard", "secret-role"]) expect(text).not.toContain(word);
  });

  it("logs any other failure by its kind, never its message", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      nearbyOrNothing(() => {
        throw new Error("Python missing for Data Analyst");
      }),
    ).toBeUndefined();
    const text = logged.mock.calls[0][0] as string;
    expect(JSON.parse(text).event).toBe("nearby_failed");
    expect(text).not.toContain("Python");
  });
});
