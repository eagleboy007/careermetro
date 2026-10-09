import { Briefcase, Route, Target } from "lucide-react";
import { UploadForm } from "@/components/resume/upload-form";

const GET = [
  { Icon: Target, title: "Gaps with evidence", text: "Each gap quotes the line in your resume it came from." },
  { Icon: Route, title: "A goal for each gap", text: "Free courses get you ready; proof fills the gap." },
  { Icon: Briefcase, title: "Roles you are getting closer to", text: "From public job boards and posts you paste." },
];

/**
 * No resume yet (handoff 4): one step left. Uses the same upload as /start; the target role is picked after the
 * resume is read, as in the live Resume and Gaps flow. `demo` never uploads, for /design.
 */
export function NoResumeHero({ firstName, demo = false }: { firstName: string; demo?: boolean }) {
  return (
    <section
      aria-label="Add your resume"
      className="grid min-w-0 gap-7 rounded-[24px] border border-line bg-surface px-5 pb-6 pt-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex min-w-0 flex-col gap-[18px]">
        <span className="font-mono text-[0.72rem] uppercase tracking-wider text-muted">Signed up · one step left</span>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          Hi {firstName}. Your line starts with <em className="not-italic text-accent">your resume.</em>
        </h2>
        <p className="max-w-[52ch] text-[0.95rem] text-muted">
          Upload it and in under a minute you see which skills you already have for the role, which are missing, and a goal for each
          gap, with pitstops to fill it.
        </p>
        <UploadForm demo={demo} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 border-line lg:border-l lg:pl-7">
        <h3 className="text-[1.05rem] font-semibold">What you get</h3>
        <ul className="flex flex-col gap-3.5">
          {GET.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3 text-[0.88rem]">
              <Icon size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
              <span>
                <b className="block font-medium">{title}</b>
                <small className="text-[0.8rem] text-muted">{text}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
