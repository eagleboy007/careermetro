"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { TrackOption, TrackPicker } from "@/lib/schemas";

/** Saves a track of the person's goal role (null for the whole role). Answers null once saved, else the words to show. */
export type ChooseTrack = (trackId: string | null) => Promise<string | null>;

export const EXAMPLE_TRACK_MESSAGE = "This is example data, so nothing changes.";

const CHIP = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[0.8rem] text-ink";

/**
 * The Track chip on Your goals (v44 gap list item 11, docs/plans/tracks-plan.md). With a picker it opens and closes the
 * Track panel below the card's heading; without one (a role with no tracks, or production until the tracks are
 * reviewed) it is plain text, as before.
 */
export function TrackChip({
  name,
  picker,
  open,
  panelId,
  onToggle,
  onEscape,
  chipRef,
}: {
  name: string;
  picker: TrackPicker | null;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  onEscape: () => void;
  chipRef: Ref<HTMLButtonElement>;
}) {
  const label = <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted">Track</span>;
  if (!picker) {
    return (
      <span className={CHIP}>
        {label} {name}
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
      </span>
    );
  }
  return (
    <button
      ref={chipRef}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`Track ${name}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) onEscape();
      }}
      className={`${CHIP} hover:border-ink`}
    >
      {label} {name}
      <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className={`motion-safe:transition-transform ${open ? "rotate-90" : ""}`} />
    </button>
  );
}

const keyOf = (id: string | null) => id ?? "whole";

function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The option's small line, as in the prototype: "Dashboards, Power BI · 7 goals, 2 met". */
export function trackCount(o: Pick<TrackOption, "goals" | "met">): string {
  return `${o.goals} ${o.goals === 1 ? "goal" : "goals"}${o.met > 0 ? `, ${o.met} met` : ""}`;
}

/** What switching to the option would do, in plain words: its first open goals, and that proof carries over. */
export function trackPreview(o: Pick<TrackOption, "firstGoals" | "moreGoals">): string {
  const goals = o.firstGoals.length
    ? `Your goals become ${joinNames(o.firstGoals)}${o.moreGoals > 0 ? ` and ${o.moreGoals} more` : ""}.`
    : "Your resume and proof already cover every goal it has.";
  return `${goals} Proof you've added carries over.`;
}

/**
 * The Track panel (prototype `trk`, `trk-list`, `trk-prev`): the question, the options with their goal counts (the
 * one in use pressed), and a preview of the option picked with Switch track and Cancel. Escape closes it and focus goes
 * back to the chip; Cancel puts focus back on the option. Buttons stay focusable while saving (aria-disabled). The
 * card gives it a new key each time it opens, so a closed panel forgets its preview.
 */
export function TrackPanel({
  id,
  open,
  picker,
  demo,
  onChoose,
  onClose,
  onSwitched,
}: {
  id: string;
  open: boolean;
  picker: TrackPicker;
  demo: boolean;
  onChoose?: ChooseTrack;
  /** Escape. Left out on /design, where the panel stands on its own. */
  onClose?: () => void;
  /** After a switch is saved: the option's name. */
  onSwitched?: (name: string) => void;
}) {
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const switchButton = useRef<HTMLButtonElement>(null);
  const previewId = useId();
  const [focusTick, setFocusTick] = useState(0);
  // A new preview puts focus on its Switch track button, which the preview describes, so keyboard and screen reader
  // users land on the choice and hear what it does.
  useEffect(() => {
    if (focusTick > 0) switchButton.current?.focus();
  }, [focusTick]);

  const option = picked === undefined ? null : (picker.options.find((o) => o.id === picked) ?? null);
  const backToOption = (key: string) => list.current?.querySelector<HTMLButtonElement>(`[data-track="${key}"]`)?.focus();

  function pick(o: TrackOption) {
    setError("");
    if (o.id === picker.current) return setPicked(undefined);
    setPicked(o.id);
    setFocusTick((t) => t + 1);
  }

  async function switchTo(o: TrackOption) {
    if (sending) return;
    setError("");
    if (demo || !onChoose) return setError(EXAMPLE_TRACK_MESSAGE);
    setSending(true);
    const failed = await onChoose(o.id).catch(() => "We couldn't reach CareerMetro. Check your connection and try again.");
    setSending(false);
    if (failed) return setError(failed);
    setPicked(undefined);
    onSwitched?.(o.id === null ? picker.role : o.name);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !onClose) return;
    e.stopPropagation();
    onClose();
  };

  return (
    <div id={id} role="group" aria-label="Pick a track" hidden={!open} onKeyDown={onKeyDown} className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-[0.84rem] text-muted">
        Your destination is {picker.role}. What kind of work do you want there? Your goals come from the track you pick.
      </p>
      <div ref={list} className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {picker.options.map((o) => (
          <button
            key={keyOf(o.id)}
            type="button"
            data-track={keyOf(o.id)}
            aria-pressed={o.id === picker.current}
            onClick={() => pick(o)}
            className="flex min-h-11 flex-col items-start gap-0.5 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-left text-[0.88rem] text-ink hover:border-ink aria-pressed:border-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--color-ink)]"
          >
            <b className="font-semibold">{o.name}</b>
            <small className="text-[0.78rem] text-muted">
              {o.blurb} · {trackCount(o)}
            </small>
          </button>
        ))}
      </div>
      {/* Not a live region: focus moves to Switch track, which this preview describes, so it is read once. */}
      <div className="flex flex-col gap-2 text-[0.84rem] empty:hidden">
        {option && (
          <>
            <p id={previewId}>
              <b className="font-semibold">Switch to {option.id === null ? "the whole role" : option.name}?</b> {trackPreview(option)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                ref={switchButton}
                type="button"
                aria-disabled={sending}
                aria-describedby={previewId}
                onClick={() => void switchTo(option)}
                className="inline-flex min-h-11 items-center rounded-full border border-ink bg-ink px-3 py-1 text-[0.8rem] font-semibold text-bg hover:opacity-90 aria-disabled:opacity-60"
              >
                {sending ? "Switching…" : "Switch track"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const key = keyOf(option.id);
                  setPicked(undefined);
                  setError("");
                  backToOption(key);
                }}
                className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-[0.8rem] font-semibold text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
