import { describe, expect, it } from "vitest";
import { windowLimiter } from "./rate-limit";

describe("windowLimiter", () => {
  it("allows up to the limit per key within the window, then again once it passes", () => {
    const limit = windowLimiter(2, 1000);
    expect([limit.take("a", 0), limit.take("a", 10), limit.take("a", 20)]).toEqual([true, true, false]);
    expect(limit.allows("a", 500)).toBe(false);
    expect(limit.take("b", 20)).toBe(true);
    expect(limit.take("a", 1015)).toBe(true);
  });

  it("keeps at most maxKeys keys", () => {
    const limit = windowLimiter(1, 1000, 2);
    limit.take("a", 0);
    limit.take("b", 0);
    limit.take("c", 0);
    // "a" was forgotten, so it starts afresh.
    expect(limit.take("a", 1)).toBe(true);
  });
});
