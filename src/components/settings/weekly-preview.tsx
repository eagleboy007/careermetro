"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { WEEKLY_NO_CHANCES, WEEKLY_PREHEADER, weeklySubject, type WeeklyView } from "@/lib/my-jobs/weekly";

const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;
const mono = "font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted";

/**
 * "See this week's" under the Weekly My jobs email switch (handoff 12c with C22): the same builder the Monday email
 * uses, for the signed-in person, shown here and sending nothing. `view` null is an empty week, which sends no email.
 */
export function WeeklyPreview({ view, name }: { view: WeeklyView | null; name: string | null }) {
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <div className="flex flex-col gap-2 pb-2 pl-12">
      <button type="button" aria-expanded={open} aria-controls={open ? body : undefined} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 self-start text-[0.82rem] font-medium text-ink underline underline-offset-2">
        <Mail {...ICON} />
        {open ? "Hide this week's" : "See this week's"}
      </button>
      {open &&
        (view ? (
          <section id={body} aria-label="This week's email" className="flex flex-col gap-3 rounded-[14px] border border-line bg-bg p-3.5 text-[0.86rem]">
            <div>
              <p className={mono}>Subject</p>
              <p className="font-semibold">{weeklySubject(view)}</p>
              <p className="text-[0.8rem] text-muted">{WEEKLY_PREHEADER}</p>
            </div>
            <p className="font-semibold">{name ? `${name}, your week on My jobs.` : "Your week on My jobs."}</p>
            {view.waiting.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h4 className={mono}>Waiting on a reply</h4>
                {view.waiting.map((w, i) => (
                  <div key={i} className="rounded-[10px] border border-line bg-surface px-3 py-2">
                    <b className="font-semibold">{w.title}</b> · {w.company}
                    <small className="block text-[0.78rem] text-muted">{w.line}</small>
                    <Link href={w.href} className="text-[0.8rem] font-medium underline underline-offset-2">
                      Update status
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {view.interviews.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h4 className={mono}>Interview this week</h4>
                {view.interviews.map((v, i) => (
                  <div key={i} className="rounded-[10px] border border-line bg-surface px-3 py-2">
                    <b className="font-semibold">{v.title}</b> · {v.company}
                    <small className="block text-[0.78rem] text-muted">{v.when}</small>
                    <Link href={v.href} className="text-[0.8rem] font-medium underline underline-offset-2">
                      {v.link}
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {view.skills.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h4 className={mono}>{view.skills.length === 1 ? "Practise this skill" : `Practise these ${view.skills.length} skills`}</h4>
                <ul className="flex flex-wrap gap-1.5">
                  {view.skills.map((s) => (
                    <li key={s} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.8rem]">
                      {s}
                    </li>
                  ))}
                </ul>
                <small className="text-[0.78rem] text-muted">{view.skillsLine}</small>
              </div>
            )}
            <p className="text-[0.8rem] text-muted">{WEEKLY_NO_CHANCES}</p>
          </section>
        ) : (
          <p id={body} className="rounded-[14px] border border-line bg-bg p-3.5 text-[0.84rem] text-muted">
            Nothing is moving this week: no job waiting on a reply for a week and no interview. On a week like this no email is sent.
          </p>
        ))}
    </div>
  );
}
