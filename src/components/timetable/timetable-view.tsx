"use client";

import {
  Bookmark,
  BookmarkCheck,
  CalendarCheck,
  CalendarPlus,
  Check,
  Clock,
  ExternalLink,
  Globe,
  Lightbulb,
  ListChecks,
  ListPlus,
  MapPin,
  Plus,
  Target,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { ShowMore, usePaged, usePhonePage } from "@/components/ui/show-more";
import { Switch } from "@/components/ui/switch";
import { eventIcs } from "@/lib/calendar/ics";
import type { EventCard, EventRsvpState, TimetableFilter, TimetableView as View, TimetableWhy } from "@/lib/schemas";
import { TIMETABLE_NO_CITY } from "@/lib/schemas/constants";
import { dateBlock, eventPlace, eventWhen, FAR_RADIUS_KM, goalTagName, kindLabel, namesLine, shownGroups } from "@/lib/timetable/view";

/**
 * Save, I'm going and the prep task, kept on the server (src/app/(app)/timetable/actions.ts): null when it worked, or
 * the words to show. `prep` names the goal's skill, or null to take the task off.
 */
export type TimetableActions = {
  rsvp: (eventId: string, state: EventRsvpState | null) => Promise<string | null>;
  prep: (eventId: string, goalSkillId: string | null) => Promise<string | null>;
};

/** What the prep question and the card say, every time (docs/plans/timetable-plan.md section 4). */
export const PREP_NOTE = "Going can count as a prep task. It never fills a gap on its own.";
const FAILED = "That didn't work. Please try again.";

const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const card = "flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-surface p-4";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.82rem] font-[550] text-ink hover:bg-surface-2";
const markButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[0.82rem] font-[550] text-ink hover:bg-surface-2 aria-pressed:border-ink aria-pressed:bg-surface-2 aria-disabled:opacity-60";
const FILTERS: { key: TimetableFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "goals", label: "My goals" },
  { key: "interests", label: "My interests" },
];
const SETTINGS_CITY = "/settings#acc-pay";

/** After Show more, focus goes to the first new card (the group headings sit between cards). Declared out here so it stays the same. */
const focusCard = (list: HTMLElement, index: number) => list.querySelectorAll<HTMLElement>("[data-event-card]")[index] ?? null;

/**
 * The Timetable (docs/plans/timetable-plan.md section 7, prototype v2 evt): events picked only from the person's goals
 * and interests, near the profile city or online, grouped by when, 20 at a time with Show more. The filter row works on
 * the screen: the view already holds every match within 100 km and every online one, and the saved radius and Include
 * online are where it starts ("Show outside 25 km" is for this visit only). Without `actions` (the example preview and
 * /design) Save and I'm going change the screen only.
 */
