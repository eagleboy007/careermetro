import { Route, Target, BriefcaseBusiness } from "lucide-react";
import type { ReactNode } from "react";

/** Signed up, no resume yet: the line starts with the resume. `upload` is the upload form for the page it sits on. */
export function NoResumeHero({ name, upload }: { name: string; upload: ReactNode }) {
  return (
    <section aria-label="Add your resume" className="grid gap-7 overflow-hidden rounded-[24px] border border-line bg-surface px-4 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-7 md:py-6">
      <div className="flex min-w-0 flex-col gap-4">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Signed up · one step left</span>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05]">
          Hi {name}. Your line starts with <span className="text-accent">your resume.</span>
        </h2>
        <p className="max-w-[54ch] text-[0.95rem] text-muted">
          Upload it and in under a minute you see which skills you already have for the role, which are missing, and a goal for each
          gap.
        </p>
        {upload}
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
        <h3 className="text-base font-semibold">What you get</h3>
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
