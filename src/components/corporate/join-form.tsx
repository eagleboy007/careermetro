"use client";

import { KeyRound, Mail } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { JoinActions } from "@/lib/corporate/types";
import { fieldClass, hintClass, labelClass, TestCodeBox } from "./parts";

/**
 * "Confirm your work email" (handoff 12e): a person a Recruiter admin gave a role types the work email it was given
 * to, gets a 6-digit code there, and the role switches on. One login only: their own CareerMetro account.
 */
export function JoinForm({
  actions,
  hint = "The email the Recruiter admin added, on your company's domain. We send a 6-digit code there.",
  doneText = "Your role is on. Loading Corporate…",
}: {
  actions?: JoinActions;
  /** The line under the email field; the 180-day re-check (Testing T40) names the company's domain instead. */
  hint?: string;
  doneText?: string;
}) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [testCode, setTestCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const errorId = useId();

  const send = () =>
    start(async () => {
      setError(null);
      if (!actions) return;
      const r = await actions.startJoin(email);
      if (!r.ok) return setError(r.error);
      setTestCode(r.testCode ?? null);
      setCode("");
      setStage("code");
    });
  const confirm = () =>
    start(async () => {
      setError(null);
      if (!actions) return;
      const r = await actions.finishJoin(email, code);
      if (!r.ok) return setError(r.error);
      setDone(true);
    });

  if (done) {
    return (
      <p role="status" className="text-sm text-muted">
        {doneText}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (stage === "email") send();
        else confirm();
      }}
    >
      {stage === "email" ? (
        <label className={labelClass}>
          Work email
          <input
            name="workEmail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            className={fieldClass}
          />
          <span className={hintClass}>{hint}</span>
        </label>
      ) : (
        <>
          <p className="text-[0.86rem] text-muted [overflow-wrap:anywhere]">
            We sent a code to <b className="font-semibold text-ink">{email}</b>. It works for 10 minutes.
          </p>
          {testCode && <TestCodeBox code={testCode} />}
          <label className={labelClass}>
            Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? errorId : undefined}
              className={`${fieldClass} max-w-[220px] font-mono text-lg tracking-[0.3em]`}
            />
          </label>
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !actions}>
          {stage === "email" ? <Mail size={16} strokeWidth={1.75} aria-hidden="true" /> : <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />}
          {stage === "email" ? "Send code" : "Confirm"}
        </Button>
        {stage === "code" && (
          <button type="button" onClick={() => setStage("email")} disabled={pending} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
            Use another email
          </button>
        )}
      </div>
    </form>
  );
}
