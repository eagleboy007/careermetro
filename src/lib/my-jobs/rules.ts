import { MY_JOB_STATUSES, type MY_JOB_FILTERS } from "@/lib/schemas/constants";

/*
 * My jobs (handoff 12m, docs/plans/application-tracker-plan.md) in plain code: statuses and their stages, the list's
 * filters, and which links are company job boards. No Zod and no server code, so the screen can use it too.
 */

export type MyJobStatus = (typeof MY_JOB_STATUSES)[number];
export type MyJobFilter = (typeof MY_JOB_FILTERS)[number];

/** job_saves.stage for a status: none for Saved, then 1 Applied to 6 Withdrawn. */
export function stageOf(status: MyJobStatus): number | null {
  const i = MY_JOB_STATUSES.indexOf(status);
  return i > 0 ? i : null;
}

/** The status a job_saves row stands at: Saved without a stage. */
export function statusOf(stage: number | null): MyJobStatus {
  return (stage && MY_JOB_STATUSES[stage]) || "saved";
}

/** Not this time and Withdrawn: the job has ended, and it sits under Closed. */
export const isClosed = (status: MyJobStatus): boolean => status === "no" || status === "withdrawn";

/** Applied to Offer: the application is moving. */
export const isMoving = (status: MyJobStatus): boolean => status === "applied" || status === "heard" || status === "interview" || status === "offer";

/** Whether a job shows under one of the list's filter chips. */
export function inFilter(status: MyJobStatus, filter: MyJobFilter): boolean {
  if (filter === "all") return true;
  if (filter === "saved") return status === "saved";
  if (filter === "applied") return status === "applied" || status === "heard";
  if (filter === "interview") return status === "interview" || status === "offer";
  return isClosed(status);
}

/** What the list says when a filter shows nothing (prototype v48). */
export function myJobsEmpty(filter: MyJobFilter, label: string): { heading: string; text: string } {
  if (filter === "all")
    return {
      heading: "Add the jobs you're already applying to.",
      text: "Found on any site? Paste the description below and it lives here with its status, dates and a private note.",
    };
  if (filter === "closed") return { heading: "Nothing closed.", text: "When a job ends, mark it Not this time or Withdrawn. It stays here, out of the way." };
  return { heading: "Nothing here yet.", text: `Move a job's status from its chip and it shows up under ${label}.` };
}

/** The company job boards whose single postings we read through their public APIs (docs/plans/application-tracker-plan.md). */
export type BoardAts = "greenhouse" | "lever" | "ashby" | "smartrecruiters";
/** One posting on a company job board: the board's ATS, its token and the posting's id, read from the link's path. */
export type BoardLink = { ats: BoardAts; token: string; id: string };

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,20}$/;

/**
 * The posting a link points to, when it is on one of the four company job boards, or null. Hosts are matched exactly
 * and only https links without a port or a user count. Any other link is only kept and shown, never fetched.
 */
export function boardLinkOf(raw: string): BoardLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [token, second, third] = parts;
  if (!token || !TOKEN.test(token)) return null;
  const host = url.hostname.toLowerCase();
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io")
    return second === "jobs" && third && NUMBER.test(third) ? { ats: "greenhouse", token, id: third } : null;
  if (host === "jobs.lever.co") return second && UUID.test(second) ? { ats: "lever", token, id: second.toLowerCase() } : null;
  if (host === "jobs.ashbyhq.com") return second && UUID.test(second) ? { ats: "ashby", token, id: second.toLowerCase() } : null;
  if (host === "jobs.smartrecruiters.com") {
    const id = second?.match(/^(\d{1,20})(?:-|$)/)?.[1];
    return id ? { ats: "smartrecruiters", token, id } : null;
  }
  return null;
}

/** What the link under "Add a job you found" is: none, a company job board's posting, any other https link, or not a link. */
export function linkKind(raw: string): "none" | "board" | "other" | "invalid" {
  const text = raw.trim();
  if (!text) return "none";
  if (boardLinkOf(text)) return "board";
  try {
    return new URL(text).protocol === "https:" ? "other" : "invalid";
  } catch {
    return "invalid";
  }
}

/** The hint under the link field, which changes with the link (prototype v48). */
export const LINK_HINTS = {
  none: "Paste the description too: we only read links from company job boards.",
  board: "A company job board. We read the posting from there: nothing to paste.",
  other: "We keep this link to open the original. Paste the description too: we only read links from company job boards.",
  invalid: "Use the job's https link, as it shows in your browser.",
} as const;

type Ref = { kind: "post"; postId: string } | { kind: "check"; checkId: string };

/** A job in an address ("Prepare for this job"): `post:<id>` or `check:<id>`, as the row's key. */
export const refParam = (ref: Ref): string => (ref.kind === "post" ? `post:${ref.postId}` : `check:${ref.checkId}`);

/** The job an address names, or null for anything else. */
export function refFromParam(raw: unknown): Ref | null {
  if (typeof raw !== "string") return null;
  const [kind, id, ...rest] = raw.split(":");
  if (rest.length || !id || !UUID.test(id)) return null;
  if (kind === "post") return { kind, postId: id.toLowerCase() };
  if (kind === "check") return { kind, checkId: id.toLowerCase() };
  return null;
}

/** Where "Prepare for this job" goes: Practice on its skills, or the mock interview set up for it. */
export const prepareHref = (ref: Ref, to: "practice" | "mock"): string =>
  to === "practice" ? `/practice?job=${encodeURIComponent(refParam(ref))}` : `/mock?tab=interview&job=${encodeURIComponent(refParam(ref))}`;
