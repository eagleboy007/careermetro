import { ArrowRight, Award, BadgeCheck, Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PlanView } from "@/lib/schemas";
import { EliteBadge } from "./elite-badge";
import { TurnOnElite } from "./turn-on-elite";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const CARD = "flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5";
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

/** What stays free and what Elite adds (handoff 12l, prototype v44). `true` is a tick with its words. */
type Cell = { tick?: boolean; text: string; none?: boolean };
const ROWS: { feature: string; free: Cell; elite: Cell }[] = [
  { feature: "Gaps with evidence, your path and daily rides", free: { tick: true, text: "Always" }, elite: { tick: true, text: "Always" } },
  { feature: "Library free shelf and Departures", free: { tick: true, text: "Always" }, elite: { tick: true, text: "Always" } },
  { feature: "Verified tick for your identity and certificates", free: { tick: true, text: "Always" }, elite: { tick: true, text: "Same rules" } },
  { feature: "Practice: written questions on your goals", free: { text: "10 answers a day" }, elite: { text: "No daily cap" } },
  { feature: "Question bank for your role, with model answers", free: { text: "5 questions" }, elite: { text: "The full bank" } },
  { feature: "Mock interviews with an AI interviewer, feedback on each answer", free: { none: true, text: "Not included" }, elite: { tick: true, text: "Unlimited" } },
  { feature: "Timed tests with a review of every question", free: { none: true, text: "Not included" }, elite: { tick: true, text: "Unlimited" } },
  { feature: "Practice round for an AI first interview (Arrivals)", free: { none: true, text: "Not included" }, elite: { tick: true, text: "Per company" } },
  { feature: "Elite shelf in the Library: expert-checked playbooks and drills", free: { none: true, text: "Not included" }, elite: { tick: true, text: "All" } },
  { feature: "Elite badge on your profile", free: { none: true, text: "Not included" }, elite: { tick: true, text: "You choose to show it" } },
];

/** Prices after the beta (handoff 12l and C4, kept for now by Milin, 2026-10-19). Copy only: nothing can be bought. */
const PRICES = [
  { name: "Elite monthly", price: "₹299", per: "/month", note: "Cancel any time.", best: false },
  { name: "Elite yearly", price: "₹2,499", per: "/year", note: "About ₹208 a month.", best: true },
  { name: "Elite Pass", price: "₹799", per: " once", note: "3 months, paid once. Good for a hiring season.", best: false },
] as const;

/**
 * The Elite page (`/elite`, handoff 12l): what stays free, the Free and Elite table, the prices after the beta (not
 * charged now, not final) and the verified tick, which is never for sale. Free during the beta: no card, no checkout.
 * With no `onSwitch` (example data) the button changes nothing.
 */
