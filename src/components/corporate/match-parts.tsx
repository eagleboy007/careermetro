import { matchSummary } from "@/lib/corporate/match-words";
import type { JobMatchView, MatchState } from "@/lib/corporate/types";
import { MATCH_WORDS } from "@/lib/schemas/constants";

/*
 * Match to this job (C7; Milin, 9 Oct): the job's own requirements against the candidate's public skills and accepted
 * proofs, in words. Green, amber and red are gap status here, which is what they mean everywhere: proved, on the
 * resume but not proved, not on the resume. The words always come with the colour.
 */

const DOT: Record<MatchState, string> = { proved: "bg-good", on_resume: "bg-warn", not_on_resume: "bg-bad" };
const CHIP: Record<MatchState, string> = {
  proved: "bg-good-soft text-ink",
  on_resume: "bg-warn-soft text-ink",
  not_on_resume: "bg-bad-soft text-ink",
};

/** One dot per required line, then the summary in words ("2 of 5 required proved · 1 on resume"). */
export function MatchDots({ match }: { match: JobMatchView }) {
  const required = match.lines.filter((l) => l.group !== "nice");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="flex gap-1">
        {required.map((l, i) => (
          <span key={i} className={`size-2.5 rounded-full ${DOT[l.state]}`} />
        ))}
      </span>
      <span className="text-[0.8rem] text-ink">{matchSummary(match)}</span>
    </span>
  );
}

/** Every requirement with its word: required and one-of groups first, then nice to have (never blocks). */
export function MatchList({ match }: { match: JobMatchView }) {
  const groups = [
    { title: "Required", lines: match.lines.filter((l) => l.group !== "nice") },
    { title: "Nice to have", lines: match.lines.filter((l) => l.group === "nice") },
  ].filter((g) => g.lines.length);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.9rem] font-medium">{matchSummary(match)}</p>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <h4 className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">{g.title}</h4>
          <ul className="flex flex-col divide-y divide-line">
            {g.lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${DOT[l.state]}`} />
                <span className="min-w-0 flex-1 text-[0.88rem] [overflow-wrap:anywhere]">{l.label}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[0.76rem] font-medium ${CHIP[l.state]}`}>{MATCH_WORDS[l.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[0.8rem] text-muted">
        Worked out from this job&apos;s requirements and the candidate&apos;s resume and accepted proofs, by the same rules for everyone. In words, never a score. Their own goals and
        learning plan stay private.
      </p>
    </div>
  );
}