export function TimetableView({
  view,
  why,
  choices,
  actions,
}: {
  view: View;
  why: TimetableWhy;
  choices: { radiusKm: number; online: boolean };
  actions?: TimetableActions;
}) {
  const [filter, setFilter] = useState<TimetableFilter>("all");
  const [online, setOnline] = useState(choices.online);
  const [far, setFar] = useState(false);
  const [marks, setMarks] = useState<Record<string, EventRsvpState | null>>({});
  const [preps, setPreps] = useState<Record<string, string | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const allCount = useMemo(() => view.groups.reduce((n, g) => n + g.events.length, 0), [view]);
  const shown = useMemo(() => shownGroups(view.groups, { filter, online, far, radiusKm: choices.radiusKm }), [view, filter, online, far, choices.radiusKm]);
  // One list for paging, each card with its group, so a heading shows above the first card of its group on the page.
  const rows = useMemo(() => shown.groups.flatMap((g) => g.events.map((e, i) => ({ e, group: i === 0 ? g.label : null }))), [shown]);
  const page = usePhonePage();
  const paged = usePaged(rows, `${filter}-${online}-${far}-${page}`, page);
  const limitKm = far ? Math.max(choices.radiusKm, FAR_RADIUS_KM) : choices.radiusKm;
  const canWiden = view.city !== null && choices.radiusKm < FAR_RADIUS_KM;

  return (
    <div className="grid min-w-0 gap-6 min-[960px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[2rem] font-semibold leading-[1.1]">Timetable</h1>
            <p className="mt-1.5 max-w-[60ch] text-[0.92rem] text-muted">Meetups, workshops and conferences near you, picked only from your goals and your interests.</p>
          </div>
          <Link href={SETTINGS_CITY} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[0.82rem] font-[550] text-ink hover:bg-surface-2">
            <MapPin size={15} {...ICON} />
            {view.city ? `${view.city} · within ${limitKm} km` : "Add your city"}
          </Link>
        </div>

        {view.noCity && (
          <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.84rem] text-ink">
            {TIMETABLE_NO_CITY}{" "}
            <Link href={SETTINGS_CITY} className="font-[550] underline underline-offset-2">
              Add your city
            </Link>
          </p>
        )}

        <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <div role="group" aria-label="Show" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-surface-2 p-[3px]">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} className={`${seg} min-h-9 whitespace-nowrap`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <Switch checked={online} onChange={setOnline}>
            Include online
          </Switch>
          {canWiden && (
            <Switch checked={far} onChange={setFar}>
              Show outside {choices.radiusKm} km
            </Switch>
          )}
        </div>

        {allCount === 0 ? (
          <NothingYet />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.length === 0 && (
              <p className="rounded-[16px] border border-dashed border-line p-5 text-[0.88rem] text-muted">Nothing matches these choices. Try All, or turn Include online on.</p>
            )}
            <div ref={listRef} className="flex flex-col gap-2.5">
              {paged.shown.map(({ e, group }) => (
                <div key={e.id} className="flex flex-col gap-2.5">
                  {group && <h2 className={`${LABEL} mt-2`}>{group}</h2>}
                  <EventCardView
                    card={e}
                    mark={e.id in marks ? marks[e.id] : e.rsvp}
                    prep={e.id in preps ? preps[e.id] : (e.prepGoal ?? null)}
                    onMark={async (next) => {
                      const before = e.id in marks ? marks[e.id] : e.rsvp;
                      const prepBefore = e.id in preps ? preps[e.id] : (e.prepGoal ?? null);
                      setMarks((m) => ({ ...m, [e.id]: next }));
                      // Save or neither clears the prep task on the server too; going again keeps it.
                      if (next !== "going") setPreps((p) => ({ ...p, [e.id]: null }));
                      const error = actions ? await actions.rsvp(e.id, next).catch(() => FAILED) : null;
                      if (error) {
                        setMarks((m) => ({ ...m, [e.id]: before }));
                        setPreps((p) => ({ ...p, [e.id]: prepBefore }));
                      }
                      return error;
                    }}
                    onPrep={async (goal) => {
                      const before = e.id in preps ? preps[e.id] : (e.prepGoal ?? null);
                      setPreps((p) => ({ ...p, [e.id]: goal }));
                      const error = actions ? await actions.prep(e.id, goal).catch(() => FAILED) : null;
                      if (error) setPreps((p) => ({ ...p, [e.id]: before }));
                      return error;
                    }}
                  />
                </div>
              ))}
            </div>
            <ShowMore left={paged.left} shown={paged.shown.length} onMore={paged.more} list={listRef} noun="events" focusRow={focusCard} />
            {canWiden && !far && shown.outside > 0 && (
              <p className="text-[0.8rem] text-muted">
                {shown.outside} more outside {choices.radiusKm} km. Turn on &ldquo;Show outside {choices.radiusKm} km&rdquo; to see them.
              </p>
            )}
            {view.outsideRadius > 0 && (
              <p className="text-[0.8rem] text-muted">
                {view.outsideRadius === 1 ? "1 more is" : `${view.outsideRadius} more are`} farther than {FAR_RADIUS_KM} km, so {view.outsideRadius === 1 ? "it isn't" : "they aren't"} shown.
              </p>
            )}
          </div>
        )}
      </div>

      <aside aria-label="About the Timetable" className="flex min-w-0 flex-col gap-3.5">
        <section aria-label="Why you see these" className={card}>
          <h2 className="text-[1.02rem] font-semibold">Why you see these</h2>
          <ul className="flex flex-col gap-2.5 text-[0.84rem]">
            <WhyRow Icon={Target} title="Your goals" text={why.goals.length ? namesLine(why.goals) : "No open goals yet."} />
            <WhyRow
              Icon={Lightbulb}
              title="Your interests"
              text={
                why.interests.length ? (
                  namesLine(why.interests)
                ) : (
                  <>
                    None yet.{" "}
                    <Link href="/me" className="font-[550] text-ink underline underline-offset-2">
                      Add some on Me
                    </Link>
                  </>
                )
              }
            />
            <WhyRow
              Icon={MapPin}
              title="Your city"
              text={view.city ? `${view.city}, from your profile. We never track where you are.` : "Not given. We never track where you are."}
            />
          </ul>
          <p className="text-[0.8rem] text-muted">Nothing else gets in: no sponsored events, no random tech talks. Going to an event never fills a gap on its own.</p>
        </section>
        <section aria-label="Every Monday" className={card}>
          <h2 className="text-[1.02rem] font-semibold">Every Monday</h2>
          <Switch checked={false} onChange={() => {}} disabled hint="One message on Monday morning, only if something matches.">
            Send me this week&apos;s events · soon
          </Switch>
        </section>
        <section aria-label="Know an event?" className={card}>
          <h2 className="text-[1.02rem] font-semibold">Know an event?</h2>
          <p className="text-[0.8rem] text-muted">Organisers and members can suggest one. It shows up after a quick check.</p>
          <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-line px-3 py-1.5 text-[0.8rem] font-[550] text-muted">
            <Plus size={15} {...ICON} />
            Suggest an event · soon
          </span>
        </section>
      </aside>
    </div>
  );
}

