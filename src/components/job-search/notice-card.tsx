"use client";

import { Check, Clock } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { noticeCountdown, noticeDayText } from "@/lib/job-search/rules";
import { NOTICE_DAYS, type NoticeDays } from "@/lib/schemas/constants";
import { ghostSm } from "./job-search";

/*
 * The notice period card (handoff 6, prototype v44 `npcard`), private: "only you see this". Days 15, 30, 60 or 90;
 * "I have resigned" asks for the resignation date (not later than today in India), then "Start countdown" shows the
 * days left, the last working day, the day free to join and how much is served. Companies see only Can join, never the
 * days or the dates. Without an action (example data) it changes here only and nothing is saved.
 */

export type NoticeValue = { days: NoticeDays | null; resignedOn: string | null };
export type NoticeAction = (input: NoticeValue) => Promise<string | null>;

const FAILED = "That didn't work. Please try again.";
const primarySm =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[0.8rem] font-medium text-on-accent hover:opacity-90 aria-disabled:opacity-60";
const quietSm = "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[0.8rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";
const row = "flex flex-wrap items-center gap-3 text-[0.86rem] text-muted";
const label = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

type Step = "days" | "date" | "countdown";
type Focus = "resign" | "date" | "change";

export function NoticeCard({ initial, today, action }: { initial: NoticeValue; today: string; action?: NoticeAction }) {
  const [saved, setSaved] = useState(initial);
  // A new value from the server (after the save's refresh, or a change elsewhere) resets the card.
  const [base, setBase] = useState(initial);
  if (base.days !== initial.days || base.resignedOn !== initial.resignedOn) {
    setBase(initial);
    setSaved(initial);
  }
  const [days, setDays] = useState<NoticeDays | null>(initial.days);
  const [step, setStep] = useState<Step>(initial.resignedOn && initial.days ? "countdown" : "days");
  const [date, setDate] = useState(initial.resignedOn ?? today);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dateId = useId();
  const resignRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // The button pressed goes away with its step, so focus moves to the next step's control (after a press only).
  const [focus, setFocus] = useState<{ to: Focus; n: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    ({ resign: resignRef, date: dateRef, change: changeRef })[focus.to].current?.focus();
  }, [focus]);
  const moveTo = (next: Step, to: Focus) => {
    setStep(next);
    setFocus((f) => ({ to, n: (f?.n ?? 0) + 1 }));
  };

  const save = (value: NoticeValue, done: () => void, said: string | null = null) => {
    if (pending) return;
    if (!action) {
      setSaved(value);
      setMessage(said);
      return done();
    }
    start(async () => {
      const error = await action(value).catch(() => FAILED);
      if (error) return setMessage(error);
      setSaved(value);
      setMessage(said);
      done();
    });
  };

  const pickDays = (d: NoticeDays) => {
    setDays(d);
    // Before resigning the days are saved at once; while the date is being changed they go with Start countdown.
    if (step === "days") save({ days: d, resignedOn: null }, () => {});
  };
  const startCountdown = () => {
    if (!days) return setMessage("Pick your notice period first.");
    if (!date) return setMessage("Pick the day you handed in your resignation.");
    if (date > today) return setMessage("Pick the day you handed in your resignation. It can't be later than today.");
    save({ days, resignedOn: date }, () => moveTo("countdown", "change"), "Countdown started. Your Can join answer on applications now starts from it.");
  };
  const stopCountdown = () => save({ days, resignedOn: null }, () => moveTo("days", "resign"), "Countdown stopped.");

  const daysGroup = (
    <div role="group" aria-label="Notice period" className="inline-flex flex-wrap gap-1">
      {NOTICE_DAYS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={d === days}
          onClick={() => pickDays(d)}
          className="rounded-full border border-line px-3 py-1 text-[0.8rem] font-medium text-muted aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-bg"
        >
          {d} days
        </button>
      ))}
    </div>
  );

  const countdown = step === "countdown" && saved.days && saved.resignedOn ? noticeCountdown(saved.resignedOn, saved.days, today) : null;

  return (
    <section aria-label="Notice period" data-notice-card className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Clock size={18} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
        <h3 className="text-[1.02rem] font-semibold">Notice period</h3>
        {countdown ? (
          <>
            <span className={label}>
              resigned {noticeDayText(saved.resignedOn!)} · {saved.days} days
            </span>
            <button ref={changeRef} type="button" className={`${quietSm} ml-auto`} onClick={() => moveTo("date", "date")}>
              Change
            </button>
          </>
        ) : (
          <span className={label}>only you see this</span>
        )}
      </div>

      {countdown ? (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
            <div className="flex h-[84px] w-[84px] flex-col items-center justify-center rounded-[20px] bg-accent-soft text-accent">
              <b className="font-display text-[2rem] leading-none">{countdown.left}</b>
              <small className="font-mono text-[0.62rem] uppercase tracking-[0.06em]">days left</small>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <b className="font-semibold">Last working day: {noticeDayText(countdown.lastDay)}</b>
              <small className="text-[0.84rem] text-muted">Free to join from {noticeDayText(countdown.joinFrom)}</small>
              <div
                role="progressbar"
                aria-label="Notice period served"
                aria-valuenow={countdown.served}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
              >
                <i className="block h-full rounded-full bg-accent" style={{ width: `${countdown.served}%` }} />
              </div>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5 text-[0.82rem] text-muted">
            {[
              "Keep applying and interviewing, even after you accept an offer, until the day you join.",
              "Companies you apply to see only when you can join, never your notice terms.",
            ].map((note) => (
              <li key={note} className="flex gap-2">
                <Check size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
                {note}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className={row}>
            <span className="min-w-[200px] flex-1">Your notice period at your current job</span>
            {daysGroup}
          </div>
          {step === "days" ? (
            <div className={row}>
              <span className="min-w-[200px] flex-1">Already resigned? Start a countdown to your last working day, so companies know when you can join.</span>
              <button ref={resignRef} type="button" className={ghostSm} onClick={() => moveTo("date", "date")}>
                I have resigned
              </button>
            </div>
          ) : (
            <div className={row}>
              <label htmlFor={dateId} className="min-w-[200px] flex-1">
                When did you hand in your resignation?
              </label>
              <input
                ref={dateRef}
                id={dateId}
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    startCountdown();
                  }
                }}
                className="rounded-[10px] border border-line-strong bg-surface-2 px-2.5 py-1.5 text-ink"
              />
              <button type="button" className={primarySm} aria-disabled={pending || undefined} onClick={startCountdown}>
                Start countdown
              </button>
              {saved.resignedOn ? (
                <button type="button" className={quietSm} aria-disabled={pending || undefined} onClick={stopCountdown}>
                  Stop the countdown
                </button>
              ) : (
                <button type="button" className={quietSm} onClick={() => moveTo("days", "resign")}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p role="status" className="text-[0.8rem] text-muted empty:hidden">
        {message}
      </p>
    </section>
  );
}
