"use client";

import { ArrowRight, Check, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { RemoveGoal, smallButton } from "@/components/gaps/job-check-actions";
import { changeGoal } from "@/components/map/not-for-me";
import { ChoiceTag } from "@/components/ui/choice-tag";
import { StatusChip } from "@/components/ui/status-chip";
import type { Goal, GoalStatus, GoalsSummary } from "@/lib/schemas";
import { TrackChip, TrackPanel, type ChooseTrack } from "./track-picker";

const LAMP: Record<GoalStatus, { index: number; className: string; glow: string; word: string }> = {
  missing: { index: 0, className: "bg-bad", glow: "shadow-[0_0_6px_var(--color-bad)]", word: "Missing" },
  weak: { index: 1, className: "bg-warn", glow: "shadow-[0_0_6px_var(--color-warn)]", word: "Weak" },
  met: { index: 2, className: "bg-good", glow: "shadow-[0_0_6px_var(--color-good)]", word: "Met" },
};

/**
 * Your goals: one goal per gap, with red, amber or green lamps. Tapping a goal shows its evidence and its pitstops.
 * On the first day only the goals show, as in the prototype. The Track chip opens the Track picker when the role
 * offers tracks here (docs/plans/tracks-plan.md); otherwise it is plain text.
 */
export function GoalsCard({
  summary,
  mapHref,
  firstDay = false,
  demo = false,
  onChooseTrack,
}: {
  summary: GoalsSummary;
  mapHref?: string;
  firstDay?: boolean;
  /** Example data (for /design): removing a goal or switching track saves nothing. */
  demo?: boolean;
  /** Saves a track picked on the Track picker. */
  onChooseTrack?: ChooseTrack;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const router = useRouter();
  const [note, setNote] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  // A skipped goal leaves the list once the page refreshes; focus moves to the card's heading, never to the page.
  useEffect(() => {
    if (refreshing || !moveFocus.current) return;
    heading.current?.focus();
    moveFocus.current = false;
  }, [refreshing]);
  const changed = (words: string) => {
    moveFocus.current = true;
    setNote(words);
    startRefresh(() => router.refresh());
  };
  const picker = summary.picker ?? null;
  const [trackOpen, setTrackOpen] = useState(false);
  // Each opening is a fresh panel, so a closed one forgets its preview.
  const [trackOpenings, setTrackOpenings] = useState(0);
  const chip = useRef<HTMLButtonElement>(null);
  const trackPanelId = useId();
  const closeTrack = () => {
    setTrackOpen(false);
    chip.current?.focus();
  };
  // A switch closes the picker with focus on the chip. The server action's refresh() brings the new goals, as for the
  // other Today actions; the chip stays put meanwhile.
  const switched = (name: string) => {
    closeTrack();
    setOpen(null);
    setNote(`Track changed to ${name}. Your goals were worked out again from your resume.`);
  };
  const more = summary.moreCount === 1 ? "1 more goal" : `${summary.moreCount} more goals`;
  return (
    <section
      aria-label="Your goals"
      className="flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 ref={heading} tabIndex={-1} className="text-[1.08rem] font-semibold tracking-[-0.01em] focus:outline-2 focus:outline-offset-2 focus:outline-ink">
          Your goals
        </h3>
        <TrackChip
          name={summary.track}
          picker={picker}
          open={trackOpen}
          panelId={trackPanelId}
          onToggle={() => {
            if (!trackOpen) setTrackOpenings((n) => n + 1);
            setTrackOpen(!trackOpen);
          }}
          onEscape={closeTrack}
          chipRef={chip}
        />
        {mapHref ? (
          <Link href={mapHref} className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-semibold text-muted hover:text-ink">
            Open map
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <span className="ml-auto text-[0.82rem] font-semibold text-muted">Map · soon</span>
        )}
      </div>
      {picker && (
        <TrackPanel key={trackOpenings} id={trackPanelId} open={trackOpen} picker={picker} demo={demo} onChoose={onChooseTrack} onClose={closeTrack} onSwitched={switched} />
      )}
      <ul className="flex flex-col gap-1.5">
        {summary.goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            open={open === g.id}
            onToggle={() => setOpen(open === g.id ? null : g.id)}
            action={g.notForMe ? <NotForMeAction goal={g} demo={demo} busy={refreshing} onChanged={changed} /> : undefined}
          />
        ))}
      </ul>
      {!firstDay && summary.moreCount > 0 && (
        <p className="mt-1 text-[0.8rem] text-muted">
          {more} after these{summary.moreNames.length > 0 ? `: ${joinNames(summary.moreNames)}.` : "."}{" "}
          {mapHref ? (
            <Link href={mapHref} className="font-semibold text-ink hover:underline">
              See all on the map
            </Link>
          ) : (
            <span className="font-semibold">See all on the map, soon.</span>
          )}
        </p>
      )}
      {!firstDay && summary.suggestedGoal && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] border border-dashed border-line px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Lightbulb size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
          <span className="flex flex-col gap-0.5 text-[0.82rem] text-muted">
            <b className="text-[0.9rem] font-semibold text-ink">Suggested goal: {summary.suggestedGoal.name}</b>
            {summary.suggestedGoal.reason}
          </span>
          <button
            type="button"
            onClick={() => setAdded((a) => !a)}
            className="col-start-2 inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full border border-line bg-surface px-[11px] py-1.5 text-[0.8rem] font-semibold sm:col-start-3"
          >
            {added ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
            {added ? "Added" : "Add goal"}
          </button>
        </div>
      )}
      {(summary.choiceGoals?.length ?? 0) > 0 && <ChoiceGoals goals={summary.choiceGoals!} demo={demo} />}
      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
      {!firstDay && summary.metThisMonth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[0.8rem] text-muted">
          <span>Goals met with proof this month:</span>
          {summary.metThisMonth.map((name) => (
            <StatusChip key={name} status="met" label={name} />
          ))}
        </div>
      )}
    </section>
  );
}

