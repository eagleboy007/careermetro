import { z } from "zod";
import { FIND_BANDS, FIND_CITIES_MAX, FIND_PAGES_MAX, FIND_ROLES_MAX, PERSON_CITIES } from "./constants";
import { messageBody } from "./inbox";

/*
 * Let companies find me (pending item 19, dev/companies-find-me-plan.md). A verified company searches from one of its
 * own open jobs, optionally narrowed by experience bands, target roles, cities and verified profiles (T44), any of them
 * together; nothing typed by the company is a search term, so nothing personal can get into a search, a log, an audit
 * line or an address. People in results are named by an opaque per-company ref, never by their internal id.
 */

export { FIND_BAND_LABELS, FIND_BANDS, FIND_CITIES_MAX, FIND_PAGE_SIZE, FIND_PAGES_MAX, FIND_ROLES_MAX } from "./constants";

export const findBand = z.enum(FIND_BANDS);
export type FindBand = z.infer<typeof findBand>;

/** A role profile's slug: the target role a company may filter by (T44). Unknown slugs simply match no one. */
export const findRoleSlug = z.string().regex(/^[a-z0-9-]{1,80}$/);

/** A city a company may filter by: one of the cities people pick from (T44). */
export const findCity = z.enum(PERSON_CITIES);

/** Each choice once, in the order given. */
const distinct = <T>(xs: T[]) => [...new Set(xs)];

/**
 * A search (T44): one of the company's open jobs and a page, narrowed by any of: experience bands, target roles and
 * cities (one or several of each) and verified profiles only. An empty list means any.
 */
export const findSearchInput = z.object({
  jobId: z.uuid(),
  bands: z.array(findBand).max(FIND_BANDS.length).default([]).transform((xs) => distinct(xs)),
  roles: z.array(findRoleSlug).max(FIND_ROLES_MAX).default([]).transform((xs) => distinct(xs)),
  cities: z.array(findCity).max(FIND_CITIES_MAX).default([]).transform((xs) => distinct(xs)),
  verified: z.boolean().default(false),
  page: z.number().int().min(1).max(FIND_PAGES_MAX).default(1),
});
export type FindSearchInput = z.input<typeof findSearchInput>;
export type FindSearch = z.output<typeof findSearchInput>;

/**
 * The same search read from an address (`/corporate/people?job=…&band=…&role=…&city=…&verified=1&page=…`, band, role
 * and city repeatable): anything unknown or malformed is dropped rather than refused, so an old or edited link still opens the
 * page.
 */
export function findSearchFromParams(params: Record<string, string | string[] | undefined>): { jobId: string | null } & Omit<FindSearch, "jobId"> {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const many = (v: string | string[] | undefined) => (v === undefined ? [] : typeof v === "string" ? [v] : v);
  const job = z.uuid().safeParse(one(params.job));
  const bands = distinct(many(params.band).flatMap((b) => (findBand.safeParse(b).success ? [b as FindBand] : [])));
  const roles = distinct(many(params.role).filter((r) => findRoleSlug.safeParse(r).success)).slice(0, FIND_ROLES_MAX);
  const cities = distinct(many(params.city).flatMap((c) => {
    const ok = findCity.safeParse(c);
    return ok.success ? [ok.data] : [];
  })).slice(0, FIND_CITIES_MAX);
  const page = z.coerce.number().int().min(1).max(FIND_PAGES_MAX).safeParse(one(params.page));
  return { jobId: job.success ? job.data : null, bands, roles, cities, verified: one(params.verified) === "1", page: page.success ? page.data : 1 };
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
