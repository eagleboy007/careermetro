import { describe, expect, it } from "vitest";
import { networkQuery } from "@/lib/schemas/network";
import { byNetworkRank, connectionState, networkMatches, pairOf, requestLive, skillsInCommon, usernameOf } from "./rules";

const now = new Date("2026-10-20T10:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 24 * 3600_000);
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("network rules", () => {
  it("stores a pair one way whoever asks", () => {
    expect(pairOf(B, A)).toEqual({ userA: A, userB: B });
    expect(pairOf(A, B)).toEqual({ userA: A, userB: B });
  });

  it("lets a request stand for 30 days", () => {
    expect(requestLive({ createdAt: days(29) }, now)).toBe(true);
    expect(requestLive({ createdAt: days(30) }, now)).toBe(false);
  });

  it("reads each side of a request", () => {
    const pending = { status: "pending" as const, requestedBy: A, ignoredAt: null, createdAt: days(1) };
    expect(connectionState(null, A, now)).toBe("none");
    expect(connectionState(pending, A, now)).toBe("requested");
    expect(connectionState(pending, B, now)).toBe("incoming");
    // Ignore is silent: the sender still reads Requested; the receiver sees nothing waiting.
    expect(connectionState({ ...pending, ignoredAt: days(0) }, A, now)).toBe("requested");
    expect(connectionState({ ...pending, ignoredAt: days(0) }, B, now)).toBe("none");
    expect(connectionState({ ...pending, createdAt: days(31) }, A, now)).toBe("none");
    expect(connectionState({ ...pending, status: "accepted", createdAt: days(400) }, B, now)).toBe("connected");
  });

  it("finds by the start of each name word or the exact username", () => {
    expect(networkMatches("pri nai", { name: "Priya Nair", username: null })).toBe(true);
    expect(networkMatches("riya", { name: "Priya Nair", username: null })).toBe(false);
    expect(networkMatches("@Priya_N", { name: "Someone Else", username: "priya_n" })).toBe(true);
    expect(networkMatches("priya_", { name: "Someone Else", username: "priya_n" })).toBe(false);
    // "@" means a username, never a name.
    expect(networkMatches("@priya", { name: "Priya Nair", username: "pn" })).toBe(false);
    expect(usernameOf("@Asha_R")).toBe("asha_r");
  });

  it("counts shared skills only when the other person shows skills", () => {
    expect(skillsInCommon(["sql", "python", "excel"], ["python", "sql", "sql", "tableau"], true)).toBe(2);
    expect(skillsInCommon(["sql"], ["sql"], false)).toBe(0);
  });

  it("ranks connections first, then skills in common, then name", () => {
    const people = [
      { name: "Zara", state: "none" as const, common: 5 },
      { name: "Bina", state: "connected" as const, common: 0 },
      { name: "Anil", state: "none" as const, common: 5 },
      { name: "Chitra", state: "requested" as const, common: 9 },
    ];
    expect([...people].sort(byNetworkRank).map((p) => p.name)).toEqual(["Bina", "Chitra", "Anil", "Zara"]);
  });

  it("asks for at least 2 letters or digits", () => {
    expect(networkQuery.safeParse("a.").success).toBe(false);
    expect(networkQuery.safeParse("@a").success).toBe(false);
    expect(networkQuery.parse("  pri   nai ")).toBe("pri nai");
    expect(networkQuery.safeParse("x".repeat(81)).success).toBe(false);
  });
});
