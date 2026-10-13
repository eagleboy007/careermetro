import recorded from "../../../fixtures/credly/badges.json";
import type { CredlyBadge } from "@/lib/schemas";
import type { CredlyFetch, CredlyFetcher } from "./credly";

/**
 * Synthetic Credly replies (fixtures/credly/badges.json): made-up people and ids in the shape of Credly's public badge
 * JSON. Unit tests use them, and so does local test mode (the stand-in Claude API on this machine, never production),
 * so the e2e walk checks badges without calling Credly.
 */
export const credlyFixtures = recorded.badges as unknown as Record<string, { status: number; body: CredlyBadge }>;

/** Answers from the fixtures: 200 with the body, 404 for an id not listed, anything else as Credly failing. */
export const credlyFixtureFetcher: CredlyFetcher = async (badgeId): Promise<CredlyFetch> => {
  const f = credlyFixtures[badgeId.toLowerCase()];
  if (!f || f.status === 404) return { kind: "not_found" };
  if (f.status === 403) return { kind: "private" };
  if (f.status !== 200) return { kind: "unreachable" };
  return { kind: "ok", body: f.body };
};
