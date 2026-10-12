"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveBasics, type BasicsState } from "@/app/(app)/settings/actions";

const input =
  "min-w-0 rounded-md border border-line bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";

const initials = (first: string, last: string) => `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`.toUpperCase() || "?";

/** First and last name, with the sticky "unsaved changes" bar from the prototype while they differ from what's saved. */
export function BasicsForm({ firstName, lastName, editable, locked }: { firstName: string; lastName: string; editable: boolean; locked: boolean }) {
  const [state, action, pending] = useActionState<BasicsState, FormData>(saveBasics, { error: null, saved: false });
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  // The props are what's saved: a successful save refreshes the page, which passes the new names down.
  const dirty = first.trim().replace(/\s+/g, " ") !== firstName || last.trim().replace(/\s+/g, " ") !== lastName;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-base font-medium min-[760px]:size-[72px] min-[760px]:text-[1.2rem]">
          {initials(first, last)}
        </span>
        <div>
          <b className="text-[0.86rem]">Photo</b>
          <small className="mt-0.5 block text-[0.78rem] text-muted">Adding a photo comes soon. Until then your initials show on your profile and in people lists.</small>
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-3.5 min-[760px]:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">First name</span>
          <input name="firstName" aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "basics-error" : undefined} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" required maxLength={40} disabled={!editable} className={input} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">Last name</span>
          <input name="lastName" aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "basics-error" : undefined} value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" maxLength={40} disabled={!editable} className={input} />
        </label>
        <small className="text-[0.78rem] text-muted min-[760px]:col-span-2">
          {locked ? (
            <>
              We check a new resume shows this name before it joins your account, so it can&apos;t be changed here. To correct it, ask us from the{" "}
              <Link href="/grievances" className="text-ink underline underline-offset-2">
                Grievances page
              </Link>
              .
            </>
          ) : (
            "As it appears on your resume. We check a new resume shows this name before it joins your account. Once saved, it can't be changed here."
          )}
        </small>
      </div>
      {state.error && (
        <p id="basics-error" role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <p role="status" className="sr-only">
        {state.saved && !dirty && !pending ? "Saved." : ""}
      </p>
      {editable && dirty && (
        <div className="sticky bottom-[92px] z-10 flex items-center gap-2.5 rounded-[16px] bg-ink py-2.5 pl-[18px] pr-3 text-bg shadow-raised min-[760px]:bottom-4">
          <span className="mr-auto text-[0.88rem]">You have unsaved changes.</span>
          <button
            type="button"
            onClick={() => {
              setFirst(firstName);
              setLast(lastName);
            }}
            className="rounded-full px-3 py-1.5 text-[0.8rem] font-medium text-bg"
          >
            Discard
          </button>
          <button type="submit" disabled={pending} className="rounded-full bg-accent px-3.5 py-1.5 text-[0.8rem] font-medium text-on-accent disabled:opacity-60">
            Save changes
          </button>
        </div>
      )}
    </form>
  );
}
