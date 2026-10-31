"use client";

import { Plus, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ICON } from "@/components/map/map-parts";
import { Switch } from "@/components/ui/switch";
import type { EventSuggestionInput } from "@/lib/schemas";
import {
  EVENT_COST_MAX,
  EVENT_KIND_LABELS,
  EVENT_KINDS,
  EVENT_ORGANISER_MAX,
  EVENT_SUGGESTION_NOTE,
  EVENT_TITLE_MAX,
  EVENT_VENUE_MAX,
  PERSON_CITIES,
  type EventKind,
} from "@/lib/schemas/constants";

/** "Suggest an event" on the server (src/app/(app)/timetable/actions.ts): null when it was kept, or the words to show. */
export type SuggestEventAction = (form: EventSuggestionInput) => Promise<string | null>;

const SENT = "Thanks. It's saved and waiting for review. Nobody else sees it until then.";
const EXAMPLE = "Example only: nothing was sent.";
const FAILED = "That didn't work. Please try again.";

const field = "w-full min-w-0 rounded-sm border border-line-strong bg-surface px-3 py-2 text-[0.88rem] text-ink";
const fieldLabel = "text-[0.82rem] font-[550] text-ink";
const box = "flex min-w-0 flex-col gap-1";
const button = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.84rem] font-[550] aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
// Ink, not cobalt: sending a suggestion is not progress.
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line-strong bg-surface text-ink hover:bg-surface-2`;

export type SuggestEventFields = {
  url: string;
  title: string;
  organiser: string;
  kind: EventKind;
  online: boolean;
  city: string;
  venue: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  cost: string;
};

const EMPTY: SuggestEventFields = { url: "", title: "", organiser: "", kind: "meetup", online: false, city: "", venue: "", startDate: "", startTime: "", endDate: "", endTime: "", cost: "" };

/** The form as the action takes it: India date and time joined, an empty end date taking the start's, no city online. */
export function suggestionFromForm(f: SuggestEventFields): EventSuggestionInput {
  const online = f.online || f.kind === "online";
  return {
    url: f.url.trim(),
    title: f.title,
    organiser: f.organiser,
    kind: f.kind,
    startsAt: `${f.startDate}T${f.startTime}`,
    endsAt: `${f.endDate || f.startDate}T${f.endTime}`,
    online,
    city: online || !f.city ? null : (f.city as EventSuggestionInput["city"]),
    venue: online ? "" : f.venue,
    cost: f.cost,
  };
}

/**
 * "Know an event?" on the Timetable rail (Timetable PR 6, docs/plans/timetable-plan.md section 6): Suggest an event
 * opens a short form, the organiser's https link and the basic fields (name, organiser, kind, India start and end,
 * online or a city and area, cost in words). It says every time that suggestions are reviewed before they appear; for
 * now all of them wait, since member suggestions need a grievance officer. `pending` is how many of the person's own
 * wait. Without `action` (the example preview and /design) a send changes nothing and says so. Focus moves into the
 * form when it opens and back to its button when it closes; the result is announced in a polite live region.
 */
export function SuggestEventForm({ action, pending = 0, initialOpen = false }: { action?: SuggestEventAction; pending?: number; initialOpen?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(initialOpen);
  const [form, setForm] = useState<SuggestEventFields>(EMPTY);
  const [waiting, setWaiting] = useState(pending);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, start] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    (open ? first.current : opener.current)?.focus();
  }, [open]);

  const set = <K extends keyof SuggestEventFields>(key: K, value: SuggestEventFields[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (next: boolean) => {
    moved.current = true;
    setOpen(next);
    if (next) setMessage(null);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending) return;
    start(async () => {
      const error = action ? await action(suggestionFromForm(form)).catch(() => FAILED) : null;
      if (error) {
        setMessage(error);
        requestAnimationFrame(() => status.current?.focus());
        return;
      }
      setMessage(action ? SENT : EXAMPLE);
      if (action) setWaiting((n) => n + 1);
      setForm(EMPTY);
      toggle(false);
    });
  };

  const online = form.online || form.kind === "online";

  return (
    <div className="flex min-w-0 flex-col gap-3" data-suggest-event>
      <p className="text-[0.8rem] text-muted">{EVENT_SUGGESTION_NOTE}</p>
      {waiting > 0 && (
        <p className="text-[0.8rem] text-ink">
          {waiting === 1 ? "1 of your suggestions is" : `${waiting} of your suggestions are`} waiting for review. Other members don&apos;t see {waiting === 1 ? "it" : "them"}.
        </p>
      )}
      {!open && (
        <button ref={opener} type="button" className={`${ghost} self-start`} aria-expanded={false} aria-controls={`${id}-form`} onClick={() => toggle(true)}>
          <Plus {...ICON} size={15} />
          Suggest an event
        </button>
      )}
      {open && (
        <form id={`${id}-form`} aria-label="Suggest an event" className="flex min-w-0 flex-col gap-3" onSubmit={submit}>
          <Field label="Link to the organiser's page" htmlFor={`${id}-url`} hint="An https link. We check it by hand; we never open it from our servers.">
            <input
              ref={first}
              id={`${id}-url`}
              type="url"
              inputMode="url"
              required
              maxLength={2000}
              pattern="https://.*"
              placeholder="https://"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              className={field}
            />
          </Field>
          <Field label="Event name" htmlFor={`${id}-title`}>
            <input id={`${id}-title`} required maxLength={EVENT_TITLE_MAX} value={form.title} onChange={(e) => set("title", e.target.value)} className={field} />
          </Field>
          <Field label="Organiser" htmlFor={`${id}-organiser`}>
            <input id={`${id}-organiser`} required maxLength={EVENT_ORGANISER_MAX} value={form.organiser} onChange={(e) => set("organiser", e.target.value)} className={field} />
          </Field>
          <Field label="Kind" htmlFor={`${id}-kind`}>
            <select id={`${id}-kind`} value={form.kind} onChange={(e) => set("kind", e.target.value as EventKind)} className={field}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={`${fieldLabel} mb-1`}>Starts (India time)</legend>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Start date" type="date" required value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className={field} />
              <input aria-label="Start time" type="time" required value={form.startTime} onChange={(e) => set("startTime", e.target.value)} className={field} />
            </div>
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={`${fieldLabel} mb-1`}>Ends (India time)</legend>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="End date, if not the same day" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={field} />
              <input aria-label="End time" type="time" required value={form.endTime} onChange={(e) => set("endTime", e.target.value)} className={field} />
            </div>
            <small className="text-[0.76rem] text-muted">Leave the end date empty for a one-day event.</small>
          </fieldset>
          <Switch checked={online} disabled={form.kind === "online"} onChange={(next) => set("online", next)}>
            It&apos;s online
          </Switch>
          {!online && (
            <>
              <Field label="City" htmlFor={`${id}-city`}>
                <select id={`${id}-city`} required value={form.city} onChange={(e) => set("city", e.target.value)} className={field}>
                  <option value="">Pick a city</option>
                  {PERSON_CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Area (optional)" htmlFor={`${id}-venue`} hint="An area such as “Baner, Pune”. No street address.">
                <input id={`${id}-venue`} maxLength={EVENT_VENUE_MAX} value={form.venue} onChange={(e) => set("venue", e.target.value)} className={field} />
              </Field>
            </>
          )}
          <Field label="Cost (optional)" htmlFor={`${id}-cost`} hint="In words: “Free”, “₹200”. No payment links.">
            <input id={`${id}-cost`} maxLength={EVENT_COST_MAX} value={form.cost} onChange={(e) => set("cost", e.target.value)} className={field} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={solid} aria-disabled={sending || undefined}>
              <Send {...ICON} size={15} />
              Send for review
            </button>
            <button type="button" className={ghost} onClick={() => toggle(false)}>
              <X {...ICON} size={15} />
              Cancel
            </button>
          </div>
        </form>
      )}
      <p ref={status} tabIndex={-1} role="status" className="text-[0.8rem] text-ink outline-none">
        {message}
      </p>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className={box}>
      <label htmlFor={htmlFor} className={fieldLabel}>
        {label}
      </label>
      {children}
      {hint && <small className="text-[0.76rem] text-muted">{hint}</small>}
    </div>
  );
}
