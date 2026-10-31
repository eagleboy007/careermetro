"use client";

import { Check, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { FieldError } from "@/components/ui/field-error";
import { Switch } from "@/components/ui/switch";
import type { ComposerActions } from "@/lib/junction/types";
import { INTEREST_MAX, JUNCTION_BODY_MAX, JUNCTION_POST_KIND_LABELS, JUNCTION_POST_KINDS, JUNCTION_TAGS_MAX, JUNCTION_TITLE_MAX, type JunctionPostKind } from "@/lib/schemas/constants";
import type { GoalLineView } from "@/lib/schemas/junction";
import { GoalLine } from "./post-card";
import { card, field, ghost, ICON, ink, label } from "./styles";

const FAILED = "That didn't work. Please try again.";

export type ComposerProps = {
  routeLabel: string | null;
  interests: { id: string; name: string }[];
  goal: GoalLineView | null;
};

const KIND_HINT: Record<JunctionPostKind, string> = {
  idea: "Something you tried or would try",
  question: "Ask people on the same road",
  win: "A goal met, an interview, a first project",
  resource: "A free course, video or doc, with its link",
};

/**
 * Write a post (plan section 1, JunctionComposer): Idea, Question, Win or Resource; a title (5 to 140) and an optional
 * body (up to 2,000), plain text; Post to My route and/or up to 3 interests (yours, or a new one typed here); one link
 * (needed for a Resource); and "Show where I am on my line", off by default, drawn live from the goal ids. Nothing from
 * the resume, gaps or path is copied in. Without actions (/design) nothing is sent.
 */
export function JunctionComposer({ data, actions }: { data: ComposerProps; actions?: ComposerActions }) {
  const ids = useId();
  const [kind, setKind] = useState<JunctionPostKind>("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [toRoute, setToRoute] = useState(!!data.routeLabel);
  const [picked, setPicked] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [showGoal, setShowGoal] = useState(false);
  const [error, setError] = useState<{ text: string; field: "title" | "body" | "link" | "audience" | "form" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const tags = picked.length + fresh.length;
  const full = tags >= JUNCTION_TAGS_MAX;

  const toggleTag = (id: string) => {
    if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
    else if (!full) setPicked([...picked, id]);
  };
  const addFresh = () => {
    const name = newTag.replace(/\s+/g, " ").trim();
    if (!name || full) return;
    const known = data.interests.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (known) {
      if (!picked.includes(known.id)) setPicked([...picked, known.id]);
    } else if (!fresh.some((f) => f.toLowerCase() === name.toLowerCase())) setFresh([...fresh, name]);
    setNewTag("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (title.trim().length < 5) {
      setError({ text: `Write a title of 5 to ${JUNCTION_TITLE_MAX} characters.`, field: "title" });
      titleRef.current?.focus();
      return;
    }
    if (!toRoute && tags === 0) {
      setError({ text: "Pick My route or at least one interest, so the post has readers.", field: "audience" });
      return;
    }
    if (kind === "resource" && !link.trim()) {
      setError({ text: "A Resource post needs its link.", field: "link" });
      return;
    }
    start(async () => {
      const input = { kind, title, body, link, toRoute, interestIds: picked, newInterests: fresh, showGoal };
      const r = actions ? await actions.create(input).catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const };
      if (!r.ok) {
        setError({ text: r.message, field: "form" });
        setDone(null);
        return;
      }
      setTitle("");
      setBody("");
      setLink("");
      setPicked([]);
      setFresh([]);
      setShowGoal(false);
      setError(null);
      setDone(actions ? "Posted. It is on Junction now." : "Example only: nothing was posted.");
      titleRef.current?.focus();
    });
  };

  const err = (f: "title" | "body" | "link" | "audience") => (error?.field === f ? `${ids}-e` : undefined);
  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-h`} className={card} noValidate>
      <h2 id={`${ids}-h`} className="text-[1.08rem] font-semibold">
        Write a post
      </h2>
      <div role="group" aria-label="Kind of post" className="flex flex-wrap gap-1.5">
        {JUNCTION_POST_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} title={KIND_HINT[k]} onClick={() => setKind(k)} className={`${ghost} aria-pressed:border-line-strong aria-pressed:bg-surface-2 aria-pressed:font-semibold`}>
            {kind === k && <Check {...ICON} />}
            {JUNCTION_POST_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <p className="text-[0.78rem] text-muted">{KIND_HINT[kind]}.</p>
      <label htmlFor={`${ids}-t`} className="text-[0.84rem] font-semibold">
        Title
      </label>
      <input
        id={`${ids}-t`}
        ref={titleRef}
        className={field}
        value={title}
        maxLength={JUNCTION_TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        aria-invalid={error?.field === "title" || undefined}
        aria-describedby={[`${ids}-tc`, err("title")].filter(Boolean).join(" ")}
        placeholder="How do I read a Splunk alert without getting lost?"
      />
      <small id={`${ids}-tc`} className="text-[0.76rem] text-muted">
        {title.length} of {JUNCTION_TITLE_MAX} characters
      </small>
      <label htmlFor={`${ids}-b`} className="text-[0.84rem] font-semibold">
        Text (optional)
      </label>
      <textarea
        id={`${ids}-b`}
        rows={4}
        className={field}
        value={body}
        maxLength={JUNCTION_BODY_MAX}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${ids}-bc`}
      />
      <small id={`${ids}-bc`} className="text-[0.76rem] text-muted">
        {body.length.toLocaleString("en-IN")} of {JUNCTION_BODY_MAX.toLocaleString("en-IN")} characters. Plain text; line breaks are kept.
      </small>
      <label htmlFor={`${ids}-l`} className="text-[0.84rem] font-semibold">
        Link {kind === "resource" ? "(needed for a Resource)" : "(optional, one)"}
      </label>
      <input
        id={`${ids}-l`}
        type="url"
        inputMode="url"
        className={field}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        aria-invalid={error?.field === "link" || undefined}
        aria-describedby={[`${ids}-lh`, err("link")].filter(Boolean).join(" ")}
        placeholder="https://"
      />
      <small id={`${ids}-lh`} className="text-[0.76rem] text-muted">
        A full https link to the page itself. A link to a Library item shows its card.
      </small>

      <fieldset className="flex flex-col gap-2" aria-describedby={err("audience")}>
        <legend className={`${label} mb-1`}>Post to</legend>
        <div className="flex flex-wrap gap-1.5">
          <label className={`${ghost} cursor-pointer has-checked:border-line-strong has-checked:bg-surface-2 has-disabled:cursor-not-allowed has-disabled:opacity-60`}>
            <input type="checkbox" className="accent-ink" checked={toRoute} disabled={!data.routeLabel} onChange={(e) => setToRoute(e.target.checked)} />
            My route{data.routeLabel ? `: ${data.routeLabel}` : ""}
          </label>
          {data.interests.map((t) => (
            <label key={t.id} className={`${ghost} cursor-pointer has-checked:border-line-strong has-checked:bg-surface-2`}>
              <input type="checkbox" className="accent-ink" checked={picked.includes(t.id)} onChange={() => toggleTag(t.id)} aria-disabled={(!picked.includes(t.id) && full) || undefined} />
              {t.name}
            </label>
          ))}
          {fresh.map((name) => (
            <label key={name} className={`${ghost} cursor-pointer border-line-strong bg-surface-2`}>
              <input type="checkbox" className="accent-ink" checked onChange={() => setFresh(fresh.filter((f) => f !== name))} />
              {name} (new)
            </label>
          ))}
        </div>
        {!data.routeLabel && (
          <small className="text-[0.76rem] text-muted">
            My route needs a resume. <Link href="/today" className="font-semibold text-ink underline underline-offset-2">Add yours on Today</Link>, or pick an interest.
          </small>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <input
            type="text"
            className={`${field} min-w-[180px] flex-1`}
            aria-label="Add another interest to this post"
            placeholder="Another interest, e.g. Public speaking"
            value={newTag}
            maxLength={INTEREST_MAX}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFresh();
              }
            }}
          />
          <button type="button" className={ghost} aria-disabled={full || undefined} onClick={addFresh}>
            <Plus {...ICON} />
            Add
          </button>
        </div>
        <small className="text-[0.76rem] text-muted">
          {tags} of {JUNCTION_TAGS_MAX} interests picked.
        </small>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Switch checked={showGoal} disabled={!data.goal} onChange={setShowGoal} hint={data.goal ? "Off unless you turn it on. Shows your step and skill, never your gaps." : "You have no goal on your line yet."}>
          Show where I am on my line
        </Switch>
        {showGoal && data.goal && <GoalLine goal={data.goal} />}
      </div>

      <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-[0.78rem] text-muted">
        <ShieldCheck {...ICON} className="mt-0.5 shrink-0" />
        <span>Posts show your name and handle. No phone numbers, email addresses or screenshots. Everyone signed in to CareerMetro can read your posts.</span>
      </p>
      <FieldError id={`${ids}-e`} message={error?.text} />
      <p role="status" className="text-[0.84rem] text-muted">
        {done}
      </p>
      <button type="submit" className={`${ink} self-start`} aria-disabled={pending}>
        Post
      </button>
    </form>
  );
}

