import { describe, expect, it } from "vitest";
import { SMART_HINTS, smartCheck, smartLetters, type SmartStory } from "./smart";

// A made-up story that meets all five letters.
const full: SmartStory = {
  where: "Konkan Co-operative Bank · 2025",
  situation: "Phishing alerts were piling up and the team missed some.",
  task: "I owned the morning triage of the alert queue.",
  action: "I sorted the alerts by sender domain, wrote a short checklist for the team and set a daily review with my lead.",
  result: "Missed alerts fell from 9 a week to 1 within six weeks.",
  boxes: ["Ownership", "Problem solving"],
  goalLinked: false,
};

describe("smartLetters", () => {
  it("meets every letter for a full story", () => {
    expect(smartLetters(full)).toEqual(["S", "M", "A", "R", "T"]);
    expect(smartCheck(full)).toEqual({ smart: ["S", "M", "A", "R", "T"], hint: null });
  });

  it("S needs Where and an Action of at least 12 words", () => {
    expect(smartLetters({ ...full, where: " " })).not.toContain("S");
    expect(smartLetters({ ...full, action: "I sorted the alerts." })).not.toContain("S");
    expect(smartLetters({ ...full, action: "one two three four five six seven eight nine ten eleven twelve" })).toContain("S");
    expect(smartLetters({ ...full, action: "one two three four five six seven eight nine ten eleven" })).not.toContain("S");
  });

  it("M needs a number in the Result", () => {
    expect(smartLetters({ ...full, result: "Missed alerts fell a lot." })).not.toContain("M");
    expect(smartLetters({ ...full, result: "Cut it by 40%." })).toContain("M");
  });

  it("A needs the person's own part in the Task", () => {
    expect(smartLetters({ ...full, task: "The team had to triage alerts." })).not.toContain("A");
    expect(smartLetters({ ...full, task: "My job was the triage." })).toContain("A");
    expect(smartLetters({ ...full, task: "I'm the one who ran triage." })).toContain("A");
    // "Mine" and "Time" hold the letters but not the word.
    expect(smartLetters({ ...full, task: "Mining logs took time." })).not.toContain("A");
  });

  it("R needs a goal or more than one box", () => {
    expect(smartLetters({ ...full, boxes: ["Ownership"] })).not.toContain("R");
    expect(smartLetters({ ...full, boxes: ["Ownership"], goalLinked: true })).toContain("R");
  });

  it("T needs a year, a month or a duration anywhere", () => {
    const timeless = {
      ...full,
      where: "Konkan Co-operative Bank",
      action: "I sorted the alerts by sender domain, wrote a short checklist for the team and set a review with my lead.",
      result: "Missed alerts fell from 9 to 1.",
    };
    expect(smartLetters(timeless)).not.toContain("T");
    expect(smartLetters({ ...timeless, situation: "In March the queue grew." })).toContain("T");
    expect(smartLetters({ ...timeless, result: "Missed alerts fell to 1 in 3 weeks." })).toContain("T");
    expect(smartLetters({ ...timeless, action: `${timeless.action} We met weekly.` })).toContain("T");
    // "May" is a verb as often as a month, so it doesn't count alone.
    expect(smartLetters({ ...timeless, situation: "Alerts may pile up." })).not.toContain("T");
  });
});

describe("smartCheck", () => {
  it("gives one hint, for the first letter missing", () => {
    expect(smartCheck({ ...full, result: "It got better." }).hint).toBe(SMART_HINTS.M);
    expect(smartCheck({ ...full, where: "", result: "It got better." }).hint).toBe(SMART_HINTS.S);
    const empty = { where: "", situation: "", task: "", action: "", result: "", boxes: ["Learning"], goalLinked: false };
    expect(smartCheck(empty)).toEqual({ smart: [], hint: SMART_HINTS.S });
    expect(smartCheck({ ...full, boxes: ["Ownership"] }).hint).toBe(SMART_HINTS.R);
  });

  it("never gives a score", () => {
    expect(Object.keys(smartCheck(full)).sort()).toEqual(["hint", "smart"]);
  });
});
