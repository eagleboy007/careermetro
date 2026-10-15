"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { splitName } from "@/lib/account/name";
import { finishSignUp, type FinishState } from "./actions";

const field = "rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-ink";

export function FinishForm({ next, name }: { next: string; name: string | null }) {
  const { first, last } = splitName(name);
  const [state, action, pending] = useActionState<FinishState, FormData>(finishSignUp, { error: null });
  return (
    <form action={action} onSubmit={(e) => pending && e.preventDefault()} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <fieldset className="flex flex-col gap-1.5 text-sm" aria-describedby="finish-name-hint">
        <legend className="sr-only">Your name</legend>
        <div className="grid gap-3 min-[480px]:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="finish-first" className="font-medium">
              First name
            </label>
            <input id="finish-first" name="firstName" autoComplete="given-name" required maxLength={40} defaultValue={first} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="finish-last" className="font-medium">
              Last name
            </label>
            <input id="finish-last" name="lastName" autoComplete="family-name" maxLength={40} defaultValue={last} className={field} />
          </div>
        </div>
        <span id="finish-name-hint" className="text-muted">
          As it appears on your resume. We use it to check a resume is yours before adding it to your account, and show it on your profile.
        </span>
      </fieldset>
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input
          name="age"
          value="yes"
          type="checkbox"
          required
          aria-describedby={state.error ? "finish-error" : undefined}
          className="mt-1 accent-[var(--ink)]"
        />
        <span>I am 18 or older and agree to the terms and privacy policy.</span>
      </label>
      {state.error && (
        <p id="finish-error" role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" busy={pending}>
          Create my account
        </Button>
        {pending && (
          <span role="status" className="text-sm text-muted">
            One moment…
          </span>
        )}
      </div>
    </form>
  );
}
