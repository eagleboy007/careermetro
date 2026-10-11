import { describe, expect, it } from "vitest";
import { displayName, firstName, fullName, NO_NAME, splitName } from "./name";

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
