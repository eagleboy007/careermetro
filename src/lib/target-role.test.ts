import { afterEach, describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import { TARGET_ROLE_CHIPS, clearTargetRole, peekTargetRole, saveTargetRole } from "./target-role";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the target role chips on Today", () => {
  it("are role profiles we have, under their own titles", () => {
    for (const chip of TARGET_ROLE_CHIPS) {
      expect(roleProfiles.find((r) => r.slug === chip.slug)?.title).toBe(chip.title);
    }
  });

  it("carry the picked role until it is cleared", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    saveTargetRole("data-analyst");
    expect(peekTargetRole()).toBe("data-analyst");
    expect(peekTargetRole()).toBe("data-analyst");
    clearTargetRole();
    expect(peekTargetRole()).toBe("");
  });

  it("forget an earlier pick for More roles, and keep only chip slugs", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    saveTargetRole("cloud-engineer");
    saveTargetRole(null);
    expect(peekTargetRole()).toBe("");
    saveTargetRole("not-a-role");
    expect(peekTargetRole()).toBe("");
    storage.setItem("cm-target-role", "not-a-role");
    expect(peekTargetRole()).toBe("");
  });

  it("work without storage", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => saveTargetRole("data-analyst")).not.toThrow();
    expect(() => clearTargetRole()).not.toThrow();
    expect(peekTargetRole()).toBe("");
  });
});
