"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { finishSignUp, type FinishState } from "./actions";

const field = "rounded-sm border border-line bg-surface px-3 py-2.5 text-ink";

export function FinishForm({ next, name }: { next: string; name: string | null }) {
  const [state, action, pending] = useActionState<FinishState, FormData>(finishSignUp, { error: null });
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="finish-name" className="font-medium">
          Your name
        </label>
        <input
          id="finish-name"
          name="name"
          autoComplete="name"
          maxLength={80}
          defaultValue={name ?? ""}
          aria-describedby="finish-name-hint"
          className={field}
        />
        <span id="finish-name-hint" className="text-muted">
          Shown on your profile. You can change it later.
        </span>
      </div>
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
        <Button type="submit" disabled={pending}>
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
