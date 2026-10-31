"use client";

import { ArrowBigUp, BookOpen, Bookmark, ExternalLink, Flag, MessageCircle, Pencil, Pin, Repeat2, Route, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { FieldError } from "@/components/ui/field-error";
import { istClock, istDayWords } from "@/lib/day-words";
import { agoWords, EDIT_WINDOW_MINUTES_SHOWN, editableAt, type JunctionReportAct, type PostActions } from "@/lib/junction/types";
import {
  JUNCTION_BODY_MAX,
  JUNCTION_PINS_MAX,
  JUNCTION_POST_KIND_LABELS,
  JUNCTION_REPORT_REASON_LABELS,
  JUNCTION_REPORT_REASONS,
  JUNCTION_TITLE_MAX,
  LIBRARY_KIND_LABELS,
  REPORT_NOTE_MAX_CHARS,
  type JunctionReportReason,
} from "@/lib/schemas/constants";
import type { CatalogCardView, GoalLineView, PostCardView } from "@/lib/schemas/junction";

import { card, chip, field, ghost, ICON, ink, quiet, toggle } from "./styles";

const FAILED = "That didn't work. Please try again.";

/** "13 Oct, 14:30": a deadline in India time. */
const deadlineWords = (iso: string) => `${istDayWords(iso)}, ${istClock(iso)}`;

/** Minutes as "45 min" or "4 h". */
const hoursWords = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`);

/** The Library catalog card on a post whose link matches a catalog item: title, source, kind and time. */
export function CatalogCard({ item, href }: { item: CatalogCardView; href: string }) {
  const kind = LIBRARY_KIND_LABELS[item.kind as keyof typeof LIBRARY_KIND_LABELS] ?? item.kind;
  return (
    <a href={href} target="_blank" rel="ugc nofollow noopener noreferrer" className="flex min-h-11 items-start gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-3 hover:bg-surface-2">
      <BookOpen {...ICON} className="mt-0.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[0.88rem] font-semibold text-ink">{item.title}</span>
        <span className="block text-[0.78rem] text-muted">
          {item.provider} · {kind} · {hoursWords(item.minutes)} · in the Library
        </span>
      </span>
      <ExternalLink {...ICON} className="mt-0.5 shrink-0 text-muted" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** "Step 6 of 9 · Python scripting · met": the author's goal, drawn live; never a gap list. */
export function GoalLine({ goal }: { goal: GoalLineView }) {
  return (
    <p className="flex items-center gap-2 text-[0.8rem] text-muted">
      <Route {...ICON} className="shrink-0" />
      <span>
        Step {goal.step} of {goal.of} · {goal.skill} · {goal.met ? "met" : "working on it"}
      </span>
    </p>
  );
}

/** The author's own post held for review after reports: only they see it until an admin decides. */
export function HeldNotice({ what = "post" }: { what?: "post" | "comment" }) {
  return (
    <p className="rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-[0.8rem] text-ink">
      Held for review after reports. Only you can see this {what} until we decide.
    </p>
  );
}

/** The author's own hidden post: the notice, with the way to the appeal on Your posts. */
export function HiddenNotice({ what = "post", appealHref }: { what?: "post" | "comment"; appealHref?: string }) {
  return (
    <p className="rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-[0.8rem] text-ink">
      CareerMetro hid this {what} after a report. Only you can see it.{" "}
      {appealHref && (
        <Link href={appealHref} className="font-semibold underline underline-offset-2">
          See why, and appeal
        </Link>
      )}
    </p>
  );
}

/** Upvote, reshare or save: a toggle that says its state in words (aria-pressed) and shows a count where there is one. */
function ToggleButton({ on, count, onPress, busy, Icon, word, onWord, disabled }: { on: boolean; count?: number; onPress: () => void; busy: boolean; Icon: typeof ArrowBigUp; word: string; onWord: string; disabled?: string }) {
  return (
    <button
      type="button"
      className={toggle}
      aria-pressed={on}
      aria-disabled={busy || !!disabled || undefined}
      title={disabled}
      onClick={() => {
        if (busy || disabled) return;
        onPress();
      }}
    >
      <Icon {...ICON} />
      <span>{on ? onWord : word}</span>
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

export function VoteButton(props: { on: boolean; count: number; onPress: () => void; busy: boolean; disabled?: string }) {
  return <ToggleButton {...props} Icon={ArrowBigUp} word="Upvote" onWord="Upvoted" />;
}
export function ReshareButton(props: { on: boolean; count: number; onPress: () => void; busy: boolean }) {
  return <ToggleButton {...props} Icon={Repeat2} word="Reshare" onWord="Reshared" />;
}
export function SaveButton(props: { on: boolean; onPress: () => void; busy: boolean }) {
  return <ToggleButton {...props} Icon={Bookmark} word="Save" onWord="Saved" />;
}

/**
 * Report a post or comment, inline under it (no pop-up): Junction's reasons, an optional note, then the reference and
 * the time we act by, shown at once as the acknowledgement.
 */
export function JunctionReportPanel({
  target,
  targetId,
  onReport,
  onClose,
  focusOnOpen = true,
}: {
  target: "post" | "comment";
  targetId: string;
  onReport?: PostActions["report"];
  /** Close and Cancel; absent on the /design gallery, where they do nothing. */
  onClose?: () => void;
  /** Opened by a Report button: focus moves to the first reason. The gallery shows it open without taking focus. */
  focusOnOpen?: boolean;
}) {
  const ids = useId();
  const [reason, setReason] = useState<JunctionReportReason | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; decideBy: string } | null>(null);
  const [pending, start] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusOnOpen) firstRef.current?.focus();
  }, [focusOnOpen]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  if (done)
    return (
      <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <p ref={doneRef} tabIndex={-1} role="status" className="text-[0.86rem] text-ink">
          Report sent. Your reference is <b className="font-mono">{done.reference}</b>. We act on it by {deadlineWords(done.decideBy)}, and tell you what we
          decided in your notifications.
        </p>
        <button type="button" className={`${quiet} self-start`} onClick={onClose}>
          Close
        </button>
      </div>
    );
  return (
    <form
      aria-label={`Report this ${target}`}
      className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (!reason) {
          setError("Choose what is wrong.");
          firstRef.current?.focus();
          return;
        }
        setError(null);
        start(async () => {
          const r: JunctionReportAct = onReport
            ? await onReport(target, targetId, reason, text).catch(() => ({ ok: false, message: FAILED }) as const)
            : { ok: true, reference: "R-EXAMPLE01", decideBy: "2026-11-01T10:00:00.000Z" };
          if (r.ok) setDone({ reference: r.reference, decideBy: r.decideBy });
          else setError(r.message);
        });
      }}
    >
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-[0.86rem] font-semibold">What is wrong with this {target}?</legend>
        {JUNCTION_REPORT_REASONS.map((key, i) => (
          <label key={key} className="flex min-h-11 items-center gap-2 text-[0.84rem]">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name={`${ids}-reason`} value={key} checked={reason === key} onChange={() => setReason(key)} className="accent-ink" />
            {JUNCTION_REPORT_REASON_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[0.8rem] text-muted">
        Anything we should know (optional)
        <textarea rows={2} maxLength={REPORT_NOTE_MAX_CHARS} value={text} onChange={(e) => setText(e.target.value)} className={`${field} resize-none`} />
      </label>
      <small className="text-[0.78rem] text-muted">The author isn&rsquo;t told who reported. Times are on the Grievances page.</small>
      {error && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className={ghost} aria-disabled={pending}>
          Send report
        </button>
        <button type="button" className={quiet} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Edit within 30 minutes: the title, the body and the one link. */
function EditForm({ post, onSave, onClose }: { post: PostCardView; onSave?: PostActions["edit"]; onClose: (saved: boolean) => void }) {
  const ids = useId();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [link, setLink] = useState(post.link?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  return (
    <form
      aria-label="Edit your post"
      className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        start(async () => {
          const r = onSave ? await onSave({ postId: post.id, title, body, link }).catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const };
          if (r.ok) onClose(true);
          else setError(r.message);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[0.8rem] font-medium text-ink" htmlFor={`${ids}-t`}>
        Title
      </label>
      <input id={`${ids}-t`} ref={titleRef} className={field} value={title} maxLength={JUNCTION_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-describedby={error ? `${ids}-e` : undefined} />
      <label className="text-[0.8rem] font-medium text-ink" htmlFor={`${ids}-b`}>
        Text
      </label>
      <textarea id={`${ids}-b`} rows={4} className={field} value={body} maxLength={JUNCTION_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
      <label className="text-[0.8rem] font-medium text-ink" htmlFor={`${ids}-l`}>
        Link {post.kind === "resource" ? "" : "(optional)"}
      </label>
      <input id={`${ids}-l`} type="url" inputMode="url" className={field} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
      <FieldError id={`${ids}-e`} message={error ?? undefined} />
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className={ink} aria-disabled={pending}>
          Save changes
        </button>
        <button type="button" className={quiet} onClick={() => onClose(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Panel = "report" | "edit" | "delete" | null;

/**
 * The post's own actions (the plan's PostMenu), inline rather than a pop-up menu: Report on someone else's post; Edit
 * (within 30 minutes), Delete and Pin to profile on your own.
 */
export function PostMenu({
  own,
  canEdit,
  pinned,
  canPin,
  busy,
  onOpen,
  onPin,
}: {
  own: boolean;
  canEdit: boolean;
  pinned: number | null;
  canPin: boolean;
  busy: boolean;
  onOpen: (panel: Exclude<Panel, null>) => void;
  onPin?: () => void;
}) {
  if (!own)
    return (
      <button type="button" className={quiet} onClick={() => onOpen("report")}>
        <Flag {...ICON} />
        Report
      </button>
    );
  return (
    <>
      {canEdit && (
        <button type="button" className={quiet} onClick={() => onOpen("edit")}>
          <Pencil {...ICON} />
          Edit
        </button>
      )}
      <button type="button" className={quiet} onClick={() => onOpen("delete")}>
        <Trash2 {...ICON} />
        Delete
      </button>
      {canPin && onPin && (
        <button type="button" className={quiet} aria-pressed={pinned !== null} aria-disabled={busy || undefined} onClick={() => !busy && onPin()}>
          <Pin {...ICON} />
          {pinned !== null ? `Pinned (${pinned} of ${JUNCTION_PINS_MAX}) · Unpin` : "Pin to profile"}
        </button>
      )}
    </>
  );
}

/**
 * One post (plan section 4, PostCard): the author line, kind and interest tags, the title, the body (plain text, line
 * breaks kept), the link and its Library card, the goal line, and Upvote, Comments, Reshare, Save and the post's own
 * actions. Without `actions` (the /design gallery) it shows what each does and sends nothing. `now` is the server's
 * clock, so the times and the edit window agree between server and browser.
 */
export function PostCard({
  post,
  now,
  actions,
  detail = false,
  pins,
  compact = false,
}: {
  post: PostCardView;
  now: string;
  actions?: PostActions;
  /** On the post's own page: the title isn't a link and the comment count isn't either. */
  detail?: boolean;
  /** Your posts: where each of your pinned posts sits, so the card can offer Pin or Unpin. */
  pins?: Record<string, number>;
  /** On a profile: no actions, the title opens the post. */
  compact?: boolean;
}) {
  const [voted, setVoted] = useState(post.voted);
  const [upvotes, setUpvotes] = useState(post.upvotes);
  const [reshared, setReshared] = useState(post.reshared);
  const [reshares, setReshares] = useState(post.reshares);
  const [saved, setSaved] = useState(post.saved);
  const [panel, setPanel] = useState<Panel>(null);
  const bar = useRef<HTMLDivElement>(null);
  // A panel closing (Cancel, Close, Keep, Save) puts focus back on the card's first action, never on the page.
  const close = () => {
    setPanel(null);
    requestAnimationFrame(() => bar.current?.querySelector<HTMLElement>("button, a")?.focus());
  };
  const [message, setMessage] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const titleId = useId();
  const own = post.author.isYou;
  const canEdit = own && post.status !== "hidden" && editableAt(post.createdAt, now, EDIT_WINDOW_MINUTES_SHOWN);
  const pinned = pins ? (pins[post.id] ?? null) : null;
  const href = `/junction/p/${post.id}`;

  const run = (work: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await work().catch(() => ({ ok: false as const, message: FAILED }));
      if (r.ok) {
        setMessage(null);
        after?.();
      } else setMessage(r.message);
    });

  const flip = (which: "vote" | "reshare" | "save") => {
    const was = which === "vote" ? voted : which === "reshare" ? reshared : saved;
    const apply = (on: boolean) => {
      if (which === "vote") {
        setVoted(on);
        setUpvotes((n) => Math.max(0, n + (on === was ? 0 : on ? 1 : -1)));
      } else if (which === "reshare") {
        setReshared(on);
        setReshares((n) => Math.max(0, n + (on === was ? 0 : on ? 1 : -1)));
      } else setSaved(on);
    };
    if (!actions) return apply(!was);
    start(async () => {
      const r = await actions[which](post.id).catch(() => ({ ok: false as const, message: FAILED }));
      if (r.ok) {
        apply(r.on);
        setMessage(null);
      } else setMessage(r.message);
    });
  };

  if (gone)
    return (
      <p role="status" className={`${card} text-[0.86rem] text-muted`}>
        Post deleted. It is gone for everyone.
      </p>
    );

  const time = agoWords(post.createdAt, now, (at) => istDayWords(at));
  return (
    <article aria-labelledby={titleId} className={card}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-muted">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-surface-2 text-[0.66rem] font-semibold text-ink">
          {post.author.initials}
        </span>
        <span className="font-semibold text-ink">
          {post.author.handle ? (
            <Link href={`/u/${post.author.handle}`} className="hover:underline">
              {post.author.name}
            </Link>
          ) : (
            post.author.name
          )}
          {own && <span className="font-normal text-muted"> (you)</span>}
        </span>
        {post.author.handle && <span>@{post.author.handle}</span>}
        {post.routeLabel && <span>· {post.routeLabel}</span>}
        <span>
          · {time}
          {post.editedAt ? " · Edited" : ""}
        </span>
      </div>
      {post.resharedBy && (
        <p className="flex items-center gap-1.5 text-[0.78rem] text-muted">
          <Repeat2 {...ICON} />
          {post.resharedBy} reshared
        </p>
      )}
      {own && post.status === "held" && <HeldNotice />}
      {own && post.status === "hidden" && <HiddenNotice appealHref="/junction/mine" />}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${chip} font-mono uppercase tracking-[0.06em] text-[0.7rem]`}>{JUNCTION_POST_KIND_LABELS[post.kind]}</span>
        {post.interests.map((t) => (
          <Link key={t.id} href={`/junction?feed=interests&interest=${t.id}`} className={`${chip} hover:bg-line`}>
            {t.name}
          </Link>
        ))}
      </div>
      <h3 id={titleId} className="break-words text-[1.08rem] font-semibold leading-snug tracking-[-0.01em]">
        {detail ? post.title : <Link href={href} className="hover:underline">{post.title}</Link>}
      </h3>
      {post.body && !compact && <p className="whitespace-pre-line break-words text-[0.9rem] text-ink">{post.body}</p>}
      {post.link && !post.catalog && (
        <a href={post.link.url} target="_blank" rel="ugc nofollow noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 self-start break-all text-[0.84rem] font-medium text-ink underline underline-offset-2">
          <ExternalLink {...ICON} className="shrink-0" />
          {post.link.host}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      {post.link && post.catalog && <CatalogCard item={post.catalog} href={post.link.url} />}
      {post.goal && <GoalLine goal={post.goal} />}
      {compact ? (
        <p className="text-[0.78rem] text-muted">
          {upvotes} {upvotes === 1 ? "upvote" : "upvotes"} · {post.comments} {post.comments === 1 ? "comment" : "comments"}
        </p>
      ) : (
        <div ref={bar} className="flex flex-wrap items-center gap-1.5">
          <VoteButton on={voted} count={upvotes} busy={pending} onPress={() => flip("vote")} disabled={own ? "You can't upvote your own post." : post.status !== "visible" ? "Not while it is held or hidden." : undefined} />
          {detail ? (
            <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[0.82rem] text-muted">
              <MessageCircle {...ICON} />
              {post.comments} {post.comments === 1 ? "comment" : "comments"}
            </span>
          ) : (
            <Link href={href} className={quiet}>
              <MessageCircle {...ICON} />
              {post.comments} {post.comments === 1 ? "comment" : "comments"}
            </Link>
          )}
          {!own && post.status === "visible" && <ReshareButton on={reshared} count={reshares} busy={pending} onPress={() => flip("reshare")} />}
          {own && <span className="inline-flex min-h-11 items-center px-2 text-[0.82rem] text-muted">{reshares} {reshares === 1 ? "reshare" : "reshares"}</span>}
          <SaveButton on={saved} busy={pending} onPress={() => flip("save")} />
          <PostMenu
            own={own}
            canEdit={canEdit}
            pinned={pinned}
            canPin={!!pins && post.status !== "hidden"}
            busy={pending}
            onOpen={(p) => setPanel((now) => (now === p ? null : p))}
            onPin={() => {
              const used = new Set(Object.values(pins ?? {}));
              const free = [1, 2, 3].find((n) => !used.has(n)) ?? null;
              if (pinned === null && free === null) return setMessage("You can pin 3 posts. Unpin one first.");
              run(() => (actions ? actions.pin(post.id, pinned === null ? free : null) : Promise.resolve({ ok: true as const })));
            }}
          />
        </div>
      )}
      {message && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {message}
        </p>
      )}
      {panel === "report" && <JunctionReportPanel target="post" targetId={post.id} onReport={actions?.report} onClose={close} />}
      {panel === "edit" && <EditForm post={post} onSave={actions?.edit} onClose={close} />}
      {panel === "delete" && (
        <DeleteConfirm
          what="post"
          busy={pending}
          onKeep={close}
          onDelete={() =>
            run(
              () => (actions ? actions.remove(post.id) : Promise.resolve({ ok: true as const })),
              () => setGone(true),
            )
          }
        />
      )}
    </article>
  );
}

/** "Delete this post?" inline, with Delete first and focused, and Keep. */
export function DeleteConfirm({ what, busy, onDelete, onKeep }: { what: "post" | "comment"; busy: boolean; onDelete: () => void; onKeep: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div role="group" aria-label={`Delete this ${what}?`} className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
      <p className="text-[0.86rem] text-ink">
        Delete this {what}? It goes for everyone at once{what === "post" ? ", with its comments" : ""}. This can&rsquo;t be undone.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button ref={first} type="button" className={ink} aria-disabled={busy || undefined} onClick={() => !busy && onDelete()}>
          Delete
        </button>
        <button type="button" className={ghost} onClick={onKeep}>
          Keep
        </button>
      </div>
    </div>
  );
}
