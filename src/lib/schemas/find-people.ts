import { z } from "zod";
import { FIND_BANDS, FIND_PAGES_MAX } from "./constants";
import { messageBody } from "./inbox";

/*
 * Let companies find me (pending item 19, dev/companies-find-me-plan.md). A verified company searches from one of its
 * own open jobs, optionally by experience band; nothing typed by the company is a search term, so nothing personal can
 * get into a search, a log, an audit line or an address. People in results are named by an opaque per-company ref,
 * never by their internal id.
 */

export { FIND_BAND_LABELS, FIND_BANDS, FIND_PAGE_SIZE, FIND_PAGES_MAX } from "./constants";

export const findBand = z.enum(FIND_BANDS);
export type FindBand = z.infer<typeof findBand>;

/** A search: one of the company's open jobs, an optional experience band and a page. */
export const findSearchInput = z.object({
  jobId: z.uuid(),
  band: findBand.nullable().default(null),
  page: z.number().int().min(1).max(FIND_PAGES_MAX).default(1),
});
export type FindSearchInput = z.input<typeof findSearchInput>;

/**
 * The same search read from an address (`/corporate/people?job=…&band=…&page=…`): anything unknown or malformed is
 * dropped rather than refused, so an old or edited link still opens the page.
 */
export function findSearchFromParams(params: Record<string, string | string[] | undefined>): { jobId: string | null; band: FindBand | null; page: number } {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const job = z.uuid().safeParse(one(params.job));
  const band = findBand.safeParse(one(params.band));
  const page = z.coerce.number().int().min(1).max(FIND_PAGES_MAX).safeParse(one(params.page));
  return { jobId: job.success ? job.data : null, band: band.success ? band.data : null, page: page.success ? page.data : 1 };
}

/** base64url of 12 bytes of IV, a 16-byte tag and a 16-byte user id: 44 bytes, 59 characters. */
export const FIND_REF_LENGTH = 59;
export const findRef = z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${FIND_REF_LENGTH}}$`));

/** Opening one person found from a job. */
export const findOpenInput = z.object({ jobId: z.uuid(), ref: findRef });
export type FindOpenInput = z.input<typeof findOpenInput>;

/** A message request to one person found from a job: one message, then nothing until they accept. */
export const findRequestInput = z.object({ jobId: z.uuid(), ref: findRef, body: messageBody });
export type FindRequestInput = z.input<typeof findRequestInput>;

/** A company's message in a found chat the person accepted. */
export const foundMessageInput = z.object({ conversationId: z.uuid(), body: messageBody });
export type FoundMessageInput = z.input<typeof foundMessageInput>;

/** The person blocking or unblocking a company from Settings. */
export const companyBlockInput = z.object({ orgId: z.uuid() });
