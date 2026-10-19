import { describe, expect, it } from "vitest";
import { networkQuery, networkSearchInput } from "@/lib/schemas/network";
import { askAgainFrom, byNetworkRank, connectionState, handleOf, mutualOf, networkMatches, pairOf, requestOpen, seesGaps, senderSeesRequested, skillsInCommon, type RequestRow } from "./rules";

const now = new Date("2026-10-20T10:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 24 * 3600_000);
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const sent = (over: Partial<RequestRow> = {}): RequestRow => ({ fromUser: A, toUser: B, status: "pending", createdAt: days(1), decidedAt: null, ...over });

describe("network rules", () => {
  it("stores a pair one way whoever asks", () => {
    expect(pairOf(B, A)).toEqual({ userLow: A, userHigh: B });
    expect(pairOf(A, B)).toEqual({ userLow: A, userHigh: B });
  });

  it("lets a request stand for 30 days", () => {
    expect(requestOpen(sent({ createdAt: days(29) }), now)).toBe(true);
    expect(requestOpen(sent({ createdAt: days(30) }), now)).toBe(false);
    expect(requestOpen(sent({ status: "ignored" }), now)).toBe(false);
  });

  it("reads each side of a request, keeping an ignore silent", () => {
    expect(connectionState(false, [], A, now)).toBe("none");
    expect(connectionState(true, [], A, now)).toBe("connected");
    expect(connectionState(false, [sent()], A, now)).toBe("requested");
    expect(connectionState(false, [sent()], B, now)).toBe("incoming");
    expect(connectionState(false, [sent({ status: "ignored", decidedAt: days(0) })], A, now)).toBe("requested");
    expect(senderSeesRequested(sent({ status: "ignored", createdAt: days(31) }), now)).toBe(false);
    expect(connectionState(false, [sent({ status: "ignored", decidedAt: days(0) })], B, now)).toBe("none");
    expect(connectionState(false, [sent({ createdAt: days(31) })], A, now)).toBe("none");
    expect(connectionState(false, [sent({ status: "withdrawn" })], B, now)).toBe("none");
  });

  it("makes the sender wait 30 days after an ignore or an expiry, not after a withdraw", () => {
    expect(askAgainFrom([sent({ status: "ignored", createdAt: days(40), decidedAt: days(20) })], A, B, now)).toEqual(days(-10));
    expect(askAgainFrom([sent({ status: "ignored", createdAt: days(70), decidedAt: days(60) })], A, B, now)).toBeNull();
    // Expired: 30 days to end, then 30 more.
    expect(askAgainFrom([sent({ createdAt: days(45) })], A, B, now)).toEqual(days(-15));
    expect(askAgainFrom([sent({ status: "expired", createdAt: days(61) })], A, B, now)).toBeNull();
    expect(askAgainFrom([sent({ status: "withdrawn", createdAt: days(1) })], A, B, now)).toBeNull();
    // Only the same sender to the same person waits.
    expect(askAgainFrom([sent({ status: "ignored", decidedAt: days(1) })], B, A, now)).toBeNull();
  });

  it("finds by the start of the first name, last name or handle", () => {
    expect(networkMatches("pri nai", { name: "Priya Nair", username: null })).toBe(true);
    expect(networkMatches("nair", { name: "Priya Nair", username: null })).toBe(true);
    expect(networkMatches("riya", { name: "Priya Nair", username: null })).toBe(false);
    expect(networkMatches("@Priya_", { name: "Someone Else", username: "priya_n" })).toBe(true);
    expect(networkMatches("priya", { name: "Someone Else", username: "priya_n" })).toBe(true);
    // "@" means a handle, never a name.
    expect(networkMatches("@nair", { name: "Priya Nair", username: "pn" })).toBe(false);
    expect(handleOf("@Asha_R")).toBe("asha_r");
  });

  it("counts shared skills only when the other person shows skills, and mutual connections", () => {
    expect(skillsInCommon(["sql", "python", "excel"], ["python", "sql", "sql", "tableau"], true)).toBe(2);
    expect(skillsInCommon(["sql"], ["sql"], false)).toBe(0);
    expect(mutualOf(new Set(["x", "y", "z"]), new Set(["y", "z", "q"]))).toEqual(["y", "z"]);
  });

  it("ranks connections first, then skills in common, mutual connections and name", () => {
    const people = [
      { name: "Zara", state: "none" as const, common: 5, mutual: 0 },
      { name: "Bina", state: "connected" as const, common: 0, mutual: 0 },
      { name: "Anil", state: "none" as const, common: 5, mutual: 0 },
      { name: "Dev", state: "none" as const, common: 5, mutual: 2 },
      { name: "Chitra", state: "requested" as const, common: 9, mutual: 0 },
    ];
    expect([...people].sort(byNetworkRank).map((p) => p.name)).toEqual(["Bina", "Chitra", "Dev", "Anil", "Zara"]);
  });

  it("shows gaps as the owner chose", () => {
    expect(seesGaps("nobody", { self: true, connected: false })).toBe(true);
    expect(seesGaps("nobody", { self: false, connected: true })).toBe(false);
    expect(seesGaps("connections", { self: false, connected: true })).toBe(true);
    expect(seesGaps("connections", { self: false, connected: false })).toBe(false);
    expect(seesGaps("profile", { self: false, connected: false })).toBe(true);
  });

  it("asks for at least 2 letters or digits, with filters off unless asked", () => {
    expect(networkQuery.safeParse("a.").success).toBe(false);
    expect(networkQuery.safeParse("@a").success).toBe(false);
    expect(networkQuery.parse("  pri   nai ")).toBe("pri nai");
    expect(networkQuery.safeParse("x".repeat(81)).success).toBe(false);
    expect(networkSearchInput.parse({ q: "asha" })).toEqual({ q: "asha", sameRole: false, sameCity: false, verified: false });
  });
});
