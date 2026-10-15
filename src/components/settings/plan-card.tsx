import { Award, Check } from "lucide-react";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/** What Elite adds, from prototype v32. Shown only: Elite isn't on sale during the beta. */
const ELITE = [
  "AI mock interviews for your target role, with written feedback",
  "A practice AI round before a company's real AI interview on Arrivals",
  "Question bank by role and timed mock tests",
  "Elite shelf in the Library: paid and expert-checked courses",
  "Elite badge on your profile",
];

/** The prices Milin accepted for now (handoff 12c and change C4, 2026-10-09). */
const PRICES = [
  { name: "Elite monthly", price: "₹299", per: "/month", note: "Renews each month." },
  { name: "Elite yearly", price: "₹2,499", per: "/year", note: "Renews each year." },
  { name: "Elite Pass", price: "₹799", per: " once", note: "3 months, paid once. Never renews." },
];

/**
 * "Your plan" (handoff 12c, change C4): Free during the beta, and the Elite card for later. Nothing here can be
 * bought: there is no billing code during the beta, so the card has no buttons.
 */
export function PlanCard() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.88rem] text-muted">
        Everything you use today is free during the beta: your gaps, path, daily rides, Departures and the Inbox. There is nothing to pay.
      </p>
      <div data-board="" className="flex flex-col gap-3.5 rounded-[18px] bg-board p-[18px] text-board-ink">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-board-line px-2.5 py-1 font-mono text-[0.78rem] uppercase tracking-[0.14em]">
            <Award size={14} {...ICON} />
            Elite
          </span>
          <span className="ml-auto text-[0.78rem] text-board-dim">After the beta · not on sale yet</span>
        </div>
        <ul className="grid gap-x-4 gap-y-2 text-[0.86rem] min-[760px]:grid-cols-2">
          {ELITE.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check size={15} {...ICON} className="mt-0.5 shrink-0 text-board-dim" />
              {line}
            </li>
          ))}
        </ul>
        <ul aria-label="Elite prices" className="grid gap-2.5 min-[760px]:grid-cols-3">
          {PRICES.map((p) => (
            <li key={p.name} className="flex flex-col gap-1 rounded-[14px] border border-board-line p-3.5">
              <b className="text-[0.88rem] font-semibold">{p.name}</b>
              <span className="font-display text-[1.5rem] font-semibold tracking-[-0.02em]">
                {p.price}
                <small className="font-sans text-[0.78rem] font-normal">{p.per}</small>
              </span>
              <small className="text-[0.76rem] text-board-dim">{p.note}</small>
            </li>
          ))}
        </ul>
        <small className="text-[0.76rem] text-board-dim">Prices in rupees. When Elite opens you choose whether to join; until then nothing changes.</small>
      </div>
    </div>
  );
}
