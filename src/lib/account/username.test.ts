import { describe, expect, it } from "vitest";
import { cleanHeadline, headlineProblem, lakhText, normalUsername, parseLakh, RESERVED_USERNAMES, usernameProblem } from "./username";

describe("usernames", () => {
  it("are compared trimmed and lowercase", () => {
    expect(normalUsername("  Priya-N ")).toBe("priya-n");
  });

  it.each([
    ["priya-n", null],
    ["ab3", null],
    ["a".repeat(30), null],
    ["ab", "short"],
    ["a".repeat(31), "long"],
    ["priya_n", "chars"],
    ["priya.n", "chars"],
    ["priya n", "chars"],
    ["prïya", "chars"],
    ["-priya", "hyphen"],
    ["priya-", "hyphen"],
    ["priya--n", "hyphen"],
    ["9876543210", "phone"],
    ["priya-98765-43210", "phone"],
    ["priya-987654321", null],
    ["admin", "reserved"],
    ["settings", "reserved"],
    ["support", "reserved"],
    ["careermetro-help", "reserved"],
    ["the-careermetro", "reserved"],
  ] as const)("%s -> %s", (name, problem) => {
    expect(usernameProblem(name)).toBe(problem);
  });

  it("reserve every signed-in route", () => {
    for (const route of ["today", "map", "departures", "arrivals", "inbox", "settings", "corporate", "admin", "grievances", "account"])
      expect(RESERVED_USERNAMES.has(route)).toBe(true);
  });
});

describe("headlines", () => {
  it("are one line, single-spaced", () => {
    expect(cleanHeadline("  IT support \n moving   into SOC ")).toBe("IT support moving into SOC");
  });

  it("refuse contact details and long text", () => {
    expect(headlineProblem("IT support moving into security operations")).toBeNull();
    expect(headlineProblem("Reach me at priya@example.com")).toBe("contact");
    expect(headlineProblem("Call 98765 43210")).toBe("contact");
    expect(headlineProblem("Call +91-98765-43210")).toBe("contact");
    expect(headlineProblem("5 years, 3 roles, 2 cities")).toBeNull();
    expect(headlineProblem("a".repeat(81))).toBe("long");
  });
});

describe("pay in lakh a year", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["4.2", 4.2],
    ["12", 12],
    ["6.50", 6.5],
    [".5", 0.5],
    ["999", 999],
    ["0", undefined],
    ["0.05", undefined],
    ["1000", undefined],
    ["4.255", undefined],
    ["4,2", undefined],
    ["-3", undefined],
    ["4 lakh", undefined],
    ["1e2", undefined],
  ] as const)("%j -> %s", (raw, n) => {
    expect(parseLakh(raw)).toBe(n);
  });

  it("show back without trailing zeros", () => {
    expect(lakhText(6)).toBe("6");
    expect(lakhText(6.5)).toBe("6.5");
    expect(lakhText(null)).toBe("");
  });
});
