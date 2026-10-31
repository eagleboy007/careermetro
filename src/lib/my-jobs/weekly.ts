import { EMAIL_TOKENS, escapeHtml } from "@/lib/email/look";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { MY_JOB_STATUS_LABELS } from "@/lib/schemas/constants";
import { prepareHref, type MyJobStatus } from "./rules";
import { interviewWhen, shortDay } from "./view";

/*
 * The weekly My jobs email (C22, handoff 12m, docs/plans/application-tracker-plan.md section 6), in plain code: data
 * in, the week's sections and the email's text and HTML out. Company and title only: never the job text, the person's
 * notes or links to the posting. No numbers about anyone's chances. An empty week gives no email.
 */

/** One job of the person's My jobs as the weekly email reads it. `open` and `only` are skill names. */
export type WeeklyJob = {
  ref: { kind: "post"; postId: string } | { kind: "check"; checkId: string };
  company: string;
  title: string;
  status: MyJobStatus;
  /** When the status last changed. */
  statusAt: Date;
  appliedAt: Date | null;
  interviewAt: Date | null;
  /** Still-open goals this job asks for, and skills only this job asks for. */
  open: string[];
  only: string[];
};

export type WeeklyView = {
  /** The India week's Monday, YYYY-MM-DD. */
  week: string;
  waiting: { company: string; title: string; line: string; href: string }[];
  interviews: { company: string; title: string; when: string; href: string; link: "Mock interview" | "Practise" }[];
  skills: string[];
  /** Which jobs ask for the skills, or "" when there are none. */
  skillsLine: string;
};

export const WEEKLY_WAITING_DAYS = 7;
export const WEEKLY_WAITING_MAX = 10;
export const WEEKLY_INTERVIEWS_MAX = 7;
export const WEEKLY_SKILLS = 3;
export const WEEKLY_PREHEADER = "And three skills worth an hour this week.";
export const WEEKLY_NO_CHANCES = "Nothing here about your chances: that is for you and the company.";

const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3600_000;
const indiaMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS);
const daysBetween = (from: Date, to: Date) => Math.floor((Date.parse(indiaDay(to)) - Date.parse(indiaDay(from))) / DAY_MS);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "SOC Analyst at Zephyr Pay, and Data Analyst at Acme" for up to two jobs, then "and N more". */
function jobsLine(jobs: { title: string; company: string }[]): string {
  const named = jobs.slice(0, 2).map((j) => `${j.title} at ${j.company}`);
  const more = jobs.length - named.length;
  if (more > 0) return `${named.join(", ")} and ${plural(more, "more job")}`;
  return named.join(" and ");
}

/**
 * The week's sections, or null when nothing is moving (no job waiting on a reply and no interview this week).
 * - Waiting on a reply: Applied or Heard back with no status change for 7 India days or more, oldest first.
 * - Interview this week: at Interview or Offer, from now until Sunday 23:59 IST, soonest first.
 * - Three skills: the still-open skills those jobs ask for, most-asked first then by name, with one skill only one of
 *   them asks for as the last of the three when there is one.
 */
