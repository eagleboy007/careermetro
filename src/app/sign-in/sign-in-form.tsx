"use client";

import { Mail } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { continueWithGoogle, emailStep, type EmailStep } from "./actions";

const field = "rounded-sm border border-line bg-surface px-3 py-2.5 text-ink";

/** Google or an emailed code. `error` comes from a failed redirect back to this page. */
export function SignInForm({ next, error }: { next: string; error: string | null }) {
  const [state, action, pending] = useActionState<EmailStep, FormData>(emailStep, { stage: "email", email: "", error: null });
  const message = state.error ?? (state.stage === "email" ? error : null);

  return (
    <div className="flex flex-col gap-6">
      <form action={continueWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="ghost" className="w-full py-3">
          <GoogleMark />
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.stage === "email" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email}
              aria-invalid={Boolean(message) || undefined}
              aria-describedby={message ? "sign-in-error" : undefined}
              className={`${field} font-normal`}
            />
          </label>
        ) : (
          <>
            <p className="text-sm text-muted">
              We sent a code to <strong className="font-medium text-ink">{state.email}</strong>. It works for 1 hour. You can also tap the link
              in the email.
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={10}
                required
                autoFocus
                aria-invalid={Boolean(message) || undefined}
                aria-describedby={message ? "sign-in-error" : undefined}
                className={`${field} font-mono text-lg tracking-[0.3em]`}
              />
            </label>
          </>
        )}
        {message && (
          <p id="sign-in-error" role="alert" className="text-sm text-bad">
            {message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            <Mail size={16} strokeWidth={1.75} aria-hidden="true" />
            {state.stage === "email" ? "Email me a code" : "Sign in"}
          </Button>
          {state.stage === "code" && (
            <>
              <button type="submit" name="intent" value="resend" disabled={pending} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
                Send a new code
              </button>
              <button type="submit" name="intent" value="restart" disabled={pending} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
                Use another email
              </button>
            </>
          )}
          {pending && (
            <span role="status" className="text-sm text-muted">
              One moment…
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

/** Google's "G", drawn in the current text color (no literal colors). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c5.34 0 8.88-3.75 8.88-9.04 0-.6-.07-1.06-.15-1.51z" />
    </svg>
  );
}
