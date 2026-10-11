"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { deleteAccount, type DeleteState } from "@/app/(app)/settings/actions";

const ghostSm = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8rem] font-medium text-ink hover:bg-surface-2";

/** The "Delete account" row. Opens a confirm step that asks the person to type DELETE (Milin, 2026-10-10). */
export function DeleteAccount({ editable, icon }: { editable: boolean; icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, { error: null });
  const panelId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLInputElement>(null);

  return (
    <li className="flex flex-col">
      <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 min-[760px]:grid-cols-[34px_minmax(0,1fr)_auto]">
        <span className="grid size-[30px] place-items-center rounded-[10px] bg-surface-2 min-[760px]:size-[34px]">{icon}</span>
        <div className="min-w-0">
          <b className="text-[0.9rem] font-semibold">Delete account</b>
          <small className="block text-[0.78rem] text-muted">
            Removes your profile, resumes, goals and progress. You have 30 days to change your mind, then it&apos;s gone.
          </small>
        </div>
        <div className="col-start-2 justify-self-start min-[760px]:col-start-3">
          <button
            ref={opener}
            type="button"
            disabled={!editable}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setOpen((o) => !o);
              // Into the confirm step, once it shows.
              if (!open) requestAnimationFrame(() => confirm.current?.focus());
            }}
            className={`${ghostSm} disabled:opacity-60`}
          >
            Delete
          </button>
        </div>
      </div>
      <form id={panelId} hidden={!open} action={action} className="mx-3.5 mb-3.5 flex max-w-[460px] flex-col gap-2.5 rounded-[14px] border border-line bg-bg p-3.5">
        <p className="text-[0.86rem]">
          Your account is hidden at once and you are signed out. Sign in within 30 days to restore it. After that, everything is removed for good and
          can&apos;t be brought back.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">Type DELETE to confirm</span>
          <input
            ref={confirm}
            name="confirm"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-describedby={state.error ? `${panelId}-error` : undefined}
            className="w-40 rounded-md border border-line bg-surface px-3 py-[9px] font-mono text-[0.9rem] tracking-[0.1em] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
          />
        </label>
        {state.error && (
          <p id={`${panelId}-error`} role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className="rounded-full bg-ink px-3.5 py-1.5 text-[0.8rem] font-medium text-bg disabled:opacity-60">
            Delete my account
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              opener.current?.focus();
            }}
            className="rounded-full px-3 py-1.5 text-[0.8rem] font-medium text-muted"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}