/** Before the first post: Junction's rules, accepted once (a new version asks again). The feed stays readable. */
export function JunctionRulesGate({ onAccept }: { onAccept?: ComposerActions["acceptRules"] }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="junction-rules-h" className={card}>
      <h2 id="junction-rules-h" className="text-[1.08rem] font-semibold">
        Junction&rsquo;s house rules
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[0.86rem]">
        <li>Be kind. No harassment, hate or attacks on anyone&rsquo;s religion, caste, gender, race or region.</li>
        <li>Keep people&rsquo;s details out: no phone numbers, email addresses, documents or screenshots.</li>
        <li>No asking for money, OTPs or payments, no fake jobs and no spam.</li>
        <li>Share what you know is true, and only work you may share.</li>
        <li>Everyone signed in to CareerMetro can read what you post, with your name.</li>
      </ul>
      <p className="text-[0.82rem] text-muted">
        Anyone can report a post or comment. Reports are acknowledged at once and acted on within the times on the{" "}
        <Link href="/grievances" className="font-semibold text-ink underline underline-offset-2">
          Grievances page
        </Link>
        .
      </p>
      {error && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      {done && !onAccept && <p role="status" className="text-[0.84rem] text-muted">Example only: nothing was saved.</p>}
      <button
        type="button"
        className={`${ink} self-start`}
        aria-disabled={pending}
        onClick={() =>
          !pending &&
          start(async () => {
            const r = onAccept ? await onAccept().catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const };
            if (r.ok) setDone(true);
            else setError(r.message);
          })
        }
      >
        I&rsquo;ll follow these rules
      </button>
    </section>
  );
}
