import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const setShowOnMap = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));
vi.mock("@/lib/map/riders", () => ({
  setShowOnMap: (...a: unknown[]) => setShowOnMap(...a),
  MAP_SHARE_MESSAGES: { invalid: "bad", limit: "limit" },
}));

const { switchShowOnMap } = await import("./map-share-actions");

// "Show my pitstop on the map" (On your line, C13): the signed-in action from Settings > Privacy and Me.
describe("switchShowOnMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1", name: "Asha Example", email: "asha@example.com" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect(await switchShowOnMap(true)).toBe("Please sign in again.");
    expect(setShowOnMap).not.toHaveBeenCalled();
  });

  it("changes the person's own switch, logs the event name only, and refreshes the page", async () => {
    setShowOnMap.mockResolvedValueOnce({ ok: true, on: true });
    expect(await switchShowOnMap(true)).toBeNull();
    expect(setShowOnMap).toHaveBeenCalledWith("u1", true);
    expect(log).toHaveBeenCalledWith("info", "map_share_on");
    setShowOnMap.mockResolvedValueOnce({ ok: true, on: false });
    expect(await switchShowOnMap(false)).toBeNull();
    expect(log).toHaveBeenCalledWith("info", "map_share_off");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/u1|asha/i);
  });

  it("says why a change was refused, and doesn't refresh", async () => {
    setShowOnMap.mockResolvedValueOnce({ ok: false, error: "limit" });
    expect(await switchShowOnMap(true)).toBe("limit");
    expect(log).toHaveBeenCalledWith("warn", "map_share_limit");
    setShowOnMap.mockResolvedValueOnce({ ok: false, error: "invalid" });
    expect(await switchShowOnMap("on")).toBe("bad");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when something breaks, and logs no name or email", async () => {
    setShowOnMap.mockRejectedValueOnce(new Error("asha@example.com"));
    expect(await switchShowOnMap(true)).toBe("That didn't work. Please try again.");
    expect(log).toHaveBeenCalledWith("error", "map_share_failed", {});
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/asha/);
  });
});
