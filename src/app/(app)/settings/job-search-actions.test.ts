import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const setJobSearch = vi.fn();
const setNotice = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));
vi.mock("@/lib/job-search/store", () => ({
  setJobSearch: (...a: unknown[]) => setJobSearch(...a),
  setNotice: (...a: unknown[]) => setNotice(...a),
  JOB_SEARCH_MESSAGES: { invalid: "bad", limit: "limit", future: "Not later than today.", days: "Pick your notice period first." },
}));

const { saveNotice, switchJobSearch } = await import("./job-search-actions");
const view = { on: false, noticeDays: null, resignedOn: null };

describe("job search actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1", name: "Asha Example", email: "asha@example.com" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect(await switchJobSearch(false)).toBe("Please sign in again.");
    expect(await saveNotice({ days: 30, resignedOn: null })).toBe("Please sign in again.");
    expect(setJobSearch).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });

  it("changes the person's own switch and notice period, and refreshes the page", async () => {
    setJobSearch.mockResolvedValueOnce({ ok: true, view });
    expect(await switchJobSearch(false)).toBeNull();
    expect(setJobSearch).toHaveBeenCalledWith("u1", false);
    setNotice.mockResolvedValueOnce({ ok: true, view: { ...view, noticeDays: 30 } });
    expect(await saveNotice({ days: 30, resignedOn: null })).toBeNull();
    expect(setNotice).toHaveBeenCalledWith("u1", { days: 30, resignedOn: null });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("says why a change was refused, and doesn't refresh", async () => {
    setNotice.mockResolvedValueOnce({ ok: false, error: "future" });
    expect(await saveNotice({ days: 30, resignedOn: "2099-01-01" })).toBe("Not later than today.");
    setJobSearch.mockResolvedValueOnce({ ok: false, error: "limit" });
    expect(await switchJobSearch(true)).toBe("limit");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when something breaks, and logs no name, email or date", async () => {
    setNotice.mockRejectedValueOnce(new Error("asha@example.com 2026-10-01"));
    expect(await saveNotice({ days: 30, resignedOn: "2026-10-01" })).toBe("That didn't work. Please try again.");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/asha|2026-10-01/);
  });
});
