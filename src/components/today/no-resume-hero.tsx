import { ArrowRight, BriefcaseBusiness, Map as MapIcon, MessagesSquare, Route, Target, User } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Signed up, no resume yet: the line starts with the resume. `upload` is the upload form for the page it sits on. */
/** Before the resume: what is open without one. The linked screens come in later build steps. */
export function WhileYouDecide() {
  const items = [
    { Icon: MessagesSquare, title: "Read Junction", detail: "Questions and wins from people on the same roles." },
    { Icon: MapIcon, title: "Explore role lines", detail: "See the goals other roles take, before you pick yours." },
    { Icon: User, title: "Set up your profile", detail: "Status and interests now; skills fill in from your resume." },
  ];
  return (
    <section
      aria-label="While you decide"
      className="flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5"
    >
      <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">While you decide</h3>
      <p className="text-[0.9rem] text-muted">Everything except your own line works without a resume.</p>
      <ul className="flex flex-col gap-3 text-[0.86rem]">
        {items.map(({ Icon, title, detail }) => (
          <li key={title} className="flex items-start gap-2.5">
            <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              <b className="block font-semibold">
                {title} <span className="font-mono text-[0.62rem] font-normal uppercase text-muted">· soon</span>
              </b>
              <small className="text-[0.8rem] text-muted">{detail}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NoResumeHero({ name, upload, unfinishedHref }: { name: string; upload: ReactNode; unfinishedHref?: string | null }) {
  return (
    <section aria-label="Add your resume" className="grid gap-7 overflow-hidden rounded-[24px] border border-line bg-surface px-4 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-7 md:py-6">
      <div className="flex min-w-0 flex-col gap-4">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Signed up · one step left</span>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          Hi {name}. Your line starts with <em className="not-italic text-accent">your resume.</em>
        </h2>
        <p className="max-w-[54ch] text-[0.95rem] text-muted">
          Upload it and in under a minute you see which skills you already have for the role, which are missing, and a goal for each
          gap.
        </p>
        {unfinishedHref && (
          <Link href={unfinishedHref} className="inline-flex items-center gap-1 text-[0.9rem] font-semibold underline-offset-2 hover:underline">
            You already uploaded one. Finish checking it
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
        {upload}
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
        <h3 className="text-base font-semibold">Help in your journey to reach your destination</h3>
        <ul className="flex flex-col gap-3 text-[0.86rem]">
          <Get Icon={Target} title="Gaps with evidence" detail="Each gap quotes the line in your resume it came from." />
          <Get Icon={Route} title="A goal for each gap" detail="Free courses get you ready; proof fills the gap." />
          <Get Icon={BriefcaseBusiness} title="Roles you are getting closer to" detail="From public job boards and posts you paste." />
        </ul>
      </div>
    </section>
  );
}

function Get({ Icon, title, detail }: { Icon: typeof Route; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <span>
        <b className="block font-semibold">{title}</b>
        <small className="text-[0.8rem] text-muted">{detail}</small>
      </span>
    </li>
  );
}
