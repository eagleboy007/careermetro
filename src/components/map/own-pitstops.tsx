"use client";

import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { smallButton } from "@/components/gaps/job-check-actions";
import { actionFailed, readApiReply } from "@/lib/api-reply";
import { OWN_PITSTOP_TITLE_MAX, OWN_PITSTOPS_PER_GOAL } from "@/lib/schemas/constants";
import type { MapGoal, OwnPitstop, OwnPitstopOption } from "@/lib/schemas";
import { ICON, Label, Panel } from "./map-parts";

/*
 * Add a pitstop on the Map (FR-58; handoff section 7, spurs labelled ADDED BY YOU). A pitstop of the person's own is an
 * extra halt on one of their open goals: a name and, if they like, one of the free catalog courses offered for the goal.
 * It gets them ready and never fills the gap, moves the train or changes the match. Neutral colours only: it is not
 * progress and not a gap status. `demo` saves nothing (example data on /design and the preview).
 */

const field =
  "min-w-0 rounded-md border border-line-strong bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";
const primary = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[0.84rem] font-semibold text-bg hover:opacity-90 aria-disabled:opacity-60";
const DEMO = "This is example data, so nothing is saved.";

/** The key a goal is picked by: its id, or its skill in example data (which has no ids). */
export const goalKey = (g: MapGoal) => g.goalId ?? g.skillId;

/** Goals that take a new pitstop: open (not proved, not skipped), and saved goals unless this is example data. */
export function addableGoals(goals: MapGoal[], demo: boolean): MapGoal[] {
  return goals.filter((g) => !g.proved && !g.skipped && (demo || g.goalId) && (g.ownPitstops?.length ?? 0) < OWN_PITSTOPS_PER_GOAL);
}

type Sent = { ok: true } | { ok: false; error: string };

