"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ICON } from "@/components/map/map-parts";
import { FieldError } from "@/components/ui/field-error";
import { FoldToggle, useFold } from "@/components/ui/show-more";
import type { MeExperience, MeEducationItem, Story, StoryBox } from "@/lib/schemas";
import {
  INTEREST_MAX,
  ME_EDUCATION_TEXT_MAX,
  ME_EDUCATION_YEAR_MAX,
  ME_ROLE_TEXT_MAX,
  STORY_BOXES,
  STORY_PART_MAX,
  STORY_TITLE_MAX,
  STORY_WHERE_MAX,
} from "@/lib/schemas/constants";

/*
 * The forms behind Me's add controls (docs/plans/me-editing-plan.md, v44 gap item 23): "+ Add role", Education's
 * "+ Add", "+ Add story" and Interests' "+ Add". Each opens inline on the page, never in a modal. Save says "Saved." and
 * Cancel puts focus back on the control that opened it. The server checks everything again; nothing typed is logged.
 * Without actions (example data on /design and the signed-out preview) Save only closes the form.
 */

/** What a change on Me answers: null when it worked, or the words to show and the field they belong to. */
export type MeEditActionResult = { error: string | null; field?: string };

export type MeEditActions = {
  saveRole: (id: string | null, input: unknown) => Promise<MeEditActionResult>;
  deleteRole: (id: string) => Promise<MeEditActionResult>;
  saveEducation: (id: string | null, input: unknown) => Promise<MeEditActionResult>;
  deleteEducation: (id: string) => Promise<MeEditActionResult>;
  saveStory: (id: string | null, input: unknown) => Promise<MeEditActionResult>;
  deleteStory: (id: string) => Promise<MeEditActionResult>;
  addInterest: (name: string) => Promise<MeEditActionResult>;
  removeInterest: (name: string) => Promise<MeEditActionResult>;
};

const btn = "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] text-[0.86rem] font-[550] aria-disabled:opacity-60";
const primary = `${btn} bg-ink text-bg hover:opacity-90`;
const ghost = `${btn} border border-line bg-surface text-ink hover:bg-surface-2`;
const field = "w-full min-w-0 rounded-sm border border-line-strong bg-surface px-3 py-2 text-[0.88rem] text-ink";
const fieldLabel = "text-[0.84rem] font-[550]";
/** A field's label, control, count and message, stacked. The label holds only its words, so the control's name stays plain. */
const fieldBox = "flex min-w-0 flex-col gap-1";
/** The small links on a row: Edit and Delete. */
export const rowLink = "inline-flex min-h-11 items-center text-[0.8rem] font-[550] text-muted underline-offset-2 hover:text-ink hover:underline aria-disabled:opacity-60";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One run of a change: pending while it runs, the error it answered, and a done callback. */
function useSave() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const run = async (call: Promise<MeEditActionResult> | null, done: () => void) => {
    if (pending) return;
    if (!call) return done();
    setPending(true);
    setError(null);
    try {
      const out = await call;
      if (out.error) setError({ text: out.error, field: out.field });
      else done();
    } catch {
      setError({ text: "That didn't work. Please try again." });
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

/** The frame of an inline form: a heading, the fields, a message not tied to one field, then Save and Cancel. */
function Frame({
  title,
  onSubmit,
  onCancel,
  pending,
  error,
  children,
}: {
  title: string;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) onSubmit();
  };
  // No accessible name on the form, so it isn't a landmark: /design shows several at once.
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-3.5">
      <h4 className="text-[0.95rem] font-semibold">
        {title}
      </h4>
      {children}
      {error && (
        <p role="alert" className="text-[0.82rem] text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primary} aria-disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A text field with its label and its own error, if the last save named it. */
function TextField({
  name,
  label,
  value,
  onChange,
  max,
  error,
  placeholder,
  autoFocus = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  error?: { text: string; field?: string } | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const mine = error?.field === name ? error.text : undefined;
  return (
    <div className={fieldBox}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        className={field}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={mine ? true : undefined}
        aria-describedby={mine ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError id={`${id}-error`} message={mine} />
    </div>
  );
}

const noSubscribe = () => () => {};
const thisYear = () => new Date().getFullYear();
const noYear = () => null;

/** A month and a year as two selects, sent as "2024-06"; "" until both are picked. */
function MonthField({
  name,
  legend,
  value,
  onChange,
  disabled = false,
  error,
}: {
  name: string;
  legend: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: { text: string; field?: string } | null;
}) {
  const id = useId();
  const [year, month] = value ? value.split("-") : ["", ""];
  // The year is read only in the browser; while prerendering (/design) the list holds just the picked year.
  const now = useSyncExternalStore(noSubscribe, thisYear, noYear);
  const years = now ? Array.from({ length: now - 1969 }, (_, i) => String(now - i)) : year ? [year] : [];
  // Half picked is sent as it is ("2024-"), and the server answers "Pick a month and year."
  const set = (y: string, m: string) => onChange(y || m ? `${y}-${m}` : "");
  const mine = error?.field === name ? error.text : undefined;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled} aria-describedby={mine ? `${id}-error` : undefined}>
      <legend className="mb-1 text-[0.84rem] font-[550]">{legend}</legend>
      <div className="flex gap-2">
        <select aria-label={`${legend}, month`} className={field} value={month} onChange={(e) => set(year, e.target.value)}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, "0")}>
              {m}
            </option>
          ))}
        </select>
        <select aria-label={`${legend}, year`} className={field} value={year} onChange={(e) => set(e.target.value, month)}>
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <FieldError id={`${id}-error`} message={mine} />
    </fieldset>
  );
}

