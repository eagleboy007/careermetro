import "server-only";
import { z } from "zod";
import boardList from "@/content/job-boards.json";
import { MY_JOB_CITY_MAX, MY_JOB_DESCRIPTION_MAX } from "@/lib/schemas/constants";
import type { BoardLink } from "./rules";

/*
 * "Add a job you found" with a company job board's link (docs/plans/application-tracker-plan.md): the one posting the
 * person linked, read from its board's public posting API. One GET, no redirects followed, with a time limit and a
 * size cap, sending the feed's User-Agent. Only the title, company, place and description are kept; recruiter names
 * and contacts in the answer are never read. Any other link is never fetched. Nothing here logs the posting.
 */

/** The daily feed's User-Agent (src/lib/departures/feed-rules.mjs, which app code can't import); a test keeps them equal. */
export const USER_AGENT = "CareerMetroJobs/1.0 (+https://careermetro.vercel.app/terms#job-boards)";

export const BOARD_READ_LIMITS = {
  timeoutMs: 15_000,
  /** One posting is a few KB. Ashby has no single-posting API, so its whole board is read, which can be a few MB. */
  maxBytes: 1024 * 1024,
  ashbyMaxBytes: 5 * 1024 * 1024,
};

export type BoardPosting = { title: string; company: string | null; city: string | null; text: string };
export type BoardReadResult = { ok: true; posting: BoardPosting } | { ok: false; error: "not_found" | "unreadable" };

const t = encodeURIComponent;

/** The public API address for one posting. */
export function boardApiUrl(link: BoardLink): string {
  if (link.ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${t(link.token)}/jobs/${t(link.id)}`;
  if (link.ats === "lever") return `https://api.lever.co/v0/postings/${t(link.token)}/${t(link.id)}`;
  if (link.ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${t(link.token)}`;
  return `https://api.smartrecruiters.com/v1/companies/${t(link.token)}/postings/${t(link.id)}`;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** HTML (often escaped twice, as Greenhouse sends it) as plain text, one line per paragraph, list item or heading. */
export function htmlText(html: string | null | undefined): string {
  return decode(decode(html ?? ""))
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|header)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const plainLines = (s: string | null | undefined) =>
  (s ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/** The place a posting names, as a row shows it: its first place, or Remote. */
function cityOf(location: string | null | undefined, remote: boolean): string | null {
  if (remote) return "Remote";
  const first = (location ?? "").split(/[,;|/]/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  return first && first.length <= MY_JOB_CITY_MAX ? first : null;
}

const listed = new Map((boardList as { company: string; ats: string; token: string }[]).map((b) => [`${b.ats}:${b.token.toLowerCase()}`, b.company]));

/** The company our board list names for a board, when it is listed. */
export const listedCompany = (link: BoardLink): string | null => listed.get(`${link.ats}:${link.token.toLowerCase()}`) ?? null;

const text = z.string().nullish();
const greenhouse = z.object({ title: z.string(), content: text, company_name: text, location: z.object({ name: text }).nullish() });
const lever = z.object({
  text: z.string(),
  descriptionPlain: text,
  additionalPlain: text,
  lists: z.array(z.object({ text: text, content: text })).nullish(),
  categories: z.object({ location: text }).nullish(),
  workplaceType: text,
});
const ashbyJob = z.object({ id: z.string(), title: z.string(), location: text, isRemote: z.boolean().nullish(), descriptionHtml: text, descriptionPlain: text });
const ashby = z.object({ jobs: z.array(z.unknown()) });
const section = z.object({ title: text, text: text }).nullish();
const smartRecruiters = z.object({
  name: z.string(),
  company: z.object({ name: text }).nullish(),
  location: z.object({ city: text, remote: z.boolean().nullish() }).nullish(),
  jobAd: z
    .object({ sections: z.object({ companyDescription: section, jobDescription: section, qualifications: section, additionalInformation: section }).nullish() })
    .nullish(),
});

/** The posting in one board's answer, or null when it isn't there or doesn't read. */
export function postingOf(link: BoardLink, data: unknown): BoardPosting | null {
  const join = (title: string, ...parts: string[]) => [title, ...parts].filter(Boolean).join("\n\n").slice(0, MY_JOB_DESCRIPTION_MAX);
  if (link.ats === "greenhouse") {
    const j = greenhouse.safeParse(data);
    if (!j.success) return null;
    const title = htmlText(j.data.title);
    return { title, company: j.data.company_name?.trim() || null, city: cityOf(j.data.location?.name, /remote/i.test(j.data.location?.name ?? "")), text: join(title, htmlText(j.data.content)) };
  }
  if (link.ats === "lever") {
    const j = lever.safeParse(data);
    if (!j.success) return null;
    const title = htmlText(j.data.text);
    const lists = (j.data.lists ?? []).map((l) => [htmlText(l.text), htmlText(l.content)].filter(Boolean).join("\n"));
    const location = j.data.categories?.location;
    return {
      title,
      company: null,
      city: cityOf(location, /remote/i.test(`${location ?? ""} ${j.data.workplaceType ?? ""}`)),
      text: join(title, plainLines(j.data.descriptionPlain), ...lists, plainLines(j.data.additionalPlain)),
    };
  }
  if (link.ats === "ashby") {
    const board = ashby.safeParse(data);
    if (!board.success) return null;
    const found = board.data.jobs.map((x) => ashbyJob.safeParse(x)).find((x) => x.success && x.data.id.toLowerCase() === link.id);
    if (!found?.success) return null;
    const j = found.data;
    const title = htmlText(j.title);
    return { title, company: null, city: cityOf(j.location, Boolean(j.isRemote)), text: join(title, j.descriptionHtml ? htmlText(j.descriptionHtml) : plainLines(j.descriptionPlain)) };
  }
  const j = smartRecruiters.safeParse(data);
  if (!j.success) return null;
  const s = j.data.jobAd?.sections;
  const title = htmlText(j.data.name);
  const parts = [s?.jobDescription, s?.qualifications, s?.additionalInformation].map((p) => [htmlText(p?.title), htmlText(p?.text)].filter(Boolean).join("\n"));
  return {
    title,
    company: j.data.company?.name?.trim() || null,
    city: cityOf(j.data.location?.city, Boolean(j.data.location?.remote)),
    text: join(title, ...parts),
  };
}

/**
 * Reads the one posting a company job board's link points to. Fails with a short code only, never with text from the
 * answer: "not_found" when the board says there is no such posting, "unreadable" for anything else.
 */
export async function readBoardPosting(
  link: BoardLink,
  { fetchImpl = fetch, timeoutMs = BOARD_READ_LIMITS.timeoutMs }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BoardReadResult> {
  const maxBytes = link.ats === "ashby" ? BOARD_READ_LIMITS.ashbyMaxBytes : BOARD_READ_LIMITS.maxBytes;
  try {
    const res = await fetchImpl(boardApiUrl(link), {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok || !res.body || Number(res.headers.get("content-length") ?? 0) > maxBytes) {
      await res.body?.cancel();
      return { ok: false, error: res.status === 404 ? "not_found" : "unreadable" };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "unreadable" };
      }
      chunks.push(value);
    }
    const posting = postingOf(link, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!posting) return { ok: false, error: link.ats === "ashby" ? "not_found" : "unreadable" };
    return posting.title ? { ok: true, posting } : { ok: false, error: "unreadable" };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