function WhyRow({ Icon, title, text }: { Icon: LucideIcon; title: string; text: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <Icon size={16} className="mt-0.5 text-muted" {...ICON} />
      <span className="flex min-w-0 flex-col gap-0.5 text-muted [overflow-wrap:anywhere]">
        <b className="font-semibold text-ink">{title}</b>
        {text}
      </span>
    </li>
  );
}

/** No event matches the person at all: say so, and where goals, interests and the city come from. */
export function NothingYet() {
  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-dashed border-line p-5 text-[0.88rem] text-muted">
      <p className="font-[550] text-ink">No events match your goals or interests yet.</p>
      <p>We only show events on your goals and interests, near your city or online.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/me" className="inline-flex min-h-11 items-center font-[550] text-ink underline underline-offset-2">
          Add interests on Me
        </Link>
        <Link href={SETTINGS_CITY} className="inline-flex min-h-11 items-center font-[550] text-ink underline underline-offset-2">
          Set your city in Settings
        </Link>
      </div>
    </div>
  );
}

/**
 * One event: the date block, title and kind, place, time, cost and organiser, why it shows (goal and interest tags in
 * the neutral style: an event is not progress), and Save, I'm going, Add to calendar and the organiser's page. I'm
 * going on an event with a goal tag asks once, "Add it as a prep task for your SIEM goal?" (docs/plans/timetable-plan.md
 * section 4); yes puts one optional task on the ride on the event's day. `prep` is the goal's skill when it has one.
 */
