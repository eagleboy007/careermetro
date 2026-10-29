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

/** The status after the edit sheet sets an interview: an earlier one moves to Interview; Offer and closed ones stay (handoff 12m). */
export const withInterview = (status: MyJobStatus, interviewAt: string | null): MyJobStatus =>
  interviewAt && !isClosed(status) && (stageOf(status) ?? 0) < (stageOf("interview") ?? 0) ? "interview" : status;

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

/** What a phone shared to CareerMetro (C21): the description to check and the job's link, either may be empty. */
export type SharedJob = { text: string; url: string };

/** An https link as the share sheet sent it, or "" for anything else (http, other schemes, too long). */
function httpsLink(raw: string, max: number): string {
  const text = raw.trim();
  if (!text || text.length > max) return "";
  try {
    return new URL(text).protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

/**
 * The fields of a share (manifest share_target: title, text, url) as "Add a job you found" takes them. Many apps send
 * the link inside the text ("See this job: https://…"), so with no url the first https link in the text becomes the
 * link and leaves the text. The title leads the text only when there is a description with it. Control characters go,
 * line breaks stay, and anything over the caps is cut, never refused: the person checks the box before saving.
 */
export function sharedJobOf(fields: { title?: string; text?: string; url?: string }, caps: { text: number; url: number }): SharedJob {
  const clean = (s: string | undefined) => (s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim();
  let text = clean(fields.text);
  let url = httpsLink(clean(fields.url), caps.url);
  if (!url) {
    const raw = text.match(/https:\/\/[^\s<>"']+/)?.[0];
    const found = raw?.replace(/[).,;:!?\]]+$/, "");
    if (raw && found && httpsLink(found, caps.url)) {
      url = found;
      // The link goes with the bracket and punctuation around it: "Look (https://…)." reads "Look".
      const at = text.indexOf(raw);
      const from = at > 0 && "([".includes(text[at - 1]!) ? at - 1 : at;
      text = `${text.slice(0, from)} ${text.slice(at + raw.length)}`.replace(/[ \t]+/g, " ").trim();
    }
  }
  const title = clean(fields.title).replace(/\s+/g, " ");
  if (text && title && !text.toLowerCase().includes(title.toLowerCase())) text = `${title}\n\n${text}`;
  return { text: text.slice(0, caps.text).trim(), url };
}
