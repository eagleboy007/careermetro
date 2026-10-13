"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { saveSettings, type SettingsState } from "@/app/(app)/settings/actions";
import { cleanHeadline, normalUsername } from "@/lib/account/username";
import type { SettingsField, UserSettings } from "@/lib/schemas";

/** What the part 2 settings form holds: pay as typed, so a half-typed number isn't lost. */
export type SettingsDraftValues = {
  username: string;
  headline: string;
  currentPay: string;
  expectedPay: string;
  settings: UserSettings;
};

type DraftContext = {
  draft: SettingsDraftValues;
  saved: SettingsDraftValues;
  editable: boolean;
  set: (patch: Partial<SettingsDraftValues>) => void;
  setSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  errors: Partial<Record<SettingsField, string>>;
};

const Context = createContext<DraftContext | null>(null);

export function useSettingsDraft(): DraftContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSettingsDraft outside SettingsDraft");
  return ctx;
}

/** The same values the server would keep, so typing a space or changing case back and forth isn't a change. */
const comparable = (v: SettingsDraftValues) =>
  JSON.stringify({ ...v, username: normalUsername(v.username), headline: cleanHeadline(v.headline), currentPay: v.currentPay.trim(), expectedPay: v.expectedPay.trim() });

/** Where focus goes when a save is refused: the first field with a message, in page order. */
const FIELD_ORDER: SettingsField[] = ["username", "headline", "currentPay", "expectedPay", "settings"];
const fieldElement = (field: SettingsField): HTMLElement | null =>
  field === "settings" ? document.querySelector<HTMLElement>('input[name="acc-visibility"]:checked') : document.getElementById(`acc-${field}`);

/**
 * Holds username, headline, pay, privacy and notifications across their sections of Account settings, and shows the
 * prototype's sticky "You have unsaved changes" bar while they differ from what's saved. One save sends them all; the
 * server refuses the whole save if any part is wrong, and the message shows beside that part.
 */
export function SettingsDraft({ initial, editable, children }: { initial: SettingsDraftValues; editable: boolean; children: ReactNode }) {
  const [state, action, pending] = useActionState<SettingsState, unknown>(saveSettings, { errors: {}, saved: false });
  const [draft, setDraft] = useState(initial);
  // A save refreshes the page, which passes the saved values down: start again from them.
  const [base, setBase] = useState(initial);
  if (comparable(base) !== comparable(initial)) {
    setBase(initial);
    setDraft(initial);
  }
  const dirty = comparable(draft) !== comparable(initial);
  const [discarded, setDiscarded] = useState(false);
  // The bar (and the button just pressed) goes once nothing is unsaved, so focus moves to the status line that says
  // what happened; a refused save moves it to the first field with a message instead.
  const status = useRef<HTMLParagraphElement>(null);
  const handled = useRef(state);
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.saved) return void status.current?.focus();
    const first = FIELD_ORDER.find((f) => state.errors[f]);
    if (first) fieldElement(first)?.focus();
  }, [state]);
  const ctx: DraftContext = {
    draft,
    saved: initial,
    editable,
    set: (patch) => {
      setDiscarded(false);
      setDraft((d) => ({ ...d, ...patch }));
    },
    setSetting: (key, value) => {
      setDiscarded(false);
      setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
    },
    errors: dirty || pending ? state.errors : {},
  };
  const errorCount = Object.keys(state.errors).length;

  return (
    <Context.Provider value={ctx}>
      {children}
      <p ref={status} tabIndex={-1} role="status" className="sr-only">
        {discarded ? "Changes discarded." : state.saved && !dirty && !pending ? "Settings saved." : ""}
      </p>
      {editable && dirty && (
        <div className="sticky bottom-[92px] z-10 flex flex-wrap items-center gap-2.5 rounded-[16px] bg-ink py-2.5 pl-[18px] pr-3 text-bg shadow-raised min-[760px]:bottom-4">
          <span className="mr-auto text-[0.88rem]" role={errorCount ? "alert" : undefined}>
            {errorCount ? "Nothing was saved. Check the messages above." : "You have unsaved changes."}
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(initial);
              setDiscarded(true);
              status.current?.focus();
            }}
            className="min-h-11 rounded-full px-3 text-[0.8rem] font-medium text-bg"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDiscarded(false);
              startTransition(() => action(draft));
            }}
            className="min-h-11 rounded-full bg-accent px-4 text-[0.8rem] font-medium text-on-accent disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

/** A field's message from the last save, tied to its input by id. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <small id={id} className="text-[0.78rem] text-bad">
      {message}
    </small>
  );
}
