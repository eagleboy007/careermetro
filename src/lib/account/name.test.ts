import { describe, expect, it } from "vitest";
import { displayName, firstName, fullName, NO_NAME, resumeName, shortName, splitName } from "./name";

describe("account names (T6)", () => {
  it("uses the given name, else a neutral label, never the email", () => {
    expect(displayName(" Asha Rao ")).toBe("Asha Rao");
    expect(displayName(null)).toBe(NO_NAME);
    expect(displayName("   ")).toBe(NO_NAME);
  });

  it("greets by first name, or with no name at all", () => {
    expect(firstName("Asha Rao")).toBe("Asha");
    expect(firstName(null)).toBe("");
    expect(firstName("  ")).toBe("");
  });

  it("joins first and last name, and splits an older full name for the settings form", () => {
    expect(fullName(" Asha ", " Rao  Kumar ")).toBe("Asha Rao Kumar");
    expect(fullName("Asha", "")).toBe("Asha");
    expect(fullName(null, null)).toBe("");
    expect(splitName("Asha Rao Kumar")).toEqual({ first: "Asha", last: "Rao Kumar" });
    expect(splitName(null)).toEqual({ first: "", last: "" });
  });
});

describe("resumeName", () => {
  it("prints first and last name, else the older single name, else none", () => {
    expect(resumeName({ name: "Old", firstName: "Priya", lastName: "Sharma" })).toBe("Priya Sharma");
    expect(resumeName({ name: " Asha Rao ", firstName: null, lastName: " " })).toBe("Asha Rao");
    expect(resumeName({ name: "  ", firstName: null, lastName: null })).toBeNull();
    expect(resumeName(null)).toBeNull();
  });

  it("shortens a name to first name and last initial for the admin pages, never using the email", () => {
    expect(shortName({ name: "Priya Sharma", firstName: "Priya", lastName: "Sharma" })).toBe("Priya S.");
    expect(shortName({ name: null, firstName: " Priya  Devi ", lastName: " sharma " })).toBe("Priya S.");
    expect(shortName({ name: "Asha Rao Kumar", firstName: null, lastName: null })).toBe("Asha R.");
    expect(shortName({ name: "Asha", firstName: null, lastName: null })).toBe("Asha");
    expect(shortName({ name: null, firstName: "Ravi", lastName: null })).toBe("Ravi");
    expect(shortName({ name: "  ", firstName: null, lastName: "Kumar" })).toBe(NO_NAME);
    expect(shortName({ name: null, firstName: null, lastName: null })).toBe(NO_NAME);
  });
});
