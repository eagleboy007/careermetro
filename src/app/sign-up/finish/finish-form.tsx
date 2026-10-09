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
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your name
        <input name="name" autoComplete="name" maxLength={80} defaultValue={name ?? ""} className={`${field} font-normal`} />
        <span className="font-normal text-muted">Shown on your profile. You can change it later.</span>
      </label>
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input name="age" value="yes" type="checkbox" required className="mt-1 accent-[var(--ink)]" />
        <span>I am 18 or older and agree to the terms and privacy policy.</span>
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
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
