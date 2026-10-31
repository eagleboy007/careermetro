import { describe, expect, it } from "vitest";
import { DECIDE_WITHIN_HOURS } from "@/lib/schemas/legal-timings";
import {
  appealBy,
  appealDecideBy,
  canSeePost,
  countsFor,
  decodeCursor,
  encodeCursor,
  postingProblem,
  purgeAfter,
  reportReference,
  shouldHold,
  showsText,
  topPoints,
  withinEditWindow,
  type SeenPost,
} from "./rules";

const now = new Date("2026-10-31T10:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("topPoints and countsFor", () => {
  it("weighs upvotes 1, commenters 2 and reshares 3", () => {
    expect(topPoints({ upvotes: 4, commenters: 2, reshares: 1 })).toBe(11);
  });

  it("leaves out the author's own actions, young or deleting accounts, and a person's second comment", () => {
    const old = daysAgo(30);
    const c = countsFor(
      "author",
      {
        votes: [
          { userId: "a", accountCreatedAt: old },
          { userId: "b", accountCreatedAt: hoursAgo(2) },
          { userId: "c", accountCreatedAt: old, deleting: true },
        ],
        comments: [
          { userId: "a", accountCreatedAt: old },
          { userId: "a", accountCreatedAt: old },
          { userId: "author", accountCreatedAt: old },
        ],
        reshares: [{ userId: "d", accountCreatedAt: old }],
      },
      now,
    );
    expect(c).toEqual({ upvotes: 3, comments: 3, reshares: 1, topPoints: 1 + 2 * 1 + 3 * 1 });
  });
});

describe("canSeePost and showsText", () => {
  const post: SeenPost = { authorId: "author", status: "visible", deletedAt: null, authorSuspended: false, authorDeleting: false };

  it("shows a visible post to everyone without a block", () => {
    expect(canSeePost("viewer", post, false)).toBe(true);
    expect(canSeePost("viewer", post, true)).toBe(false);
  });

  it("hides held, pending and hidden posts from everyone but their author", () => {
    for (const status of ["held", "pending", "hidden"] as const) {
      expect(canSeePost("viewer", { ...post, status }, false)).toBe(false);
      expect(canSeePost("author", { ...post, status }, false)).toBe(true);
      expect(showsText("viewer", { ...post, status })).toBe(false);
      expect(showsText("author", { ...post, status })).toBe(true);
    }
  });

  it("hides deleted posts and those of suspended or deleting accounts from everyone", () => {
    for (const p of [{ ...post, deletedAt: now }, { ...post, authorSuspended: true }, { ...post, authorDeleting: true }]) {
      expect(canSeePost("viewer", p, false)).toBe(false);
      expect(canSeePost("author", p, false)).toBe(false);
    }
  });
});

describe("withinEditWindow and postingProblem", () => {
  it("allows edits for 30 minutes", () => {
    expect(withinEditWindow(new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
    expect(withinEditWindow(new Date(now.getTime() - 31 * 60_000), now)).toBe(false);
  });

  it("needs a name, a day-old account to post, and a week-old account to add a link", () => {
    expect(postingProblem({ name: null, createdAt: daysAgo(30) }, now, false)).toBe("no_name");
    expect(postingProblem({ name: " ", createdAt: daysAgo(30) }, now, false)).toBe("no_name");
    expect(postingProblem({ name: "Priya", createdAt: hoursAgo(23) }, now, false)).toBe("new_account");
    expect(postingProblem({ name: "Priya", createdAt: hoursAgo(25) }, now, false)).toBeNull();
    expect(postingProblem({ name: "Priya", createdAt: daysAgo(6) }, now, true)).toBe("link_wait");
    expect(postingProblem({ name: "Priya", createdAt: daysAgo(7) }, now, true)).toBeNull();
  });
});

describe("shouldHold", () => {
  const settled = (id: string, reason = "harassment") => ({ reporterId: id, reason, reporterCreatedAt: daysAgo(10) });

  it("holds at the first child_safety report, whoever files it", () => {
    expect(shouldHold([{ reporterId: "n", reason: "child_safety", reporterCreatedAt: hoursAgo(1) }], now)).toBe(true);
    expect(shouldHold([{ reporterId: null, reason: "child_safety", reporterCreatedAt: null }], now)).toBe(true);
  });

  it("holds at three reports from three accounts at least 7 days old", () => {
    expect(shouldHold([settled("a"), settled("b")], now)).toBe(false);
    expect(shouldHold([settled("a"), settled("b"), settled("c")], now)).toBe(true);
    expect(shouldHold([settled("a"), settled("a"), settled("b")], now)).toBe(false);
    expect(shouldHold([settled("a"), settled("b"), { reporterId: "c", reason: "harassment", reporterCreatedAt: daysAgo(6) }], now)).toBe(false);
    expect(shouldHold([settled("a"), settled("b"), { reporterId: null, reason: "other", reporterCreatedAt: null }], now)).toBe(false);
  });
});

describe("references, appeal windows, records and deadlines", () => {
  it("makes a reference from the report id", () => {
    expect(reportReference("4f2k9a1b-3c00-4000-8000-000000000001".replace("k", "e"))).toBe("R-4F2E9A1B3C");
  });

  it("opens an appeal for 30 days, decides it in 15, and keeps records 180 days", () => {
    expect(appealBy(now).toISOString()).toBe("2026-11-30T10:00:00.000Z");
    expect(appealDecideBy(now).toISOString()).toBe("2026-11-15T10:00:00.000Z");
    expect(purgeAfter(now).toISOString()).toBe("2027-04-29T10:00:00.000Z");
  });

  it("has a deadline for each new reason", () => {
    expect(DECIDE_WITHIN_HOURS.child_safety).toBe(24);
    for (const r of ["hate", "privacy", "misleading", "copyright"] as const) expect(DECIDE_WITHIN_HOURS[r]).toBe(72);
  });
});

describe("the feed cursor", () => {
  const id = "00000000-0000-4000-8000-0000000000a1";
  it("round-trips for Top and the newest-first feeds", () => {
    const top = { points: 12, at: "2026-10-31T10:00:00.123Z", id };
    expect(decodeCursor(encodeCursor(top), true)).toEqual(top);
    const fresh = { points: null, at: "2026-10-31T10:00:00.123Z", id };
    expect(decodeCursor(encodeCursor(fresh), false)).toEqual(fresh);
  });

  it("refuses a tampered cursor or one for the other ordering", () => {
    expect(decodeCursor(encodeCursor({ points: null, at: "2026-10-31T10:00:00Z", id }), true)).toBeNull();
    expect(decodeCursor(encodeCursor({ points: 3, at: "2026-10-31T10:00:00Z", id }), false)).toBeNull();
    expect(decodeCursor("bm90LWEtY3Vyc29y", false)).toBeNull();
    expect(decodeCursor(undefined, false)).toBeNull();
    expect(decodeCursor(btoa(`|2026-10-31T10:00:00Z|${id}|x`), false)).toBeNull();
  });
});
