import "server-only";
import type { Sql } from "postgres";
import { getDb } from "@/db";
import { reviewQueue, setReviewStatus, websiteMatches } from "@/lib/corporate/review-queue.mjs";
import type { AdminCompanyView, ReviewResult } from "@/lib/corporate/types";
import { logEvent } from "@/lib/log";
import { companyReviewInput, reviewQueueRow } from "@/lib/schemas/admin";

/*
 * The company review page's data (/admin/companies; dev/corporate-plan.md, call B). The list and the review step are
 * the same code the Companies workflow runs (src/lib/corporate/review-queue.mjs). The caller has already checked the
 * person is an admin (src/lib/admin/server.ts); these functions take their user id for the review record. Logs carry
 * event names and the decision only, never a company's name or domain.
 */

export type AdminDeps = { sql?: Sql };

const client = (deps: AdminDeps): Sql => deps.sql ?? (getDb().$client as Sql);

/** Companies waiting for review, suspended, or left without a Recruiter admin, oldest first. */
export async function companiesForReview(deps: AdminDeps = {}): Promise<AdminCompanyView[]> {
  const rows = await reviewQueue(client(deps));
  return rows.map((raw) => {
    const r = reviewQueueRow.parse(raw);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      domain: r.domain,
      website: r.website,
      websiteOnOtherDomain: !!r.website && !websiteMatches(r.website, r.domain),
      city: r.city,
      size: r.size,
      createdOn: r.created,
      members: r.members,
      admins: r.admins,
      noAdmin: r.admins === 0,
      status: r.status,
    };
  });
}

export const REVIEW_TEXT = {
  invalid: "That didn't work. Reload the page and try again.",
  not_found: "That company isn't on the list any more. Reload the page to see the latest.",
} as const;

/**
 * Verifies or suspends one company for the admin with this user id: the status, when, `admin:<user id>` as the
 * reviewer, and one audit line, in one transaction. The answer is words to announce on the page.
 */
export async function reviewCompany(adminUserId: string, input: unknown, deps: AdminDeps = {}): Promise<ReviewResult> {
  const parsed = companyReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: REVIEW_TEXT.invalid };
  const { orgId, decision } = parsed.data;
  const org = await setReviewStatus(client(deps), { id: orgId }, decision, `admin:${adminUserId}`);
  if (!org) return { ok: false, message: REVIEW_TEXT.not_found };
  logEvent("info", "company_reviewed", { decision });
  return { ok: true, message: decision === "verify" ? `${org.name} is verified.` : `${org.name} is suspended.` };
}
