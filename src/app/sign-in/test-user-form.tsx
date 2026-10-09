"use client";

import { FlaskConical } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { continueAsTestUser, type TestStep } from "./actions";

const field = "rounded-sm border border-line bg-surface px-3 py-2.5 font-normal text-ink";

/** The stand-in sign-in for preview links, until the real one has its keys. Nothing is checked. */
export function TestUserForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<TestStep, FormData>(continueAsTestUser, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Preview only</p>
      <p className="text-sm text-muted">
        Real sign-in (Google or an emailed code) isn&apos;t switched on yet. Type any name and email to try the signed-in screens. Nothing is
        checked, and this never appears on the live site.
      </p>
      <p className="text-sm text-muted">Please don&apos;t upload a real resume here: anyone who types the same email sees it.</p>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Name
        <input name="name" autoComplete="name" required maxLength={80} className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.error) || undefined}
          aria-describedby={state.error ? "test-user-error" : undefined}
          className={field}
        />
      </label>
      {state.error && (
        <p id="test-user-error" role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          <FlaskConical size={16} strokeWidth={1.75} aria-hidden="true" />
          Continue as test user
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
