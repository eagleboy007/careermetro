import type { JobSearchView } from "@/lib/schemas";
import { JobSearchProvider, JobSearchSwitch, type JobSearchAction } from "./job-search";
import { NoticeCard, type NoticeAction } from "./notice-card";

/**
 * Account settings > Pay (handoff 6, prototype v44 acc-item "Notice period"): "Looking for a job" and the private
 * notice period card, both saved at once, apart from the Save bar. "Change status" on Me opens here. Without actions
 * (example data) nothing is saved.
 */
export function SettingsJobSearch({ view, today, actions }: { view: JobSearchView; today: string; actions?: { jobSearch: JobSearchAction; notice: NoticeAction } }) {
  return (
    <JobSearchProvider initialOn={view.on} action={actions?.jobSearch}>
      <div className="flex flex-col gap-3">
        <span className="text-[0.82rem] font-semibold">Job search</span>
        <JobSearchSwitch hint="Off pauses Departures and Arrivals: no Express apply, and companies can't find you. Your rides and map keep going. Saved as soon as you switch it." />
        <NoticeCard initial={{ days: view.noticeDays, resignedOn: view.resignedOn }} today={today} action={actions?.notice} />
        <small className="text-[0.78rem] text-muted">Companies see only &quot;Can join&quot; when you apply, never your notice period or the countdown.</small>
      </div>
    </JobSearchProvider>
  );
}
