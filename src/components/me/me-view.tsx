"use client";

import { ArrowRight, BadgeCheck, BookOpen, CircleDashed, Eye, FileText, FlaskConical, Hourglass, Lock, Mail, MessageSquareText, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { JoinForm } from "@/components/corporate/join-form";
import { ProfileCertifications, type CredlyCheckResult } from "@/components/me/certifications";
import { ConfirmDelete, EducationForm, InterestsEditor, RoleForm, rowLink, StoryForm, useToast, type MeEditActions } from "@/components/me/me-editors";
import { EliteBadge } from "@/components/elite/elite-badge";
import { NearbyLinesList } from "@/components/nearby/nearby-lines";
import { ConfidenceSpark, confidenceWord, sessionsText } from "@/components/practice/confidence-spark";
import { SampleTag } from "@/components/ui/sample-tag";
import { StatusChip } from "@/components/ui/status-chip";
import type { JoinActions } from "@/lib/corporate/types";
import { initials } from "@/lib/departures/filter";
import { experienceCheckText } from "@/lib/me/job-check-rules";
import type { JourneyStop, MeProfile, PracticeTrend, Story } from "@/lib/schemas";
import { SMART, STORY_BOXES } from "@/lib/schemas/constants";

const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-[550]";
const ghost = `${btn} border border-line bg-surface px-[15px] py-[9px] text-[0.86rem] text-ink hover:bg-surface-2`;
const quiet = `${btn} px-2 py-[9px] text-[0.86rem] text-muted`;
const label = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

/** Who sees what, as saved in Account settings, for the rail on the person's own profile. */
export type WhoSees = { visibility: string; link: string | null; shown: string[] };

/**
 * Your profile (handoff section 11): the person's own profile with edit controls, and "View as others", which shows
 * exactly what /u/<username> shows: `others` is the public profile the server worked out (src/lib/me/public.ts), so
 * nothing hidden is even in the page. With `mode="public"` it is someone else's profile at /u/<username>, read only.
 * On the person's own view, "+ Add role", Education's "+ Add", "+ Add story" and Interests open inline forms
 * (docs/plans/me-editing-plan.md); rows they added carry "Added by you" with Edit and Delete. Resume rows are never
 * edited here: Replace and Edit in builder are on the Resume card.
 */
export function MeView({
  me: mine,
  others,
  mode = "own",
  whoSees,
  practice,
  onCheckCertificate,
  jobCheck,
  gapsNote,
  eliteBadge = false,
  planCard,
  status = null,
  searchSwitches = null,
  edits,
  storyGoals = [],
}: {
  me: MeProfile;
  others?: MeProfile;
  mode?: "own" | "public";
  whoSees?: WhoSees;
  /** "Practice confidence" (FR-23): the person's own ratings per skill. Shown on their own view only, never to others. */
  practice?: PracticeTrend[];
  /** "Check with Credly" (src/app/(app)/me/actions.ts); without it, example data says nothing is checked. */
  onCheckCertificate?: (proofId: string) => Promise<CredlyCheckResult>;
  /**
   * "Verify with your work email" on the current job (FR-47): `open` is false where no code can be sent yet
   * (production until the email sender exists). Without it, example data shows the button switched off.
   */
  jobCheck?: { open: boolean; actions?: JoinActions };
  /** On someone else's profile: why their gaps show to this viewer ("shared with connections", handoff 12j). */
  gapsNote?: string;
  /** The Elite badge next to the name (FR-50): only while Elite is on and its owner turned it on. It ranks nothing. */
  eliteBadge?: boolean;
  /** "Your plan" (FR-50): on the person's own profile only, never in View as others or to anyone else. */
  planCard?: ReactNode;
  /** The job search status line (src/components/job-search): on the person's own view only, never to others. */
  status?: ReactNode;
  /** "Looking for a job" and the other "Who sees what" switches, on the person's own view only. */
  searchSwitches?: ReactNode;
  /** Me editing's server actions (src/app/(app)/me/actions.ts); without them the forms open and Save only closes them. */
  edits?: MeEditActions;
  /** "From a goal" on the story form: the person's own goals. */
  storyGoals?: { id: string; name: string }[];
}) {
  const [asOthers, setAsOthers] = useState(false);
  const certsHeading = `${useId()}-certifications`;
  const back = useRef<HTMLButtonElement>(null);
  const view = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  // The button pressed disappears, so focus moves to the one that undoes it. Only after a press, never on load.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    (asOthers ? back : view).current?.focus();
  }, [asOthers]);
  const toggle = (next: boolean) => {
    pending.current = true;
    setAsOthers(next);
  };
  // Me editing: one form or delete question open at a time. Closing it puts focus back on the control that opened it
  // (or, after a delete, the section's add control), in an effect keyed on a counter so focus never drops to the page.
  const [editing, setEditing] = useState<Editing>(null);
  const [toast, say] = useToast();
  const openers = useRef(new Map<string, HTMLElement>());
  const [focusAsk, setFocusAsk] = useState<{ key: string; n: number } | null>(null);
  useEffect(() => {
    if (focusAsk) openers.current.get(focusAsk.key)?.focus();
  }, [focusAsk]);
  const opener = (key: string) => (el: HTMLElement | null) => {
    if (el) openers.current.set(key, el);
    else openers.current.delete(key);
  };
  const close = (key: string, saved?: string) => {
    setEditing(null);
    setFocusAsk((f) => ({ key, n: (f?.n ?? 0) + 1 }));
    if (saved) say(saved);
  };
  const isOpen = (kind: EditKind, id: string | null, mode: "edit" | "delete" = "edit", box?: string) =>
    editing?.kind === kind && editing.id === id && editing.mode === mode && editing.box === box;
  const addControl = (kind: EditKind, text: string) => (
    <button
      ref={opener(`${kind}:add`)}
      type="button"
      aria-expanded={isOpen(kind, null)}
      className="inline-flex min-h-11 items-center text-[0.82rem] font-[550] text-muted hover:text-ink"
      onClick={() => setEditing({ kind, id: null, mode: "edit" })}
    >
      {text}
    </button>
  );
  const rowControls = (kind: EditKind, id: string, name: string) => (
    <span className="flex flex-wrap items-center gap-x-3">
      <span className="font-mono text-[0.64rem] uppercase tracking-[0.06em] text-muted">Added by you</span>
      <button ref={opener(`${kind}:edit:${id}`)} type="button" className={rowLink} onClick={() => setEditing({ kind, id, mode: "edit" })}>
        Edit<span className="sr-only"> {name}</span>
      </button>
      <button ref={opener(`${kind}:delete:${id}`)} type="button" className={rowLink} onClick={() => setEditing({ kind, id, mode: "delete" })}>
        Delete<span className="sr-only"> {name}</span>
      </button>
    </span>
  );
  const viewer = mode === "public";
  const own = !asOthers && !viewer;
  // What is on screen: everything for the owner; the public profile otherwise.
  const me = own ? mine : (others ?? mine);
  const hasResume = me.resumeReadOn !== null;
  const fromResume = viewer ? "from their resume" : "from your resume";
  const gapsShown = me.skills.weak.length + me.skills.missing.length > 0;
  return (
    <div className="grid min-w-0 gap-6 min-[760px]:grid-cols-[minmax(0,1fr)_300px] min-[760px]:gap-10">
      <div className="flex min-w-0 flex-col">
        {asOthers && (
          <div role="status" className="mb-1.5 flex flex-wrap items-center gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[0.85rem]">
            <Eye size={16} {...ICON} className="shrink-0 text-muted" />
            <span className="flex-1">You are seeing your profile the way other people will, as your privacy settings choose. Private parts are hidden.</span>
            <button ref={back} type="button" className={`${ghost} px-[11px] py-1.5 text-[0.8rem]`} onClick={() => toggle(false)}>
              Back to editing
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-[18px]">
          <span
            aria-hidden="true"
            className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[1.2rem] font-medium"
          >
            {initials(me.name)}
          </span>
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
            <h1 className="text-[1.7rem] font-semibold leading-[1.1] [overflow-wrap:anywhere]">
              {me.name}
              {eliteBadge && <EliteBadge className="ml-2.5" />}
            </h1>
            {me.headline && <p className="text-[0.95rem] [overflow-wrap:anywhere]">{me.headline}</p>}
            {own && status}
            {/* The target role says the person is looking, so others see it only when they turn it on in Account settings. */}
            {(own || me.aim) && <p className="text-[0.92rem] text-muted [overflow-wrap:anywhere]">{me.aim ? `Aiming for ${me.aim}` : "Picking a target role"}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1 self-center">
            {own && (
              <button ref={view} type="button" className={ghost} onClick={() => toggle(true)}>
                <Eye size={17} {...ICON} />
                View as others
              </button>
            )}
            {own && (
              <Link href="/settings#acc-job-search" className={quiet}>
                Change status
              </Link>
            )}
            {own && (
              <Link href="/settings" className={quiet}>
                Account settings
              </Link>
            )}
          </div>
        </div>

        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-y border-line py-3 text-[0.82rem] text-muted">
          {me.stats
            .filter((s) => own || !s.private)
            .map((s) => (
              <span key={s.label}>
                <b className="mr-1 font-mono font-medium text-ink">{s.value}</b>
                {s.label}
              </span>
            ))}
        </p>

        {own && planCard}

        {own && (
          <Section first title="Your journey" note={me.journeyLabel} action={<More href="/map">Open map</More>}>
            <Journey stops={me.journey} />
          </Section>
        )}

        {(!viewer || me.experience.length > 0) && (
        <Section
          first={!own}
          title="Experience"
          note={me.experienceTotal ? `${me.experienceTotal} · ${fromResume}` : fromResume}
          action={own && addControl("role", "+ Add role")}
        >
          {own && isOpen("role", null) && (
            <RoleForm
              onSave={edits && ((input) => edits.saveRole(null, input))}
              onDone={() => close("role:add", "Saved.")}
              onCancel={() => close("role:add")}
            />
          )}
          {me.experience.length ? (
            <ul className="flex flex-col">
              {me.experience.map((e, i) => (
                <li key={e.id} className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-3.5 pb-[18px]">
                  {i < me.experience.length - 1 && <i aria-hidden="true" className="absolute bottom-0.5 left-[21px] top-12 w-0.5 bg-line" />}
                  <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-[12px] bg-surface-2 font-display font-semibold">
                    {initials(e.employer)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                      <b className="min-w-0 text-[0.96rem] font-semibold [overflow-wrap:anywhere]">{e.title}</b>
                      {e.current && (
                        <span className="rounded-full bg-surface-2 px-[7px] py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.06em]">
                          Current
                        </span>
                      )}
                    </div>
                    <span className="text-[0.8rem] text-muted [overflow-wrap:anywhere]">
                      {e.employer} · {e.dates}
                    </span>
                    {e.check && <JobCheckBadge check={e.check} own={own} />}
                    {own && e.check?.state === "not_verified" && <VerifyJob employer={e.employer} jobCheck={jobCheck} />}
                    {own && e.added && rowControls("role", e.added.id, e.title)}
                    {own && e.added && isOpen("role", e.added.id) && (
                      <RoleForm
                        role={e}
                        onSave={edits && ((input) => edits.saveRole(e.added!.id, input))}
                        onDone={() => close(`role:edit:${e.added!.id}`, "Saved.")}
                        onCancel={() => close(`role:edit:${e.added!.id}`)}
                      />
                    )}
                    {own && e.added && isOpen("role", e.added.id, "delete") && (
                      <ConfirmDelete
                        question="Delete this role?"
                        onDelete={edits && (() => edits.deleteRole(e.added!.id))}
                        onDeleted={() => close("role:add", "Deleted.")}
                        onKeep={() => close(`role:delete:${e.added!.id}`)}
                      />
                    )}
                    {own && e.highlights.length > 0 && (
                      <ul className="mt-0.5 flex min-w-0 list-disc flex-col gap-[3px] pl-[18px] text-[0.86rem] [overflow-wrap:anywhere]">
                        {e.highlights.map((h, j) => (
                          <li key={j}>{h}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty Icon={FileText}>Your roles fill in from your resume, or add them by hand.</Empty>
          )}
          {asOthers && me.experience.length > 0 && mine.experience.some((e) => e.highlights.length) && (
            <Note>Lines from your resume stay private. Your stories show what you did.</Note>
          )}
        </Section>
        )}

        {(!viewer || me.stories.length > 0) && (
        <Section title={viewer ? "Stories" : "Your stories"} note={me.stories.length ? storyCount(me.stories) : "none yet"} action={own && addControl("story", "+ Add story")}>
          <p className="text-[0.86rem] text-muted">
            Every piece of work you have done, as a short Situation, Task, Action, Result story, sorted into what interviewers ask about. Recruiters
            see it when they open your profile.
          </p>
          {own && editing?.kind === "story" && editing.mode === "edit" && (
            <StoryForm
              key={editing.id ?? "new"}
              story={editing.id ? me.stories.find((x) => x.id === editing.id) : undefined}
              goals={storyGoals}
              onSave={edits && ((input) => edits.saveStory(editing.id, input))}
              onDone={() => close(editing.id ? `story:edit:${editing.id}:${editing.box}` : "story:add", "Saved.")}
              onCancel={() => close(editing.id ? `story:edit:${editing.id}:${editing.box}` : "story:add")}
            />
          )}
          {me.stories.length ? (
            <Stories
              stories={me.stories}
              own={own}
              controls={
                own
                  ? (st, box) => (
                      <>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 border-t border-dashed border-line pt-1">
                          <button
                            ref={opener(`story:edit:${st.id}:${box}`)}
                            type="button"
                            className={rowLink}
                            onClick={() => setEditing({ kind: "story", id: st.id, mode: "edit", box })}
                          >
                            Edit<span className="sr-only"> {st.title}</span>
                          </button>
                          <button
                            ref={opener(`story:delete:${st.id}:${box}`)}
                            type="button"
                            className={rowLink}
                            onClick={() => setEditing({ kind: "story", id: st.id, mode: "delete", box })}
                          >
                            Delete<span className="sr-only"> {st.title}</span>
                          </button>
                        </span>
                        {isOpen("story", st.id, "delete", box) && (
                          <ConfirmDelete
                            question="Delete this story?"
                            onDelete={edits && (() => edits.deleteStory(st.id))}
                            onDeleted={() => close("story:add", "Deleted.")}
                            onKeep={() => close(`story:delete:${st.id}:${box}`)}
                          />
                        )}
                      </>
                    )
                  : undefined
              }
            />
          ) : (
            <Empty Icon={PenLine}>Write your first story: a time at work, college, an internship or volunteering. Keep each part short.</Empty>
          )}
        </Section>
        )}

        {(!viewer || me.education.length > 0) && (
        <Section title="Education" note={fromResume} action={own && addControl("education", "+ Add")}>
          {own && isOpen("education", null) && (
            <EducationForm
              onSave={edits && ((input) => edits.saveEducation(null, input))}
              onDone={() => close("education:add", "Saved.")}
              onCancel={() => close("education:add")}
            />
          )}
          {me.education.length ? (
            <ul className="flex flex-col gap-3">
              {me.education.map((e, i) => (
                <li key={e.added?.id ?? `resume-${i}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3.5">
                  <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-[12px] bg-surface-2 text-muted">
                    <BookOpen size={20} {...ICON} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <b className="text-[0.96rem] font-semibold [overflow-wrap:anywhere]">{e.qualification}</b>
                    <span className="text-[0.8rem] text-muted [overflow-wrap:anywhere]">{[e.institution, e.year].filter(Boolean).join(" · ")}</span>
                    {own && e.added && rowControls("education", e.added.id, e.qualification)}
                    {own && e.added && isOpen("education", e.added.id) && (
                      <EducationForm
                        item={e}
                        onSave={edits && ((input) => edits.saveEducation(e.added!.id, input))}
                        onDone={() => close(`education:edit:${e.added!.id}`, "Saved.")}
                        onCancel={() => close(`education:edit:${e.added!.id}`)}
                      />
                    )}
                    {own && e.added && isOpen("education", e.added.id, "delete") && (
                      <ConfirmDelete
                        question="Delete this?"
                        onDelete={edits && (() => edits.deleteEducation(e.added!.id))}
                        onDeleted={() => close("education:add", "Deleted.")}
                        onKeep={() => close(`education:delete:${e.added!.id}`)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty Icon={BookOpen}>Degrees and courses fill in from your resume, or add them by hand.</Empty>
          )}
        </Section>
        )}

        {(!viewer || me.skills.have.length + me.skills.weak.length + me.skills.missing.length > 0) && (
        <Section title="Skills" note={viewer ? "from their resume and proof tasks" : "from your resume and proof tasks"}>
          {me.skills.have.length + me.skills.weak.length + me.skills.missing.length === 0 ? (
            <Empty Icon={FileText}>Your skills and gaps fill in from your resume.</Empty>
          ) : (
            <div className={`grid gap-5 ${own || gapsShown ? "min-[760px]:grid-cols-3" : ""}`}>
              <SkillCol name="Have" names={me.skills.have} status="met" />
              {(own || gapsShown) && <SkillCol name="Weak" names={me.skills.weak} status="weak" />}
              {(own || gapsShown) && <SkillCol name="Missing" names={me.skills.missing} status="missing" />}
            </div>
          )}
          {viewer && gapsShown && gapsNote && <Note>{gapsNote}</Note>}
          {asOthers && !gapsShown && <Note>Your gaps show only to the people you chose under &ldquo;Your gaps show to&rdquo; in Account settings.</Note>}
        </Section>
        )}

        {/* Nearby lines come from the target role and the gaps, so only the person sees them. */}
        {own && me.nearby && (
          <Section title="Nearby lines" note="roles that share your skills" action={<More href="/map">See on map</More>}>
            <NearbyLinesList nearby={me.nearby} changeRoleHref={me.changeRoleHref} />
          </Section>
        )}

        {(!viewer || me.interests.length > 0) && (
        <Section title="Interests" note="anything, not only work">
          {own ? (
            <InterestsEditor interests={me.interests} onAdd={edits?.addInterest} onRemove={edits?.removeInterest} say={say} />
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Interests">
              {me.interests.map((t) => (
                <li key={t} className="min-w-0 max-w-full rounded-full bg-surface-2 px-2.5 py-1 text-[0.78rem] [overflow-wrap:anywhere]">
                  {t}
                </li>
              ))}
            </ul>
          )}
          {asOthers && me.interests.length === 0 && <Note>Interests you add show on your profile to everyone who can open it.</Note>}
        </Section>
        )}

        {/* Practice confidence (FR-23) is the person's own rating, so only they see it: never "View as others", the
            public profile or a company. It is a separate prop, so it is never part of `others`. */}
        {own && practice && (
          <Section title="Practice confidence" note="only you see this" action={<More href="/practice">Practise</More>}>
            {practice.length ? (
              <ul className="flex flex-col gap-2.5">
                {practice.map((t) => (
                  <li key={t.skillId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[0.88rem] min-[560px]:grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto]">
                    <b className="min-w-0 font-semibold [overflow-wrap:anywhere]">{t.name}</b>
                    <ConfidenceSpark ratings={t.ratings} className="col-span-2 row-start-2 max-h-9 min-[560px]:col-span-1 min-[560px]:row-start-auto" />
                    <span className="whitespace-nowrap text-[0.76rem] text-muted min-[560px]:col-start-3 min-[560px]:row-start-1">
                      {confidenceWord(t.ratings[t.ratings.length - 1])} · {sessionsText(t.ratings.length)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty Icon={MessageSquareText}>Practise a question and rate how sure you feel to start your trend.</Empty>
            )}
            <p className="text-[0.78rem] text-muted">How sure you said you felt after each answer. Not a score, and it never fills a goal.</p>
          </Section>
        )}

        {(!viewer || me.proofs.length > 0) && (
        <Section title="Proof of work" note={viewer ? "tasks finished on CareerMetro" : "tasks you finished on your path"}>
          {me.proofs.length ? (
            <ul className="flex flex-col gap-2">
              {me.proofs.map((p, i) => (
                <li key={i} className="flex items-center gap-3 rounded-[14px] border border-line px-3.5 py-3">
                  <FlaskConical size={18} {...ICON} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[0.88rem] font-[550] [overflow-wrap:anywhere]">{p.title}</b>
                    <small className="text-[0.76rem] text-muted [overflow-wrap:anywhere]">{p.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty Icon={FlaskConical}>Your proof appears here as you meet goals.</Empty>
          )}
        </Section>
        )}
      </div>

      <aside
        aria-label="Your settings"
        className="flex min-w-0 flex-col [&>section:first-child]:pt-0 [&>section:last-child]:border-b-0 [&>section]:flex [&>section]:flex-col [&>section]:gap-2.5 [&>section]:border-b [&>section]:border-line [&>section]:py-[18px]"
      >
        {own && (
          <section>
            <RailHead name="Resume" note="private" />
            {hasResume ? (
              <>
                <div className="flex items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-[0.84rem]">
                  <FileText size={18} {...ICON} className="shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {me.resumeSample ? "Sample resume" : "Your resume"}
                      {me.resumeSample && <SampleTag />}
                    </span>
                    <small className="block text-[0.72rem] text-muted">
                      {me.resumeSample ? `Added ${me.resumeReadOn} · replace it with your own` : `Read ${me.resumeReadOn} · only you see it`}
                    </small>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href="/start" className={`${btn} border border-line bg-surface px-[11px] py-1.5 text-[0.8rem] text-ink hover:bg-surface-2`}>
                    Replace
                  </Link>
                  <Link href="/builder" className={`${btn} px-[11px] py-1.5 text-[0.8rem] text-muted hover:text-ink`}>
                    Edit in builder
                  </Link>
                </div>
              </>
            ) : (
              <Link href="/today" className={`${btn} self-start bg-accent px-[11px] py-1.5 text-[0.8rem] text-on-accent`}>
                Add resume
              </Link>
            )}
          </section>
        )}
        {(!viewer || me.certifications.length > 0) && (
        <section>
          <RailHead id={certsHeading} name="Certifications" note={`${me.certifications.filter((c) => c.status === "verified").length} verified`} />
          <ProfileCertifications certs={me.certifications} mode={own ? "own" : "public"} ownerName={me.name} onCheck={onCheckCertificate} headingId={certsHeading} />
          {own && (
            <Link href="/today" className="inline-flex min-h-11 items-center gap-1 self-start text-[0.82rem] font-[550] text-muted hover:text-ink">
              Add one from a goal on Today
              <ArrowRight size={15} {...ICON} />
            </Link>
          )}
        </section>
        )}
        {own && (
          <section>
            <RailHead name="Who sees what" />
            {searchSwitches}
            {whoSees ? (
              <>
                <p className="text-[0.84rem]">
                  <b className="font-semibold">{whoSees.visibility}</b>
                  <small className="block text-[0.76rem] text-muted">
                    {whoSees.link ? `Your link: careermetro.com/u/${whoSees.link}` : "Pick a username for your profile link."}
                  </small>
                </p>
                <p className="text-[0.8rem] text-muted">{whoSees.shown.length ? `Shows ${whoSees.shown.join(", ")}.` : "Shows your name and headline only."}</p>
              </>
            ) : (
              <p className="text-[0.8rem] text-muted">Example data.</p>
            )}
            <Link href="/settings#acc-privacy" className="inline-flex min-h-11 items-center gap-1 self-start text-[0.82rem] font-[550] text-muted hover:text-ink">
              Change in Account settings
              <ArrowRight size={15} {...ICON} />
            </Link>
          </section>
        )}
        <section>
          <RailHead name="Never shown" />
          <p className="flex items-start gap-2 text-[0.78rem] text-muted">
            <ShieldCheck size={15} {...ICON} className="mt-0.5 shrink-0 text-muted" />
            Phone, email, salary, notice period and resume text are never on a profile.
          </p>
        </section>
      </aside>
      {toast}
    </div>
  );
}

type EditKind = "role" | "education" | "story";
/**
 * The one Me form or delete question open: a role, education row or story by id, or a new one (`id` null). A story
 * shows in each of its boxes, so `box` says which card's Edit or Delete was pressed.
 */
type Editing = { kind: EditKind; id: string | null; mode: "edit" | "delete"; box?: string } | null;

const storyCount = (stories: Story[]) => {
  const empty = STORY_BOXES.filter((b) => !stories.some((s) => s.boxes.includes(b))).length;
  return `${stories.length} ${stories.length === 1 ? "story" : "stories"}${empty ? ` · ${empty} ${empty === 1 ? "box" : "boxes"} empty` : ""}`;
};

function Section({
  title,
  note,
  action,
  first = false,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={`flex flex-col gap-3 ${first ? "pt-2" : "mt-5 border-t border-line pt-5"}`}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[1.05rem] font-semibold">{title}</h3>
        {note && <span className={label}>{note}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

const More = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="inline-flex items-center gap-1 text-[0.82rem] font-[550] text-muted hover:text-ink">
    {children}
    <ArrowRight size={15} {...ICON} />
  </Link>
);

/** With an `id`, the heading can take focus from code (tabIndex -1), e.g. when the item that had it goes away. */
const RailHead = ({ name, note, id }: { name: string; note?: string; id?: string }) => (
  <h3
    id={id}
    tabIndex={id ? -1 : undefined}
    className="flex items-center justify-between gap-2.5 text-[0.95rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
  >
    {name}
    {note && <span className={label}>{note}</span>}
  </h3>
);

const Empty = ({ Icon, children }: { Icon: typeof FileText; children: ReactNode }) => (
  <p className="flex items-start gap-2.5 rounded-[14px] border border-dashed border-line px-3.5 py-3 text-[0.86rem] text-muted">
    <Icon size={18} {...ICON} className="mt-0.5 shrink-0" />
    {children}
  </p>
);

const Note = ({ children }: { children: ReactNode }) => (
  <p className="flex items-center gap-1.5 text-[0.76rem] text-muted">
    <Lock size={13} {...ICON} />
    {children}
  </p>
);

function Journey({ stops }: { stops: JourneyStop[] }) {
  return (
    // Scrolls sideways on a phone, so it takes keyboard focus to scroll with the arrow keys.
    <ol tabIndex={0} aria-label="Journey" className="grid auto-cols-[minmax(96px,1fr)] grid-flow-col overflow-x-auto pt-1 focus-visible:outline-2 focus-visible:outline-accent">
      {stops.map((s, i) => (
        <li key={i} className="relative flex min-w-0 flex-col gap-[3px] pb-1 pr-2.5 pt-[26px] text-[0.8rem]">
          <i
            aria-hidden="true"
            className={`absolute left-0 top-[9px] h-1 ${i === stops.length - 1 ? "w-[18px]" : "right-0"} ${s.state === "done" ? "bg-accent" : s.state === "now" ? "bg-[linear-gradient(90deg,var(--accent)_0_18px,var(--line)_18px)]" : "bg-line"}`}
          />
          <i
            aria-hidden="true"
            className={`absolute left-0 top-0.5 h-[18px] w-[18px] rounded-full border-[3px] ${s.state === "done" ? "border-accent bg-accent" : s.state === "now" ? "border-accent bg-surface shadow-[0_0_0_5px_var(--accent-soft)]" : "border-line bg-surface"}`}
          />
          <b className={`text-[0.84rem] ${s.state === "future" ? "font-medium text-muted" : "font-semibold"}`}>
            {s.name}
            {s.state === "now" && <span className="sr-only"> (you are here)</span>}
          </b>
          <small className="font-mono text-[0.68rem] uppercase tracking-[0.04em] text-muted">{s.detail}</small>
        </li>
      ))}
    </ol>
  );
}

function SkillCol({ name, names, status }: { name: string; names: string[]; status: "met" | "weak" | "missing" }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={label}>
        {name} · {names.length}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <StatusChip key={n} status={status} label={n} />
        ))}
      </div>
    </div>
  );
}

function Smart({ letters }: { letters: Story["smart"] }) {
  return (
    <span role="img" className="inline-flex gap-0.5" aria-label={`SMART check: ${letters.join(", ") || "none"} met`}>
      {SMART.map((ch) => (
        <i
          key={ch}
          aria-hidden="true"
          className={`inline-grid h-4 w-4 place-items-center rounded-[4px] border font-mono text-[0.62rem] not-italic ${letters.includes(ch) ? "border-ink bg-ink text-surface" : "border-line text-muted"}`}
        >
          {ch}
        </i>
      ))}
    </span>
  );
}

const EMPTY_BOX: Partial<Record<(typeof STORY_BOXES)[number], string>> = {
  "Speaking up": "disagreed with a decision and said so",
  Learning: "learned something fast for work",
  Ownership: "took charge without being asked",
};

/**
 * The Board and List layouts of saved stories by box. `own` shows the SMART check and its hint, which are the
 * person's own coaching; `controls` adds Edit and Delete to each card.
 */
function Stories({ stories, own, controls }: { stories: Story[]; own: boolean; controls?: (s: Story, box: string) => ReactNode }) {
  const [view, setView] = useState<"board" | "list">("board");
  return (
    <>
      <div role="group" aria-label="Layout" className="inline-flex gap-0.5 self-start rounded-full bg-surface-2 p-[3px]">
        {(["board", "list"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} className={seg} onClick={() => setView(v)}>
            {v === "board" ? "Board" : "List"}
          </button>
        ))}
      </div>
      <div className={view === "board" ? "grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-1.5" : "flex flex-col gap-3.5"}>
        {STORY_BOXES.map((box) => {
          const inBox = stories.filter((s) => s.boxes.includes(box));
          return (
            <section
              key={box}
              aria-label={box}
              className={`flex min-w-0 flex-col gap-2 rounded-[14px] ${view === "board" ? "bg-surface-2 p-2.5" : ""}`}
            >
              <div className="flex items-baseline gap-2">
                <b className="min-w-0 text-[0.88rem] [overflow-wrap:anywhere]">{box}</b>
                <span className="font-mono text-[0.7rem] text-muted">{inBox.length}</span>
              </div>
              {inBox.length ? (
                inBox.map((s) => <StoryCard key={s.id} s={s} own={own} controls={controls && (() => controls(s, box))} />)
              ) : (
                <p className="rounded-[12px] border border-dashed border-line px-3 py-2.5 text-[0.8rem] text-muted">
                  No story yet. Think of a time you {EMPTY_BOX[box] ?? "did this"}.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

type ExperienceCheck = NonNullable<MeProfile["experience"][number]["check"]>;

/** The work-email check of a job (FR-47) in words. Neutral colours: cobalt means progress and red, amber, green gaps. */
function JobCheckBadge({ check, own }: { check: ExperienceCheck; own: boolean }) {
  const verified = check.state === "verified" || check.state === "verified_while_there";
  const Icon = verified ? BadgeCheck : check.state === "review" ? Hourglass : check.state === "self_declared" ? PenLine : CircleDashed;
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 text-[0.76rem] ${verified ? "font-medium text-ink" : "text-muted"}`}>
      <Icon size={14} {...ICON} />
      {experienceCheckText(check, own)}
    </span>
  );
}

/** "Verify with your work email": a code to the person's email at that company. The address is never shown or kept. */
function VerifyJob({ employer, jobCheck }: { employer: string; jobCheck?: { open: boolean; actions?: JoinActions } }) {
  return (
    <details className="group mt-0.5 rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[0.84rem] font-medium [&::-webkit-details-marker]:hidden">
        <Mail size={15} {...ICON} />
        Verify with your work email
      </summary>
      <div className="mt-2.5">
        {jobCheck?.open ? (
          <JoinForm
            actions={jobCheck.actions}
            hint={`Your email at ${employer}. We send a 6-digit code there. Companies see only that it's verified, never the address.`}
            doneText="Checked. Updating your profile…"
          />
        ) : (
          <p className="text-[0.84rem] text-muted">Work-email checks open soon.</p>
        )}
      </div>
    </details>
  );
}

function StoryCard({ s, own, controls }: { s: Story; own: boolean; controls?: () => ReactNode }) {
  return (
    <details className="group rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
        <b className="text-[0.86rem] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{s.title}</b>
        <small className="text-[0.74rem] text-muted [overflow-wrap:anywhere]">{s.where}</small>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {own && <Smart letters={s.smart} />}
          {s.confirmed && (
            <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted">
              <BadgeCheck size={13} {...ICON} />
              Confirmed
            </span>
          )}
          {s.fromGoal && <span className="text-[0.7rem] text-muted">{own ? "From your goal" : "From a goal"}</span>}
        </span>
      </summary>
      <dl className="mt-2 flex flex-col gap-0.5 text-[0.8rem] [&>dd]:[overflow-wrap:anywhere] [&>dt:not(:first-child)]:mt-1.5 [&>dt]:font-mono [&>dt]:text-[0.66rem] [&>dt]:uppercase [&>dt]:tracking-[0.05em] [&>dt]:text-muted">
        <dt>Situation</dt>
        <dd>{s.situation}</dd>
        <dt>Task</dt>
        <dd>{s.task}</dd>
        <dt>Action</dt>
        <dd>{s.action}</dd>
        <dt>Result</dt>
        <dd>{s.result}</dd>
      </dl>
      {own && s.hint && <p className="mt-2 border-t border-dashed border-line pt-1.5 text-[0.76rem] text-muted [overflow-wrap:anywhere]">{s.hint}</p>}
      {controls?.()}
    </details>
  );
}
