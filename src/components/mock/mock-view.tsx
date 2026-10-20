"use client";

import { Lock, MessageSquareText, Zap } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type {
  MockFocus,
  MockInterviewAnswerResult,
  MockInterviewEndResult,
  MockInterviewStartResult,
  MockLength,
  MockPageView,
  MockSessionResult,
  MockTab,
  TimedTestFinishResult,
  TimedTestPickResult,
  TimedTestReview,
  TimedTestStartResult,
} from "@/lib/schemas";
import { MOCK_TABS } from "@/lib/schemas/constants";
import { MockInterview } from "./mock-interview";
import { QuestionBank } from "./question-bank";
import { TimedTest } from "./timed-test";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const TAB_TEXT: Record<MockTab, string> = { interview: "Mock interview", test: "Timed test", bank: "Question bank" };
const SEG = "inline-flex min-h-11 items-center rounded-full px-4 text-[0.86rem] font-[550] text-ink hover:bg-surface-2 aria-pressed:bg-ink aria-pressed:text-bg";

/**
 * Interview prep (`/mock`, handoff 12l, prototype v44): three tabs, Mock interview, Timed test and Question bank, for
 * a role (the target role by default). With Elite off, a locked panel with "Turn on Elite" sits on top; the bank still
 * opens 5 questions on Free. Elite violet marks Elite only; cobalt is only the progress bars of the mock interview and
 * the test. Without actions (example data) nothing is saved.
 */
export function MockView({
  view,
  tab: firstTab,
  onStart,
  onPick,
  onFinish,
  initialReview,
  onInterviewStart,
  onInterviewAnswer,
  onInterviewEnd,
  initialInterviewResult,
}: {
  view: MockPageView;
  tab: MockTab;
  onStart?: (roleSlug: string) => Promise<TimedTestStartResult>;
  onPick?: (testId: string, questionId: string, pick: number) => Promise<TimedTestPickResult>;
  onFinish?: (testId: string) => Promise<TimedTestFinishResult>;
  /** For /design: the timed test tab opens on this review. */
  initialReview?: TimedTestReview;
  onInterviewStart?: (roleSlug: string, length: MockLength, focus: MockFocus) => Promise<MockInterviewStartResult>;
  onInterviewAnswer?: (sessionId: string, position: number, answer: string) => Promise<MockInterviewAnswerResult>;
  onInterviewEnd?: (sessionId: string, answers: { position: number; answer: string }[]) => Promise<MockInterviewEndResult>;
  /** For /design: the mock interview tab opens on this feedback. */
  initialInterviewResult?: MockSessionResult;
}) {
  const id = useId();
  const [tab, setTab] = useState<MockTab>(firstTab);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2.5 text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">
            Interview prep
            <span className="rounded-full bg-elite px-2 py-0.5 align-middle font-mono text-[0.66rem] font-medium uppercase tracking-[0.06em] text-on-elite">Elite</span>
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-[0.92rem] text-muted">
            A question bank for your role, mock interviews with an AI interviewer and timed tests like the ones companies send. Feedback comes in words,
            never a score. Practice gets you ready; only proof fills a goal.
          </p>
        </div>
        <Link href="/practice" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[0.84rem] font-[550] text-ink hover:bg-surface-2">
          <MessageSquareText size={15} {...ICON} />
          Free practice
        </Link>
      </div>

      {!view.elite && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line-strong bg-surface px-4 py-3 text-[0.86rem]">
          <Lock size={18} {...ICON} className="shrink-0 text-muted" />
          <span className="min-w-[200px] flex-1">
            <b className="font-semibold">Interview prep is part of Elite.</b> Free during the beta: turn it on and everything here opens.
          </span>
          <Link href="/elite" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-elite px-3.5 text-[0.84rem] font-[550] text-on-elite hover:opacity-90">
            <Zap size={15} {...ICON} />
            Turn on Elite
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Mode" className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1">
          {MOCK_TABS.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={SEG}>
              {TAB_TEXT[t]}
            </button>
          ))}
        </div>
        {tab !== "interview" && (
          <form action="/mock" method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label htmlFor={`${id}-role`} className="flex flex-col gap-1 text-[0.78rem] text-muted">
              Role
              <select
                id={`${id}-role`}
                name="role"
                defaultValue={view.role.slug}
                key={view.role.slug}
                className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-[0.88rem] text-ink"
              >
                {view.roles.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-[0.86rem] font-[550] text-ink hover:bg-surface-2">
              Show
            </button>
          </form>
        )}
      </div>

      {/* All three stay mounted, so a running round or test keeps its clock and answers while another tab is open. */}
      <div hidden={tab !== "interview"}>
        <MockInterview
          elite={view.elite}
          roles={view.roles}
          roleSlug={view.interview?.roleSlug ?? view.role.slug}
          initial={view.interview}
          initialResult={initialInterviewResult}
          onStart={onInterviewStart}
          onAnswer={onInterviewAnswer}
          onEnd={onInterviewEnd}
        />
      </div>
      <div hidden={tab !== "test"}>
        <TimedTest
          key={view.role.slug}
          elite={view.elite}
          role={view.role}
          initial={view.test}
          initialReview={initialReview}
          onStart={onStart}
          onPick={onPick}
          onFinish={onFinish}
        />
      </div>
      <div hidden={tab !== "bank"}>
        <QuestionBank bank={view.bank} elite={view.elite} roleTitle={view.role.title} />
      </div>
    </div>
  );
}
