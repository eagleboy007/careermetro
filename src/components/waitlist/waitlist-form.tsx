"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function WaitlistForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role") || undefined,
          consent: form.get("consent") === "on",
          website: form.get("website"),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setState(data.ok ? { kind: "done" } : { kind: "error", message: data.error ?? "Something went wrong. Try again." });
    } catch {
      setState({ kind: "error", message: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-md bg-good-soft p-4 text-sm text-ink">
        <p className="font-semibold">You’re on the list.</p>
        <p className="text-muted">We’ll email you when the first roles open.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Email
          <input
            id="waitlist-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded-sm border border-line bg-surface px-3 py-2.5 font-normal text-ink"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Role you want next <span className="sr-only">(optional)</span>
          <input
            id="waitlist-role"
            name="role"
            placeholder="Data Analyst (optional)"
            className="rounded-sm border border-line bg-surface px-3 py-2.5 font-normal text-ink"
          />
        </label>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="flex items-start gap-2 text-sm text-muted">
        <input id="waitlist-consent" name="consent" type="checkbox" required className="mt-1 accent-[var(--accent)]" />
        Email me when CareerMetro opens. One email to confirm, then only launch news.
      </label>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-bad">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={state.kind === "sending"} className="self-start">
        {state.kind === "sending" ? "Joining…" : "Join the waitlist"}
      </Button>
    </form>
  );
}
