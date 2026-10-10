import { describe, expect, it } from "vitest";
import { displayName, firstName, NO_NAME } from "./name";

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
});
