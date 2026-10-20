import { describe, expect, it } from "vitest";
import { goalLinkFor, goalLinksFor, goalLinkText, type LinkGoal } from "./goal-link";

const goal = (skillId: string, name: string, status: LinkGoal["status"], extra: Partial<LinkGoal> = {}): LinkGoal => ({
  skillId,
  name,
  status,
  learnDone: false,
  proved: false,
  ...extra,
});

// Pitstops as the Map numbers them: a missing skill learns then proves, a weak one proves only.
// linux (weak): 1 prove. siem (missing): 2 learn, 3 prove. aws (missing): 4 learn, 5 prove.
const line = [goal("linux", "Linux", "weak"), goal("siem", "SIEM", "missing"), goal("aws-security", "AWS security", "missing")];

describe("closed role to goal link", () => {
  it("names the first goal the job asked for, at its prove pitstop", () => {
    expect(goalLinkFor({ required: ["aws-security", "siem"], oneOf: [] }, line, new Set())).toEqual({ name: "SIEM", pitstop: 3 });
    expect(goalLinkFor({ required: ["aws-security"], oneOf: [] }, line, new Set())).toEqual({ name: "AWS security", pitstop: 5 });
    expect(goalLinkFor({ required: ["linux"], oneOf: [] }, line, new Set())).toEqual({ name: "Linux", pitstop: 1 });
  });

  it("shows nothing when no skill the job asked for is an open goal", () => {
    expect(goalLinkFor({ required: ["python"], oneOf: [] }, line, new Set())).toBeNull();
    expect(goalLinkFor({ required: [], oneOf: [] }, line, new Set())).toBeNull();
    expect(goalLinkFor({ required: ["siem"], oneOf: [] }, [], new Set())).toBeNull();
  });

  it("passes proved and skipped goals, keeping the Map's numbering", () => {
    const l = [goal("linux", "Linux", "weak", { proved: true }), goal("siem", "SIEM", "missing", { skipped: true }), line[2]];
    expect(goalLinkFor({ required: ["linux", "siem"], oneOf: [] }, l, new Set(["linux"]))).toBeNull();
    expect(goalLinkFor({ required: ["siem", "aws-security"], oneOf: [] }, l, new Set(["linux"]))).toEqual({ name: "AWS security", pitstop: 5 });
  });

  it("follows a goal swapped with Not for me to the skill it is on now", () => {
    const l = [goal("linux", "Linux", "weak"), goal("siem", "Splunk", "missing", { learns: "splunk" })];
    expect(goalLinkFor({ required: ["splunk"], oneOf: [] }, l, new Set())).toEqual({ name: "Splunk", pitstop: 3 });
    // The job asked for the skill the person swapped away from: the goal is on another skill now, so no line.
    expect(goalLinkFor({ required: ["siem"], oneOf: [] }, l, new Set())).toBeNull();
  });

  it("reads a one-of group only when none of its skills is proved", () => {
    expect(goalLinkFor({ required: [], oneOf: [["siem", "splunk"]] }, line, new Set())).toEqual({ name: "SIEM", pitstop: 3 });
    expect(goalLinkFor({ required: [], oneOf: [["siem", "splunk"]] }, line, new Set(["splunk"]))).toBeNull();
  });

  it("maps each closed application and words the line as the prototype", () => {
    const links = goalLinksFor(
      [
        { applicationId: "a", requirements: { required: ["aws-security"], oneOf: [] } },
        { applicationId: "b", requirements: { required: ["python"], oneOf: [] } },
      ],
      line,
      new Set(),
    );
    expect(links).toEqual({ a: { name: "AWS security", pitstop: 5 } });
    expect(goalLinkText(links.a)).toBe("AWS security is a goal on your line (Pitstop 5). Prove it and roles like this one open up.");
  });
});