function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "Your choice": goals the person added, apart from the line. Each has its own spur of two pitstops; none moves the
 * train or arrival (handoff sections 6 and 7). Open one to remove it from the goals.
 */
function ChoiceGoals({ goals, demo }: { goals: Goal[]; demo: boolean }) {
  const ids = useId();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  // The removed goal's row goes once the page refreshes; focus moves to this list's heading, never to the page.
  useEffect(() => {
    if (refreshing || !moveFocus.current) return;
    heading.current?.focus();
    moveFocus.current = false;
  }, [refreshing]);
  return (
    <section aria-labelledby={`${ids}-h`} className="flex flex-col gap-2 border-t border-line pt-3">
      <h4 ref={heading} id={`${ids}-h`} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
        Your choice
      </h4>
      <p className="text-[0.8rem] text-muted">Goals you added. They have their own pitstops and never change your train, your match or your gaps.</p>
      <ul className="flex flex-col gap-1.5">
        {goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            open={open === g.id}
            onToggle={() => setOpen(open === g.id ? null : g.id)}
            action={
              <RemoveGoal
                goalId={g.id}
                name={g.name}
                demo={demo}
                onRemoved={() => {
                  moveFocus.current = true;
                  setNote(`${g.name} removed from your goals.`);
                  startRefresh(() => router.refresh());
                }}
              />
            }
          />
        ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
    </section>
  );
}

/**
 * "Not for me" on a goal from a gap (FR-48), in the goal's open row, as on the Map: skip a required goal anyway (it
 * stays a gap and leaves this list; it is brought back from the Map), or learn another skill of a "one of these" group.
 * Buttons stay focusable while saving (aria-disabled), so focus never drops to the page.
 */
function NotForMeAction({ goal, demo, busy, onChanged }: { goal: Goal; demo: boolean; busy: boolean; onChanged: (words: string) => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const offer = goal.notForMe;
  if (!offer) return null;
  async function send(change: Parameters<typeof changeGoal>[1], done: string) {
    if (sending || busy) return;
    setError("");
    setSending(true);
    const failed = await changeGoal(goal.id, change, demo);
    setSending(false);
    if (failed) return setError(failed);
    onChanged(done);
  }
  const button = `${smallButton} aria-disabled:opacity-60`;
  return (
    <div className="flex w-full flex-col gap-2 border-t border-line pt-2">
      <span className="font-mono text-[0.68rem] uppercase tracking-[0.05em]">Not for me</span>
      {offer.kind === "swap" ? (
        <>
          <p>The role asks for any one of these. Learning another fills this goal just the same, so your match doesn&apos;t change.</p>
          <div className="flex flex-wrap gap-2">
            {offer.options.map((o) => (
              <button
                key={o.skillId}
                type="button"
                aria-disabled={sending || busy}
                onClick={() => send({ action: "swap", skillId: o.skillId }, `You're learning ${o.name} for this goal now.`)}
                className={button}
              >
                Learn {o.name} instead
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {offer.share && <p>{offer.share}</p>}
          <p>If you skip it, it stays a gap, so roles that need it stay amber. You can bring it back from the Map.</p>
          <div className="flex">
            <button
              type="button"
              aria-disabled={sending || busy}
              onClick={() => send({ action: "skip" }, `${goal.name} skipped. It stays a gap; bring it back from the Map.`)}
              className={button}
            >
              {sending ? "Skipping…" : "Skip anyway"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function GoalRow({ goal, open, onToggle, action }: { goal: Goal; open: boolean; onToggle: () => void; action?: ReactNode }) {
  const detailId = useId();
  const lamp = LAMP[goal.status];
  const count = goal.pitstops.length;
  return (
    <li className="overflow-hidden rounded-[14px] border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-[11px] text-left text-[0.88rem]"
      >
        <span className="flex h-3.5 w-[30px] items-center justify-around rounded-full bg-surface-2 px-[3px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} className={`size-1.5 rounded-full ${i === lamp.index ? `${lamp.className} ${lamp.glow}` : "bg-line"}`} />
          ))}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <b className="min-w-0 truncate font-medium">{goal.name}</b>
          {goal.choice && <ChoiceTag company={goal.choice.company} />}
        </span>
        <span className="whitespace-nowrap font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">
          {lamp.word}
          {count > 0 && ` · ${count} ${count === 1 ? "pitstop" : "pitstops"}`}
        </span>
      </button>
      {open && (
        <div id={detailId} className="flex min-w-0 flex-col gap-2 px-3.5 pb-3 text-[0.82rem] text-muted [overflow-wrap:anywhere] sm:pl-14">
          <p>{goal.evidence}</p>
          {goal.quote && (
            <p>
              From your resume: <q className="rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[0.74rem] text-ink">{goal.quote}</q>
            </p>
          )}
          {count > 0 && (
            <ol className="flex flex-col gap-1">
              {goal.pitstops.map((p) => (
                <li key={p.number} className={`grid grid-cols-[22px_minmax(0,1fr)] items-center gap-x-2 ${p.state === "now" ? "font-semibold text-ink" : ""}`}>
                  <span
                    className={`row-span-2 grid size-[22px] place-items-center rounded-full font-mono text-[0.66rem] ${
                      p.state === "done" ? "bg-accent text-on-accent" : p.state === "now" ? "border-2 border-accent text-ink" : "border border-line"
                    }`}
                  >
                    {p.state === "done" ? (
                      <>
                        <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                        <span className="sr-only">done</span>
                      </>
                    ) : (
                      p.number
                    )}
                  </span>
                  <span>{p.title}</span>
                  <small className="col-start-2 font-mono text-[0.68rem] font-normal">{p.state === "now" ? `you are here · ${p.note}` : p.note}</small>
                </li>
              ))}
            </ol>
          )}
          {goal.suggestion && (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2">
              <Lightbulb size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
              <span>
                <b className="block font-semibold text-ink">{goal.suggestion.title}</b>
                {goal.suggestion.detail}
              </span>
            </p>
          )}
          {action && <div className="flex justify-end">{action}</div>}
        </div>
      )}
    </li>
  );
}
