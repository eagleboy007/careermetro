import type { FindSearch, MeProfile } from "@/lib/schemas";
import type { JobMatchView, OrgReviewStatus, OrgRole } from "./types";

/*
 * What the screens of "Let companies find me" show (pending item 19, dev/companies-find-me-plan.md). Every person is
 * named by an opaque per-company ref; nothing here holds an internal user id, an email, a phone, pay, notice period or
 * a resume line.
 */

/** Whether the company has written to this person, and how that stands. A deleted request still reads as waiting. */
export type FoundRequestState = { state: "none" } | { state: "waiting" | "open"; conversationId: string } | { state: "closed" };

/** One person in a company's results. */
export type FindPersonCard = {
  ref: string;
  name: string;
  headline: string | null;
  /** "3 years 2 months" when experience shows on their profile, else null. */
  experience: string | null;
  /** The role they aim at (T44): companies see it for everyone who lets them find them. Never their gaps. */
  aim: string | null;
  /** At least one skill proved by CareerMetro proof (an exam, a verified certificate or corroborated work). */
  verified: boolean;
  match: JobMatchView;
  request: FoundRequestState;
};

/** An open job the person may search from. */
export type FindJobOption = { id: string; title: string; city: string };

/** A target role a company may filter by (T44). */
export type FindRoleOption = { slug: string; title: string };

/** Why the page offers no search: an Interviewer, a company not verified now, or refs off (no key in production). */
export type FindPageRefusal = "interviewer" | "not_verified" | "unavailable";

/** A message request the company sent to someone it found, and how it stands. */
export type SentRequestView = {
  conversationId: string;
  name: string;
  job: string | null;
  state: "waiting" | "open" | "closed";
  sentOn: string;
};

/** One page of a search's results. */
export type FindPeopleResults = { cards: FindPersonCard[]; total: number; hasMore: boolean };

/** Corporate > Find people. */
export type FindPeopleView = {
  company: string;
  status: OrgReviewStatus;
  role: OrgRole;
  refusal: FindPageRefusal | null;
  jobs: FindJobOption[];
  roles: FindRoleOption[];
  search: FindSearch | null;
  results: FindPeopleResults | null;
  /** Words to show when the search asked for in the address was refused. */
  error: string | null;
  sent: SentRequestView[];
};

/** One person opened from a search: the public profile parts they switched on (never gaps) and Match to this job. */
export type FoundPersonView = {
  ref: string;
  jobId: string;
  job: string;
  profile: MeProfile;
  match: JobMatchView;
  request: FoundRequestState;
};

export type FindActions = {
  /** Runs one search (a server action, never on page load): one page of people matched to the job. */
  search: (search: FindSearch) => Promise<{ ok: true; results: FindPeopleResults } | { ok: false; error: string }>;
  open: (jobId: string, ref: string) => Promise<{ ok: true; person: FoundPersonView } | { ok: false; error: string }>;
  /** Sends the one message of a request. Returns the words to show on failure, or null. */
  request: (jobId: string, ref: string, body: string) => Promise<string | null>;
};

/* The person's side ------------------------------------------------------------------------------------------------- */

/** A company that opened the person's profile from a search in the last 30 days: never who at the company. */
export type CompanyViewLine = { orgId: string; company: string; times: number; lastOn: string; blocked: boolean };

/** A company the person blocked. */
export type BlockedCompanyLine = { orgId: string; company: string; since: string };

export type DiscoveryView = { views: CompanyViewLine[]; blocked: BlockedCompanyLine[] };

export type DiscoveryActions = {
  block: (orgId: string) => Promise<string | null>;
  unblock: (orgId: string) => Promise<string | null>;
};
