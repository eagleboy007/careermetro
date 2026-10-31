import { afterEach, describe, expect, it, vi } from "vitest";
import { clearStandInTitle, peekStandInTitle, saveStandInTitle } from "./stand-in-title";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("carrying the typed title to My role isn't listed", () => {
  it("hands over one tidy line until it is cleared", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    saveStandInTitle("  Fleet   Planning Analyst ");
    expect(peekStandInTitle()).toBe("Fleet Planning Analyst");
    expect(peekStandInTitle()).toBe("Fleet Planning Analyst");
    clearStandInTitle();
    expect(peekStandInTitle()).toBe("");
  });

  it("clears an earlier title when the box is empty", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    saveStandInTitle("Fleet Planning Analyst");
    saveStandInTitle("   ");
    expect(peekStandInTitle()).toBe("");
  });

  it("works without storage", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => saveStandInTitle("Fleet Planning Analyst")).not.toThrow();
    expect(() => clearStandInTitle()).not.toThrow();
    expect(peekStandInTitle()).toBe("");
  });
});
