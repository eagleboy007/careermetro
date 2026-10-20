import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const setElite = vi.fn();
const setEliteBadge = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
const MESSAGES: Record<string, string> = { invalid: "bad", limit: "limit", not_elite: "Turn on Elite to use this." };
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));
vi.mock("@/lib/elite/store", () => ({
  setElite: (...a: unknown[]) => setElite(...a),
  setEliteBadge: (...a: unknown[]) => setEliteBadge(...a),
  eliteMessage: (e: string) => MESSAGES[e],
}));

const { switchElite, switchEliteBadge } = await import("./actions");
const plan = { elite: true, badgeShown: false, since: "20 Oct 2026" };

describe("elite actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1", name: "Asha Example", email: "asha@example.com" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect(await switchElite(true)).toBe("Please sign in again.");
    expect(await switchEliteBadge(true)).toBe("Please sign in again.");
    expect(setElite).not.toHaveBeenCalled();
    expect(setEliteBadge).not.toHaveBeenCalled();
  });

  it("changes the person's own plan and refreshes the page", async () => {
    setElite.mockResolvedValueOnce({ ok: true, plan });
    expect(await switchElite(true)).toBeNull();
    expect(setElite).toHaveBeenCalledWith("u1", true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("tells a Free person to turn on Elite for the badge, and doesn't refresh", async () => {
    setEliteBadge.mockResolvedValueOnce({ ok: false, error: "not_elite" });
    expect(await switchEliteBadge(true)).toBe("Turn on Elite to use this.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when something breaks, and logs no name or email", async () => {
    setElite.mockRejectedValueOnce(new Error("asha@example.com"));
    expect(await switchElite(false)).toBe("That didn't work. Please try again.");
    expect(JSON.stringify(log.mock.calls)).not.toContain("asha");
  });
});