/** Sends one add, edit or remove. Answers ok, or the words to show (never the name typed, which the server never echoes). */
async function send(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Sent> {
  try {
    const reply = await readApiReply(
      await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
    return reply.ok ? { ok: true } : { ok: false, error: reply.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: actionFailed() };
  }
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s);

/**
 * The form for a new pitstop or a change to one: which goal (new only), its name, and a free course or none. Choosing
 * a course while the name is empty fills the name with the course's title.
 */
export function PitstopForm({
  goals,
  initialGoal,
  editing,
  demo,
  onSaved,
  onCancel,
}: {
  /** Goals to pick from (a new pitstop). One goal when editing. */
  goals: MapGoal[];
  initialGoal?: string;
  /** The pitstop being changed; absent for a new one. */
  editing?: OwnPitstop;
  demo: boolean;
  onSaved: (goal: MapGoal, title: string, withCourse: boolean) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [goal, setGoal] = useState(() => initialGoal ?? (goals[0] ? goalKey(goals[0]) : ""));
  const [title, setTitle] = useState(editing?.title ?? "");
  const [course, setCourse] = useState<string>(editing?.course?.id ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const picked = goals.find((g) => goalKey(g) === goal) ?? goals[0];
  // Editing keeps the course already picked on offer, even if it is no longer among the next unused ones.
  const options: OwnPitstopOption[] = [
    ...(editing?.course && !(picked?.pitstopOptions ?? []).some((o) => o.id === editing.course!.id) ? [editing.course] : []),
    ...(picked?.pitstopOptions ?? []),
  ];

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !picked) return;
    setError("");
    const name = title.replace(/\s+/g, " ").trim();
    if (!name) {
      setError(`Give it a name of 1 to ${OWN_PITSTOP_TITLE_MAX} characters.`);
      nameRef.current?.focus();
      return;
    }
    if (demo || !picked.goalId) {
      setError(DEMO);
      return;
    }
    setSending(true);
    const resourceId = course || null;
    const sent = editing
      ? await send("PATCH", `/api/pitstops/${editing.id}`, { title: name, resourceId })
      : await send("POST", "/api/pitstops", { goalId: picked.goalId, title: name, resourceId });
    setSending(false);
    if (!sent.ok) {
      setError(sent.error);
      return;
    }
    onSaved(picked, name, Boolean(resourceId));
  }

  return (
    <form
      onSubmit={save}
      noValidate
      className="flex flex-col gap-3 rounded-[14px] border border-line p-3 text-[0.86rem]"
      // Escape closes a change as Cancel does. An open select's list takes Escape first.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !onCancel || e.defaultPrevented || sending) return;
        e.preventDefault();
        onCancel();
      }}
    >
      {!editing && goals.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Goal</span>
          <select
            className={field}
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setCourse("");
            }}
          >
            {goals.map((g) => (
              <option key={goalKey(g)} value={goalKey(g)}>
                {g.choice ? `${g.name} (Your choice)` : g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="font-medium">
          Name
        </label>
        <input
          id={`${id}-name`}
          ref={nameRef}
          className={field}
          value={title}
          maxLength={OWN_PITSTOP_TITLE_MAX}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          aria-invalid={Boolean(error) && !title.trim() ? true : undefined}
          placeholder="e.g. Blue team labs"
          onChange={(e) => setTitle(e.target.value)}
        />
        <span id={`${id}-hint`} className="text-[0.78rem] text-muted">
          In words, up to {OWN_PITSTOP_TITLE_MAX} characters. Links aren&apos;t kept; pick a free course below instead.
        </span>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-medium">A free course for it (optional)</legend>
        {options.map((o) => (
          <label key={o.id} className="flex items-start gap-2 rounded-md bg-surface-2 px-[11px] py-[9px]">
            <input
              type="radio"
              name={`${id}-course`}
              value={o.id}
              checked={course === o.id}
              onChange={() => {
                setCourse(o.id);
                if (!title.trim()) setTitle(clip(o.title, OWN_PITSTOP_TITLE_MAX));
              }}
              className="mt-1 accent-ink"
            />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {o.title}
              <small className="block font-mono text-[0.7rem] text-muted">{o.detail}</small>
            </span>
          </label>
        ))}
        <label className="flex items-center gap-2 px-[11px] py-1">
          <input type="radio" name={`${id}-course`} value="" checked={course === ""} onChange={() => setCourse("")} className="accent-ink" />
          <span>{options.length ? "No course" : "No course (no other free course on our list for this goal yet)"}</span>
        </label>
      </fieldset>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" aria-disabled={sending} className={primary}>
          {sending ? "Saving…" : editing ? "Save pitstop" : "Add pitstop"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={smallButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The panel for "Add a pitstop": the prototype's sheet, with the person's open goals to pick from. */
export function AddPitstopPanel({
  goals,
  initialGoal,
  demo,
  onSaved,
}: {
  goals: MapGoal[];
  initialGoal?: string;
  demo: boolean;
  onSaved: (goal: MapGoal, title: string, withCourse: boolean) => void;
}) {
  return (
    <Panel kicker="Add a pitstop" title="Where do you want to halt?">
      <p>
        Pick one of your goals and name a halt on the way: labs, a book, a small project. Free courses and videos get you ready; only a prove pitstop fills
        the gap. Your destination, your train and your match stay the same.
      </p>
      {goals.length ? (
        <PitstopForm goals={goals} initialGoal={initialGoal} demo={demo} onSaved={onSaved} />
      ) : (
        <p>Every open goal has {OWN_PITSTOPS_PER_GOAL} pitstops of your own, or none is open. Remove one to add another.</p>
      )}
    </Panel>
  );
}

/**
 * One goal's own pitstops (the panel for its spur, and from a Your choice goal): each with its course, Edit and Remove,
 * and Add another while the goal is open and under the limit.
 */
export function OwnPitstopsPanel({
  goal,
  demo,
  onAdd,
  onChanged,
}: {
  goal: MapGoal;
  demo: boolean;
  /** Opens "Add a pitstop" for this goal; absent when it takes no more. */
  onAdd?: () => void;
  onChanged: (note: string) => void;
}) {
  const own = goal.ownPitstops ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Cancel (or Escape) on a change closes its form; focus goes back to that pitstop's Edit button, never to the page.
  const list = useRef<HTMLUListElement>(null);
  const backTo = useRef<string | null>(null);
  useEffect(() => {
    if (!backTo.current || editing) return;
    list.current?.querySelector<HTMLElement>(`[data-edit-pitstop="${CSS.escape(backTo.current)}"]`)?.focus();
    backTo.current = null;
  }, [editing]);

  async function remove(p: OwnPitstop) {
    if (removing) return;
    setError("");
    if (demo || !goal.goalId) {
      setError(DEMO);
      return;
    }
    setRemoving(p.id);
    const sent = await send("DELETE", `/api/pitstops/${p.id}`);
    setRemoving(null);
    if (!sent.ok) return setError(sent.error);
    onChanged("Removed. Your line is shorter again.");
  }

  return (
    <Panel kicker={`Added by you · ${goal.name} goal`} title={`Your pitstops on ${goal.name}`}>
      <p>
        Halts you added on the way to this goal. They get you ready; {goal.choice ? "its" : "the"} prove pitstop still fills the gap. They never move your
        train or change your match.
      </p>
      {own.length ? (
        <ul ref={list} className="flex flex-col gap-2">
          {own.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3 text-[0.86rem]">
              <div className="flex items-start gap-2.5">
                <BookOpen size={16} className="mt-0.5 shrink-0 text-muted" {...ICON} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <b className="font-semibold">{p.title}</b>
                  <small className="block font-mono text-[0.7rem] text-muted">{p.course ? `${p.course.title} · ${p.course.detail}` : "No course picked"}</small>
                </span>
              </div>
              {editing === p.id ? (
                <PitstopForm
                  goals={[goal]}
                  editing={p}
                  demo={demo}
                  onCancel={() => {
                    backTo.current = p.id;
                    setEditing(null);
                  }}
                  onSaved={() => {
                    setEditing(null);
                    onChanged("Pitstop saved.");
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-edit-pitstop={p.id} onClick={() => setEditing(p.id)} aria-label={`Edit pitstop: ${p.title}`} className={smallButton}>
                    <Pencil size={14} {...ICON} />
                    Edit
                  </button>
                  <button type="button" aria-disabled={removing !== null} onClick={() => remove(p)} aria-label={`Remove this pitstop: ${p.title}`} className={`${smallButton} aria-disabled:opacity-60`}>
                    <Trash2 size={14} {...ICON} />
                    {removing === p.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No pitstops of your own on this goal.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      {onAdd ? (
        <div className="flex">
          <button type="button" onClick={onAdd} className={smallButton}>
            <Plus size={14} {...ICON} />
            {own.length ? "Add another pitstop" : "Add a pitstop"}
          </button>
        </div>
      ) : (
        own.length >= OWN_PITSTOPS_PER_GOAL && <Label>Up to {OWN_PITSTOPS_PER_GOAL} pitstops of your own a goal</Label>
      )}
    </Panel>
  );
}
