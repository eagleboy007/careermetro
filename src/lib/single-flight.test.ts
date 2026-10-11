import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  it("runs once for concurrent callers with one key, and separately for another key", async () => {
    let release!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (release = r)));
    const calls = [singleFlight("k", fn), singleFlight("k", fn), singleFlight("other", async () => "x")];
    release("answer");
    expect(await Promise.all(calls)).toEqual(["answer", "answer", "x"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again once the first call has finished, and after a failure", async () => {
    await expect(singleFlight("f", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    const fn = vi.fn(async () => 1);
    await singleFlight("f", fn);
    await singleFlight("f", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
