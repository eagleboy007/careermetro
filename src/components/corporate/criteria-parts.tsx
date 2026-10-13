import { BadgeCheck, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { criteriaSummary } from "@/lib/corporate/match-words";
import type { CriteriaView, JobCriteriaNames } from "@/lib/corporate/types";
import { CRITERIA_WARN_TEXT, CRITERIA_WORDS } from "@/lib/schemas/constants";
import { ICON } from "./parts";

/*
 * Express apply criteria (pending item 16; dev/express-apply-plan.md): what a job asks to be proved, and for one person
 * whether their current accepted proof meets it. Neutral on purpose: the criteria are the company's ask, not the
 * person's gaps, so they never wear red, amber or green; a check or a dashed circle and the word carry the state.
 */

const monoLabel = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const lineChip = "inline-flex min-w-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.8rem] text-ink [overflow-wrap:anywhere]";

/** "Proof of SIEM and log analysis", "CompTIA Security+": what a criterion asks for, in words. */
const askText = (kind: "skill" | "certificate", label: string) => (kind === "skill" ? `Proof of ${label}` : label);

/** The criteria a job asks for, by name, on its Departures card when there is no one to check them against. */
export function CriteriaAsked({ names }: { names: JobCriteriaNames }) {
  const items = [...names.verifiedSkills.map((l) => askText("skill", l)), ...names.certificates.map((l) => askText("certificate", l))];
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={monoLabel}>Express apply asks for</span>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((t) => (
          <li key={t} className={lineChip}>
            <BadgeCheck {...ICON} size={14} />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Each criterion with Met or Not yet for one person. `compact` is the Departures card (chips); otherwise a list, as in
 * the preview and the company's drawer. `warn` adds the line that unmet criteria never block (the candidate's side).
 */
export function CriteriaList({ criteria, compact = false, warn = false, title = "Express apply criteria" }: { criteria: CriteriaView; compact?: boolean; warn?: boolean; title?: string }) {
  if (!criteria.total) return null;
  const unmet = criteria.met < criteria.total;
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className={monoLabel}>
          {title} · {criteriaSummary(criteria)}
        </span>
        <ul className="flex flex-wrap gap-1.5">
          {criteria.lines.map((l) => (
            <li key={`${l.kind}-${l.label}`} className={`${lineChip} ${l.met ? "" : "border-dashed text-muted"}`}>
              {l.met ? <CircleCheck {...ICON} size={14} /> : <CircleDashed {...ICON} size={14} />}
              {askText(l.kind, l.label)}
              <span className="sr-only">: {CRITERIA_WORDS[l.met ? "met" : "not_met"]}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className={monoLabel}>{title}</h4>
        <span className="text-[0.84rem] font-medium">{criteriaSummary(criteria)}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {criteria.lines.map((l) => (
          <li key={`${l.kind}-${l.label}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            {l.met ? <CircleCheck {...ICON} className="shrink-0" /> : <CircleDashed {...ICON} className="shrink-0 text-muted" />}
            <span className="min-w-0 flex-1 text-[0.88rem] [overflow-wrap:anywhere]">{askText(l.kind, l.label)}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[0.76rem] font-medium ${l.met ? "bg-surface-2 text-ink" : "border border-dashed border-line text-muted"}`}>
              {CRITERIA_WORDS[l.met ? "met" : "not_met"]}
            </span>
          </li>
        ))}
      </ul>
      {warn && unmet && (
        <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-[0.82rem]">
          <ShieldCheck {...ICON} className="mt-0.5 shrink-0" />
          <span>{CRITERIA_WARN_TEXT}</span>
        </p>
      )}
      <p className="text-[0.78rem] text-muted">Met means current accepted proof on CareerMetro: a passed skill check, a confirmed role or a checked certificate. The resume alone doesn&apos;t count.</p>
    </div>
  );
}
