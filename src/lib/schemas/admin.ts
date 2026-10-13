import { z } from "zod";
import { ORG_REVIEW_STATUSES, ORG_TYPES, REVIEW_DECISIONS } from "./constants";

/*
 * The company review page, /admin/companies (dev/corporate-plan.md, call B). What a review action takes from the
 * browser, and the shape of a row read for the list. A row has company fields and counts only: never anyone's email
 * address or phone.
 */

export { REVIEW_DECISIONS };

/** One review: which company (by id, never a domain typed in the browser) and what to do. */
export const companyReviewInput = z.object({ orgId: z.uuid(), decision: z.enum(REVIEW_DECISIONS) }).strict();
export type CompanyReviewInput = z.infer<typeof companyReviewInput>;

/** A row of the review list as src/lib/corporate/review-queue.mjs reads it. */
export const reviewQueueRow = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(ORG_TYPES),
    domain: z.string().min(1),
    website: z.string().nullable(),
    city: z.string().nullable(),
    size: z.string().nullable(),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(ORG_REVIEW_STATUSES),
    members: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
  })
  .strip();