export function EventCardView({
  card: e,
  mark,
  prep = null,
  onMark,
  onPrep,
}: {
  card: EventCard;
  mark: EventRsvpState | null;
  prep?: string | null;
  onMark: (next: EventRsvpState | null) => Promise<string | null>;
  onPrep?: (goalSkillId: string | null) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLDivElement>(null);
  const when = dateBlock(e.startsAt);
  const place = eventPlace(e);
  const goals = e.tags.filter((t) => t.kind === "goal").map((t) => ({ skillId: t.topic, name: goalTagName(t.label) }));
  const prepName = prep ? goals.find((g) => g.skillId === prep)?.name : undefined;
  const canPrep = Boolean(onPrep) && goals.length > 0;
  useEffect(() => {
    // The question appears after "I'm going": focus moves to it, so a keyboard or screen reader user meets it at once.
    if (asking) askRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);
  const press = async (target: EventRsvpState) => {
    if (busy) return;
    const next = mark === target ? null : target;
    setBusy(true);
    const error = await onMark(next);
    setBusy(false);
    setAsking(!error && next === "going" && canPrep && !prep);
    setNote(error ?? (next === "going" ? "Marked as going." : next === "saved" ? "Saved." : "Removed from your plans."));
  };
  const answer = async (goal: { skillId: string; name: string } | null) => {
    if (busy || !onPrep) return;
    if (!goal) {
      setAsking(false);
      setNote("Marked as going. No prep task added.");
      return;
    }
    setBusy(true);
    const error = await onPrep(goal.skillId);
    setBusy(false);
    if (!error) setAsking(false);
    setNote(error ?? `Added. It shows on your ride on the day, for your ${goal.name} goal.`);
  };
  const takeOff = async () => {
    if (busy || !onPrep) return;
    setBusy(true);
    const error = await onPrep(null);
    setBusy(false);
    setNote(error ?? "Prep task taken off your ride. You're still going.");
  };
  const download = () => {
    const ics = eventIcs({ eventId: e.id, startsAt: new Date(e.startsAt), endsAt: new Date(e.endsAt), summary: e.title, organiser: e.organiser, location: place, url: e.sourceUrl, now: new Date() });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "careermetro-event.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("Calendar file made, with a reminder the evening before at 19:00.");
  };
  return (
    <article data-event-card aria-label={e.title} className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] gap-2.5 rounded-[16px] border border-line bg-surface p-3 min-[760px]:grid-cols-[64px_minmax(0,1fr)] min-[760px]:gap-3.5 min-[760px]:px-4 min-[760px]:py-3.5">
      <div className="flex flex-col items-center justify-center gap-0.5 self-start rounded-[12px] bg-surface-2 px-1 py-2 text-center" aria-hidden="true">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted">{when.weekday}</span>
        <b className="font-display text-[1.4rem] leading-none text-ink">{when.day}</b>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted">{when.month}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="min-w-0 text-[1rem] font-semibold [overflow-wrap:anywhere]">{e.title}</h3>
          <span className="rounded-full border border-line px-2 py-px font-mono text-[0.62rem] uppercase tracking-[0.05em] text-muted">{kindLabel(e)}</span>
        </div>
        <p className="sr-only">
          {when.weekday} {when.day} {when.month}
        </p>
        <div className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1 text-[0.82rem] text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
            {e.online ? <Globe size={14} className="shrink-0" {...ICON} /> : <MapPin size={14} className="shrink-0" {...ICON} />}
            {place}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} className="shrink-0" {...ICON} />
            {eventWhen(e.startsAt, e.endsAt)}
          </span>
          {e.cost && (
            <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
              <Ticket size={14} className="shrink-0" {...ICON} />
              {e.cost}
            </span>
          )}
          <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
            <Users size={14} className="shrink-0" {...ICON} />
            {e.organiser}
          </span>
        </div>
        <ul aria-label="Why it shows" className="flex min-w-0 flex-wrap gap-1.5">
          {e.tags.map((t) => (
            <li key={`${t.kind}-${t.topic}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.76rem] text-ink">
              {t.kind === "goal" ? <Target size={13} className="shrink-0 text-muted" {...ICON} /> : <Lightbulb size={13} className="shrink-0 text-muted" {...ICON} />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{t.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <button type="button" aria-pressed={mark === "saved"} aria-disabled={busy || undefined} className={markButton} onClick={() => press("saved")}>
            {mark === "saved" ? <BookmarkCheck size={15} {...ICON} /> : <Bookmark size={15} {...ICON} />}
            {mark === "saved" ? "Saved" : "Save"}
          </button>
          <button type="button" aria-pressed={mark === "going"} aria-disabled={busy || undefined} className={markButton} onClick={() => press("going")}>
            {mark === "going" ? <Check size={15} {...ICON} /> : <CalendarCheck size={15} {...ICON} />}
            {mark === "going" ? "Going" : "I'm going"}
          </button>
          <button type="button" className={quiet} onClick={download}>
            <CalendarPlus size={15} {...ICON} />
            Add to calendar
          </button>
          <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className={quiet}>
            <ExternalLink size={15} {...ICON} />
            Organiser&apos;s page<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        {asking && mark === "going" && (
          <div ref={askRef} role="group" aria-label="Prep task" className="flex flex-col gap-2 rounded-[12px] bg-surface-2 p-3">
            <p className="text-[0.86rem] font-[550] text-ink [overflow-wrap:anywhere]">
              {goals.length === 1 ? `Add it as a prep task for your ${goals[0].name} goal?` : "Add it as a prep task for one of your goals?"}
            </p>
            <p className="text-[0.78rem] text-muted">{PREP_NOTE} It shows on your ride on the day.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {goals.length === 1 ? (
                <button type="button" aria-disabled={busy || undefined} className={markButton} onClick={() => answer(goals[0])}>
                  <ListPlus size={15} {...ICON} />
                  Yes, add it
                </button>
              ) : (
                goals.map((g) => (
                  <button key={g.skillId} type="button" aria-disabled={busy || undefined} className={`${markButton} max-w-full`} onClick={() => answer(g)}>
                    <ListPlus size={15} className="shrink-0" {...ICON} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">For {g.name}</span>
                  </button>
                ))
              )}
              <button type="button" aria-disabled={busy || undefined} className={quiet} onClick={() => answer(null)}>
                No thanks
              </button>
            </div>
          </div>
        )}
        {mark === "going" && prepName && !asking && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8rem] text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
              <ListChecks size={14} className="shrink-0" {...ICON} />
              Prep task for your {prepName} goal, on your ride on the day. {PREP_NOTE}
            </span>
            {onPrep && (
              <button type="button" aria-disabled={busy || undefined} className="inline-flex min-h-11 items-center font-[550] text-ink underline underline-offset-2" onClick={takeOff}>
                Take it off
              </button>
            )}
          </div>
        )}
        <p role="status" className="min-h-0 text-[0.78rem] text-muted empty:hidden">
          {note}
        </p>
      </div>
    </article>
  );
}
