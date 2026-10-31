import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const make = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/gaps/choose", () => ({
  makeDestination: (...a: unknown[]) => make(...a),
  DESTINATION_MESSAGES: {
    invalid: "That didn't work. Please refresh the page and try again.",
    limit: "That's as many destination changes as we allow in a day. Try again tomorrow.",
    busy: "Your gaps are still being worked out. Please try again in a minute.",
  },
}));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { chooseDestination } = await import("./actions");
const input = { analysisId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f" };

describe("chooseDestination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("asks a signed-out person to sign in, and changes nothing", async () => {
    account.mockResolvedValue(null);
    expect(await chooseDestination(input)).toBe("Please sign in again.");
    expect(make).not.toHaveBeenCalled();
  });

  it("makes the person's own analysis their destination and refreshes the page", async () => {
    make.mockResolvedValue({ ok: true, changed: true });
    expect(await chooseDestination(input)).toBeNull();
    expect(make).toHaveBeenCalledWith("u1", input);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says why when the store refuses, and refreshes nothing", async () => {
    make.mockResolvedValue({ ok: false, error: "limit" });
    expect(await chooseDestination(input)).toMatch(/as many destination changes/);
    make.mockResolvedValue({ ok: false, error: "invalid" });
    expect(await chooseDestination({ analysisId: "nope" })).toMatch(/refresh the page/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("logs only the event name when the store throws", async () => {
    make.mockRejectedValue(new Error("db down"));
    expect(await chooseDestination(input)).toBe("That didn't work. Please try again.");
    expect(log).toHaveBeenCalledWith("error", "destination_change_failed", {});
  });
});