/** "+ Add role" and Edit on an added role: Job title, Company, Started, Ended and "I work here now". */
export function RoleForm({
  role,
  onSave,
  onDone,
  onCancel,
  focus = true,
}: {
  role?: MeExperience;
  /** Focus the first field on open; false on /design, where several show at once. */
  focus?: boolean;
  onSave?: (input: unknown) => Promise<MeEditActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(role?.title ?? "");
  const [employer, setEmployer] = useState(role?.employer ?? "");
  const [startMonth, setStart] = useState(role?.added?.startMonth ?? "");
  const [endMonth, setEnd] = useState(role?.added?.endMonth ?? "");
  const [isCurrent, setCurrent] = useState(role ? role.current : false);
  const { pending, error, run } = useSave();
  const save = () =>
    run(onSave?.({ title, employer, startMonth: startMonth || "", endMonth: isCurrent ? null : endMonth || null, isCurrent }) ?? null, onDone);
  const general = error && !["title", "employer", "startMonth", "endMonth"].includes(error.field ?? "") ? error.text : null;
  return (
    <Frame title={role ? "Edit role" : "Add a role"} onSubmit={save} onCancel={onCancel} pending={pending} error={general}>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <TextField name="title" label="Job title" value={title} onChange={setTitle} max={ME_ROLE_TEXT_MAX} error={error} autoFocus={focus} />
        <TextField name="employer" label="Company" value={employer} onChange={setEmployer} max={ME_ROLE_TEXT_MAX} error={error} />
        <MonthField name="startMonth" legend="Started" value={startMonth} onChange={setStart} error={error} />
        <MonthField name="endMonth" legend="Ended" value={isCurrent ? "" : endMonth} onChange={setEnd} disabled={isCurrent} error={error} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-[0.86rem]">
        <input type="checkbox" className="size-4 accent-ink" checked={isCurrent} onChange={(e) => setCurrent(e.target.checked)} />I work here now
      </label>
      {isCurrent && <p className="text-[0.78rem] text-muted">Only one role can be current. Ticking it here ends any other current role you added.</p>}
    </Frame>
  );
}

/** Education's "+ Add" and Edit: Qualification, Institution and Year. */
export function EducationForm({
  item,
  onSave,
  onDone,
  onCancel,
  focus = true,
}: {
  item?: MeEducationItem;
  focus?: boolean;
  onSave?: (input: unknown) => Promise<MeEditActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [qualification, setQualification] = useState(item?.qualification ?? "");
  const [institution, setInstitution] = useState(item?.institution ?? "");
  const [year, setYear] = useState(item?.year ?? "");
  const { pending, error, run } = useSave();
  const save = () => run(onSave?.({ qualification, institution, year }) ?? null, onDone);
  const general = error && !["qualification", "institution", "year"].includes(error.field ?? "") ? error.text : null;
  return (
    <Frame title={item ? "Edit education" : "Add education"} onSubmit={save} onCancel={onCancel} pending={pending} error={general}>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <TextField name="qualification" label="Qualification" value={qualification} onChange={setQualification} max={ME_EDUCATION_TEXT_MAX} error={error} autoFocus={focus} />
        <TextField name="institution" label="Institution" value={institution} onChange={setInstitution} max={ME_EDUCATION_TEXT_MAX} error={error} />
        <TextField name="year" label="Year" value={year} onChange={setYear} max={ME_EDUCATION_YEAR_MAX} error={error} placeholder="2024, or 2021 to 2024" />
      </div>
    </Frame>
  );
}

/** One of Situation, Task, Action, Result: a box of up to 400 characters with a live count. */
function PartField({ name, label, value, onChange, error }: { name: string; label: string; value: string; onChange: (v: string) => void; error?: { text: string; field?: string } | null }) {
  const id = useId();
  const mine = error?.field === name ? error.text : undefined;
  return (
    <div className={fieldBox}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        className={`${field} resize-y`}
        value={value}
        maxLength={STORY_PART_MAX}
        aria-invalid={mine ? true : undefined}
        aria-describedby={`${id}-count${mine ? ` ${id}-error` : ""}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <small id={`${id}-count`} className="self-end font-mono text-[0.7rem] font-normal text-muted">
        {value.length} of {STORY_PART_MAX}
      </small>
      <FieldError id={`${id}-error`} message={mine} />
    </div>
  );
}

/** "+ Add story" and Edit: hand-written in v1, with the boxes it answers and an optional goal. */
export function StoryForm({
  story,
  goals,
  onSave,
  onDone,
  onCancel,
  focus = true,
}: {
  story?: Story;
  focus?: boolean;
  goals: { id: string; name: string }[];
  onSave?: (input: unknown) => Promise<MeEditActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(story?.title ?? "");
  const [where, setWhere] = useState(story?.where ?? "");
  const [situation, setSituation] = useState(story?.situation ?? "");
  const [task, setTask] = useState(story?.task ?? "");
  const [action, setAction] = useState(story?.action ?? "");
  const [result, setResult] = useState(story?.result ?? "");
  const [boxes, setBoxes] = useState<StoryBox[]>(story?.boxes ?? []);
  const [goalId, setGoalId] = useState(story?.goalId ?? "");
  const { pending, error, run } = useSave();
  const boxesId = useId();
  const toggle = (b: StoryBox) => setBoxes((now) => (now.includes(b) ? now.filter((x) => x !== b) : [...now, b]));
  const save = () => run(onSave?.({ title, where, situation, task, action, result, boxes, goalId: goalId || null }) ?? null, onDone);
  const fields = ["title", "where", "situation", "task", "action", "result", "boxes"];
  const general = error && !fields.includes(error.field ?? "") ? error.text : null;
  const boxesError = error?.field === "boxes" ? error.text : undefined;
  return (
    <Frame title={story ? "Edit story" : "Add a story"} onSubmit={save} onCancel={onCancel} pending={pending} error={general}>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <TextField name="title" label="Title" value={title} onChange={setTitle} max={STORY_TITLE_MAX} error={error} autoFocus={focus} />
        <TextField name="where" label="Where and when" value={where} onChange={setWhere} max={STORY_WHERE_MAX} error={error} placeholder="Konkan Co-operative Bank · 2025" />
      </div>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <PartField name="situation" label="Situation" value={situation} onChange={setSituation} error={error} />
        <PartField name="task" label="Task" value={task} onChange={setTask} error={error} />
        <PartField name="action" label="Action" value={action} onChange={setAction} error={error} />
        <PartField name="result" label="Result" value={result} onChange={setResult} error={error} />
      </div>
      <div role="group" aria-labelledby={`${boxesId}-label`} aria-describedby={boxesError ? `${boxesId}-error` : undefined} className="flex flex-col gap-1.5">
        <span id={`${boxesId}-label`} className="text-[0.84rem] font-[550]">
          Boxes it answers <small className="font-normal text-muted">at least one</small>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {STORY_BOXES.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={boxes.includes(b)}
              onClick={() => toggle(b)}
              className="min-h-11 rounded-full border border-line-strong px-3 text-[0.8rem] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg"
            >
              {b}
            </button>
          ))}
        </div>
        <FieldError id={`${boxesId}-error`} message={boxesError} />
      </div>
      {goals.length > 0 && (
        <div className={fieldBox}>
          <label htmlFor={`${boxesId}-goal`} className={fieldLabel}>
            From a goal
          </label>
          <select id={`${boxesId}-goal`} name="goalId" className={field} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </Frame>
  );
}

/** "Delete this story?" with Delete and Keep, inline. Keep puts focus back on the Delete link that asked. */
export function ConfirmDelete({
  question,
  onDelete,
  onDeleted,
  onKeep,
  focus = true,
}: {
  question: string;
  onDelete?: () => Promise<MeEditActionResult>;
  onDeleted: () => void;
  onKeep: () => void;
  focus?: boolean;
}) {
  const { pending, error, run } = useSave();
  const first = useRef<HTMLButtonElement>(null);
  // The question replaces nothing, but focus moves to it so Delete or Keep is one key away.
  useEffect(() => {
    if (focus) first.current?.focus();
  }, [focus]);
  return (
    <div role="group" aria-label={question} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <p className="text-[0.86rem] font-[550]">{question}</p>
      {error && (
        <p role="alert" className="text-[0.82rem] text-bad">
          {error.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button ref={first} type="button" className={primary} aria-disabled={pending} onClick={() => run(onDelete?.() ?? null, onDeleted)}>
          Delete
        </button>
        <button type="button" className={ghost} onClick={onKeep}>
          Keep
        </button>
      </div>
    </div>
  );
}

/** Interests: chips with a remove ×, and "Add an interest, e.g. Photography" with Add (the prototype's). */
export function InterestsEditor({ interests, onAdd, onRemove, say }: { interests: string[]; onAdd?: (name: string) => Promise<MeEditActionResult>; onRemove?: (name: string) => Promise<MeEditActionResult>; say: (text: string) => void }) {
  // With actions the list is the server's, sent again after each change; example data keeps its own copy.
  const [local, setLocal] = useState(interests);
  const shown = onAdd ? interests : local;
  // Newest added first, folded to 3 (C23): the one just added always shows.
  const fold = useFold([...shown].reverse());
  const listId = useId();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { pending, error, setError, run } = useSave();
  const errorId = useId();
  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = text.replace(/\s+/g, " ").trim();
    if (!name) {
      setError({ text: "Type an interest first.", field: "name" });
      input.current?.focus();
      return;
    }
    run(onAdd?.(name) ?? null, () => {
      if (!onAdd) setLocal((now) => [...now, name]);
      setText("");
      say("Saved.");
      input.current?.focus();
    });
  };
  const remove = (name: string) =>
    run(onRemove?.(name) ?? null, () => {
      if (!onRemove) setLocal((now) => now.filter((n) => n !== name));
      say(`Removed ${name}.`);
      // The chip pressed goes away, so focus moves to the box, never to the page.
      input.current?.focus();
    });
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <ul id={listId} className="flex flex-wrap gap-1.5" aria-label="Your interests">
          {fold.shown.map((t) => (
            <li key={t} className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-0.5 text-[0.78rem]">
              {t}
              <button type="button" aria-label={`Remove ${t}`} aria-disabled={pending} onClick={() => remove(t)} className="grid size-8 place-items-center rounded-full text-muted hover:text-ink">
                <X size={14} {...ICON} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <FoldToggle fold={fold} noun="interests" controls={listId} />
      <form onSubmit={add} className="flex flex-wrap items-start gap-2">
        <input
          ref={input}
          type="text"
          className={`${field} min-w-[200px] flex-1`}
          placeholder="Add an interest, e.g. Photography"
          aria-label="Add an interest"
          value={text}
          maxLength={INTEREST_MAX}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={ghost} aria-disabled={pending}>
          Add
        </button>
      </form>
      <FieldError id={errorId} message={error?.text} />
    </div>
  );
}

/** The "Saved." toast, read out by screen readers, the same as the Library's. */
export function useToast(): [ReactNode, (text: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string) => {
    // Cleared first, so the same words twice are read out twice.
    setToast(null);
    requestAnimationFrame(() => setToast(text));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  };
  const node = (
    <p
      role="status"
      className={`pointer-events-none fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-[0.84rem] font-[550] text-bg transition-opacity min-[700px]:rounded-full min-[760px]:bottom-6 ${toast ? "opacity-100" : "opacity-0"}`}
    >
      {toast}
    </p>
  );
  return [node, say];
}

/**
 * Me editing's states for /design, with example data: each form open (a new role and an added one, education, a new
 * story and one being edited), the delete question and the interests editor. Nothing saves.
 */
export function MeEditGallery({ role, education, story, goals }: { role: MeExperience; education: MeEducationItem; story: Story; goals: { id: string; name: string }[] }) {
  const [toast, say] = useToast();
  const done = () => say("Example data, so nothing saves.");
  const none = () => {};
  return (
    <div className="grid gap-4 min-[760px]:grid-cols-2">
      <RoleForm onDone={done} onCancel={none} focus={false} />
      <RoleForm role={role} onDone={done} onCancel={none} focus={false} />
      <EducationForm item={education} onDone={done} onCancel={none} focus={false} />
      <div className="flex flex-col gap-4">
        <ConfirmDelete question="Delete this story?" onDeleted={done} onKeep={none} focus={false} />
        <InterestsEditor interests={["Data", "Cricket stats", "Public speaking"]} say={say} />
      </div>
      <StoryForm goals={goals} onDone={done} onCancel={none} focus={false} />
      <StoryForm story={story} goals={goals} onDone={done} onCancel={none} focus={false} />
      {toast}
    </div>
  );
}