export function EliteView({
  plan,
  onSwitch,
  idPrefix = "elite",
}: {
  plan: PlanView;
  onSwitch?: (on: boolean) => Promise<string | null>;
  /** Ids for the headings, so two copies on /design don't clash. */
  idPrefix?: string;
}) {
  const id = (part: string) => `${idPrefix}-${part}`;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby={id("h")} className="rounded-[24px] border border-elite bg-[linear-gradient(135deg,var(--elite-soft),var(--surface)_60%)] px-[18px] py-5 min-[760px]:px-[30px] min-[760px]:py-7">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-elite px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-on-elite">
          <Award size={14} {...ICON} />
          Elite
        </span>
        <h1 id={id("h")} className="mb-2.5 mt-3 max-w-[20ch] font-display text-[1.55rem] font-semibold leading-[1.1] tracking-[-0.025em] min-[760px]:text-[2rem]">
          Walk into the interview having done it already.
        </h1>
        <p className="max-w-[62ch] text-[0.95rem] leading-[1.55] text-muted">
          Everything that gets you ready stays free: your gaps, your path, daily rides, the Library and Departures. Elite adds mock interviews, timed
          tests, the full question bank for your role and an expert-checked shelf in the Library.
        </p>
        <div className="mb-2.5 mt-[18px]">
          <TurnOnElite on={plan.elite} action={onSwitch} />
        </div>
        <p className="max-w-[62ch] text-[0.8rem] text-muted">
          {plan.elite
            ? `Elite is on since ${plan.since}. You have everything in Elite until the beta ends. We tell you at least 30 days before, and nothing is charged unless you choose a plan.`
            : "No card needed. Nothing is charged during the beta, and nothing renews on its own after it."}{" "}
          With Elite, Practice has no daily cap and Interview prep opens mock interviews, timed tests and the full question bank; the Elite shelf
          opens once it is built.
        </p>
      </section>

      <section aria-labelledby={id("compare-h")} className={CARD}>
        <h2 id={id("compare-h")} className="text-[1.1rem] font-semibold">
          Free and Elite
        </h2>
        <table aria-labelledby={id("compare-h")} className="w-full border-collapse text-[0.86rem]">
          <thead>
            <tr>
              <th scope="col" className={`${LABEL} w-[52%] px-2 py-2 text-left font-medium min-[760px]:px-3`}>
                <span className="sr-only">Feature</span>
              </th>
              <th scope="col" className={`${LABEL} px-2 py-2 text-left font-medium min-[760px]:px-3`}>
                Free
              </th>
              <th scope="col" className="bg-elite-soft px-2 py-2 text-left font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-elite min-[760px]:px-3">
                Elite
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.feature} className="border-t border-line">
                <th scope="row" className="px-2 py-2.5 text-left align-top font-[550] min-[760px]:px-3">
                  {r.feature}
                </th>
                <td className="px-2 py-2.5 align-top min-[760px]:px-3">
                  <CellText cell={r.free} />
                </td>
                <td className="bg-elite-soft px-2 py-2.5 align-top min-[760px]:px-3">
                  <CellText cell={r.elite} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[0.8rem] text-muted">Practice and mock interviews get you ready. Only proof fills a gap, on Free and on Elite.</p>
      </section>

      <section aria-labelledby={id("prices-h")} className={CARD}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={id("prices-h")} className="mr-auto text-[1.1rem] font-semibold">
            Prices after the beta
          </h2>
          <span className={LABEL}>not charged now</span>
        </div>
        <ul className="grid gap-3 min-[760px]:grid-cols-3">
          {PRICES.map((p) => (
            <li
              key={p.name}
              className={`relative flex flex-col gap-1 rounded-md border p-4 ${p.best ? "border-elite shadow-[inset_0_0_0_1px_var(--elite)]" : "border-line"}`}
            >
              {p.best && (
                <span className="absolute -top-[9px] right-3 rounded-full bg-elite px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.06em] text-on-elite">
                  Best value
                </span>
              )}
              <b className="text-[0.92rem] font-semibold">{p.name}</b>
              <span className="font-display text-[1.5rem] font-semibold tracking-[-0.02em]">
                {p.price}
                <small className="font-sans text-[0.8rem] font-normal">{p.per}</small>
              </span>
              <small className="text-[0.78rem] text-muted">{p.note}</small>
            </li>
          ))}
        </ul>
        <p className="text-[0.8rem] text-muted">
          Prices are not final. We tell you at least 30 days before the beta ends, and you choose then. If you do nothing, you go back to Free and keep
          everything you made.{" "}
          <Link href="/settings#acc-plan" className="inline-flex items-center gap-1 font-[550] text-ink underline underline-offset-2">
            Your plan in Account settings
            <ArrowRight size={14} {...ICON} />
          </Link>
        </p>
      </section>

      <section aria-labelledby={id("tick-h")} className={CARD}>
        <h2 id={id("tick-h")} className="text-[1.1rem] font-semibold">
          The verified tick is never for sale
        </h2>
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <Tick mark={<BadgeCheck size={20} {...ICON} />} title="Verified tick">
            Shows next to a name once we check the person is who they say: a work email for a current job, or an accepted proof. On a certificate it
            means we matched the badge link with its issuer. Free for everyone.
          </Tick>
          <Tick mark={<EliteBadge />} title="Elite badge">
            Says the person has Elite. It says nothing about who they are or what they know, so search, Network and Departures never rank by it. Off on
            your profile unless you turn it on.
          </Tick>
        </div>
      </section>
    </div>
  );
}

function CellText({ cell }: { cell: Cell }) {
  if (cell.none) return <span className="text-muted">{cell.text}</span>;
  return (
    <span className="inline-flex items-start gap-1.5">
      {cell.tick && <Check size={14} {...ICON} className="mt-[3px] shrink-0" />}
      {cell.text}
    </span>
  );
}

function Tick({ mark, title, children }: { mark: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-4">
      <span className="flex h-6 items-center">{mark}</span>
      <b className="text-[0.92rem] font-semibold">{title}</b>
      <p className="text-[0.84rem] leading-[1.5] text-muted">{children}</p>
    </div>
  );
}
