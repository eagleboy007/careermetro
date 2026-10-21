import { afterEach, describe, expect, it, vi } from "vitest";
import { failureReason, TimeLimitError, withinLimit } from "./time-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("withinLimit", () => {
  it("gives the work's answer, or its own error, when it settles in time, and clears the timer", async () => {
    vi.useFakeTimers();
    expect(await withinLimit(Promise.resolve("rows"), 1000)).toBe("rows");
    await expect(withinLimit(Promise.reject(new Error("down")), 1000)).rejects.toThrow("down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a TimeLimitError once the limit passes, and ignores the work's late rejection", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const work = new Promise<string>((_, reject) => (fail = reject));
    const raced = withinLimit(work, 6000);
    let settled = false;
    const caught = raced.catch((e: unknown) => e).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(error).toBeInstanceOf(TimeLimitError);
    expect(failureReason(error)).toBe("timeout");
    // Settling afterwards changes nothing and raises no unhandled rejection.
    fail(new Error("late"));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never waits on a hung read", async () => {
    vi.useFakeTimers();
    const hung = new Promise<never>(() => {});
    const raced = withinLimit(hung, 100).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await raced).toBeInstanceOf(TimeLimitError);
  });
});

describe("failureReason", () => {
  const pg = (code: string) => Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("db"), { code }) });

  it("names the server's limits and a missing table from the driver's code, on the error or its cause", () => {
    expect(failureReason(pg("57014"))).toBe("statement_timeout");
    expect(failureReason(pg("55P03"))).toBe("lock_timeout");
    expect(failureReason(pg("42P01"))).toBe("missing");
    expect(failureReason(Object.assign(new Error("x"), { code: "57014" }))).toBe("statement_timeout");
  });

  it("calls anything else an error", () => {
    expect(failureReason(pg("08006"))).toBe("error");
    expect(failureReason(new Error("boom"))).toBe("error");
    expect(failureReason("text")).toBe("error");
    expect(failureReason(null)).toBe("error");
  });
});