export function weeklyView(jobs: WeeklyJob[], now: Date, options: { elite: boolean } = { elite: false }): WeeklyView | null {
  const week = mondayOf(indiaDay(now));
  const weekEnd = new Date(indiaMidnight(week).getTime() + 7 * DAY_MS);
  const waitingJobs = jobs
    .filter((j) => (j.status === "applied" || j.status === "heard") && daysBetween(j.statusAt, now) >= WEEKLY_WAITING_DAYS)
    .sort((a, b) => a.statusAt.getTime() - b.statusAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, WEEKLY_WAITING_MAX);
  const interviewJobs = jobs
    .filter((j) => (j.status === "interview" || j.status === "offer") && j.interviewAt && j.interviewAt >= now && j.interviewAt < weekEnd)
    .sort((a, b) => a.interviewAt!.getTime() - b.interviewAt!.getTime() || a.title.localeCompare(b.title))
    .slice(0, WEEKLY_INTERVIEWS_MAX);
  if (!waitingJobs.length && !interviewJobs.length) return null;

  const waiting = waitingJobs.map((j) => {
    const since = j.status === "applied" ? (j.appliedAt ?? j.statusAt) : j.statusAt;
    const days = daysBetween(j.status === "applied" ? since : j.statusAt, now);
    const word = j.status === "applied" ? "no word yet" : "nothing since";
    return { company: j.company, title: j.title, line: `${MY_JOB_STATUS_LABELS[j.status]} ${shortDay(since.toISOString())} · ${plural(days, "day")}, ${word}`, href: "/departures?tab=mine" };
  });
  const interviews = interviewJobs.map((j) => ({
    company: j.company,
    title: j.title,
    when: `${interviewWhen(j.interviewAt!.toISOString())} IST`,
    href: prepareHref(j.ref, options.elite ? "mock" : "practice"),
    link: options.elite ? ("Mock interview" as const) : ("Practise" as const),
  }));

  const listed = [...interviewJobs, ...waitingJobs];
  const count = (pick: (j: WeeklyJob) => string[]) => {
    const seen = new Map<string, Set<WeeklyJob>>();
    for (const j of listed) for (const name of new Set(pick(j))) seen.set(name, (seen.get(name) ?? new Set<WeeklyJob>()).add(j));
    return [...seen.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  };
  const open = count((j) => j.open);
  const only = count((j) => j.only).filter(([name]) => !open.some(([o]) => o === name));
  const picked = [...open.slice(0, only.length ? WEEKLY_SKILLS - 1 : WEEKLY_SKILLS), ...only.slice(0, 1)];
  // Fewer open skills than two: the rest from the skills only one job asks for.
  for (const extra of only.slice(1)) if (picked.length < WEEKLY_SKILLS) picked.push(extra);
  const skills = picked.slice(0, WEEKLY_SKILLS).map(([name]) => name);
  const askers = listed.filter((j) => picked.some(([, by]) => by.has(j)));
  const skillsLine = skills.length ? `${jobsLine(askers)} ${askers.length === 1 ? "asks" : "ask"} for ${skills.length === 1 ? "it" : "them"}.` : "";
  return { week, waiting, interviews, skills, skillsLine };
}

/** "2 jobs waiting on a reply, 1 interview Thursday": the parts that apply. */
export function weeklySubject(view: WeeklyView): string {
  const parts: string[] = [];
  if (view.waiting.length) parts.push(`${plural(view.waiting.length, "job")} waiting on a reply`);
  if (view.interviews.length) {
    const days = new Set(view.interviews.map((i) => i.when.split(" ")[0]));
    const day = days.size === 1 ? new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Asia/Kolkata" }).format(dayOf(view, [...days][0]!)) : "this week";
    parts.push(`${plural(view.interviews.length, "interview")} ${day}`);
  }
  return parts.join(", ");
}

/** A date on the view's week for a short weekday name ("Thu"), for its long name. */
function dayOf(view: WeeklyView, short: string): Date {
  const monday = indiaMidnight(view.week).getTime();
  for (let i = 0; i < 7; i++) {
    const at = new Date(monday + i * DAY_MS + 12 * 3600_000);
    if (new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" }).format(at) === short) return at;
  }
  return new Date(monday);
}

export type WeeklyEmail = { subject: string; preheader: string; text: string; html: string };

const escape = escapeHtml;
/** Light-mode token values (src/lib/email/look.ts), inline: email clients ignore CSS variables. */
const T = EMAIL_TOKENS;

/**
 * The email for a week's view: plain text and HTML with the same words. `site` is the app's address; `offUrl` turns
 * the email off with one tap and needs no sign-in. `name` is the person's first name, when we have one.
 */
export function weeklyEmail(view: WeeklyView, { name, site, offUrl }: { name: string | null; site: string; offUrl: string }): WeeklyEmail {
  const subject = weeklySubject(view);
  const hello = name ? `${name}, your week on My jobs.` : "Your week on My jobs.";
  const abs = (href: string) => `${site}${href}`;
  const why = "You get this because you turned on the weekly My jobs email in Settings. Sent only on weeks when something is moving.";

  const text = [
    hello,
    ...(view.waiting.length
      ? ["", "WAITING ON A REPLY", ...view.waiting.flatMap((w) => [`${w.title}, ${w.company}`, `  ${w.line}`, `  Update status: ${abs(w.href)}`])]
      : []),
    ...(view.interviews.length
      ? ["", "INTERVIEW THIS WEEK", ...view.interviews.flatMap((i) => [`${i.title}, ${i.company}`, `  ${i.when}`, `  ${i.link}: ${abs(i.href)}`])]
      : []),
    ...(view.skills.length ? ["", `PRACTISE ${view.skills.length === 1 ? "THIS SKILL" : `THESE ${view.skills.length} SKILLS`}`, view.skills.join(" · "), view.skillsLine] : []),
    "",
    WEEKLY_NO_CHANCES,
    "",
    "--",
    why,
    `Turn it off (no sign-in): ${offUrl}`,
  ].join("\n");

  const p = (s: string, style = "") => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${T.ink};${style}">${s}</p>`;
  const h = (s: string) => `<h2 style="margin:20px 0 8px;font-family:monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted}">${escape(s)}</h2>`;
  const a = (href: string, label: string) => `<a href="${escape(href)}" style="color:${T.ink};font-weight:600">${escape(label)}</a>`;
  const card = (title: string, company: string, line: string, link: string) =>
    `<div style="margin:0 0 8px;padding:12px 14px;border:1px solid ${T.line};border-radius:12px;background:${T.surface}">` +
    p(`<b>${escape(title)}</b> · ${escape(company)}`, "margin:0 0 4px") +
    p(escape(line), `margin:0 0 6px;color:${T.muted}`) +
    p(link, "margin:0") +
    `</div>`;
  const chip = (s: string) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:999px;background:${T.surface2};font-size:13px;color:${T.ink}">${escape(s)}</span>`;
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:${T.bg}">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escape(WEEKLY_PREHEADER)}</div>` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:${T.ink}">` +
    `<p style="margin:0 0 4px;font-family:monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted}">CareerMetro · My jobs</p>` +
    `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:${T.ink}">${escape(hello)}</h1>` +
    (view.waiting.length ? h("Waiting on a reply") + view.waiting.map((w) => card(w.title, w.company, w.line, a(abs(w.href), "Update status"))).join("") : "") +
    (view.interviews.length ? h("Interview this week") + view.interviews.map((i) => card(i.title, i.company, i.when, a(abs(i.href), i.link))).join("") : "") +
    (view.skills.length
      ? h(`Practise ${view.skills.length === 1 ? "this skill" : `these ${view.skills.length} skills`}`) + `<div>${view.skills.map(chip).join("")}</div>` + p(escape(view.skillsLine), `color:${T.muted}`)
      : "") +
    p(escape(WEEKLY_NO_CHANCES), `margin-top:16px;color:${T.muted}`) +
    `<hr style="border:0;border-top:1px solid ${T.line};margin:20px 0 12px">` +
    p(escape(why), `font-size:12px;color:${T.muted}`) +
    p(a(offUrl, "Turn it off"), "font-size:12px") +
    `</div></body></html>`;
  return { subject, preheader: WEEKLY_PREHEADER, text, html };
}
