"use client";

import { ArrowRight, BadgeCheck, BookOpen, CircleDashed, Eye, FileText, FlaskConical, Hourglass, Lock, Mail, MessageSquareText, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { JoinForm } from "@/components/corporate/join-form";
import { ProfileCertifications, type CredlyCheckResult } from "@/components/me/certifications";
import { EliteBadge } from "@/components/elite/elite-badge";
import { NearbyLinesList } from "@/components/nearby/nearby-lines";
import { ConfidenceSpark, confidenceWord, sessionsText } from "@/components/practice/confidence-spark";
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
 * Parts that need their own tables are marked "soon".
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
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <h1 className="text-[1.7rem] font-semibold leading-[1.1]">
              {me.name}
              {eliteBadge && <EliteBadge className="ml-2.5" />}
            </h1>
            {me.headline && <p className="text-[0.95rem]">{me.headline}</p>}
            {!viewer && <span className="self-start rounded-full bg-surface-2 px-[11px] py-[3px] text-[0.84rem] font-medium text-muted">Status · soon</span>}
            {/* The target role says the person is looking, so others see it only when they turn it on in Account settings. */}
            {(own || me.aim) && <p className="text-[0.92rem] text-muted">{me.aim ? `Aiming for ${me.aim}` : "Picking a target role"}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1 self-center">
            {own && (
              <button ref={view} type="button" className={ghost} onClick={() => toggle(true)}>
                <Eye size={17} {...ICON} />
                View as others
              </button>
            )}
            {own && <span className={quiet}>Change status · soon</span>}
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
          action={own && <Soonish>+ Add role</Soonish>}
        >
          {me.experience.length ? (
            <ul className="flex flex-col">
              {me.experience.map((e, i) => (
                <li key={e.id} className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-3.5 pb-[18px]">
                  {i < me.experience.length - 1 && <i aria-hidden="true" className="absolute bottom-0.5 left-[21px] top-12 w-0.5 bg-line" />}
                  <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-[12px] bg-surface-2 font-display font-semibold">
                    {initials(e.employer)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <b className="text-[0.96rem] font-semibold">{e.title}</b>
                      {e.current && (
                        <span className="rounded-full bg-surface-2 px-[7px] py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.06em]">
                          Current
                        </span>
                      )}
                    </div>
                    <span className="text-[0.8rem] text-muted">
                      {e.employer} · {e.dates}
                    </span>
                    {e.check && <JobCheckBadge check={e.check} own={own} />}
                    {own && e.check?.state === "not_verified" && <VerifyJob employer={e.employer} jobCheck={jobCheck} />}
                    {own && e.highlights.length > 0 && (
                      <ul className="mt-0.5 flex list-disc flex-col gap-[3px] pl-[18px] text-[0.86rem]">
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
            <Empty Icon={FileText}>Your roles fill in from your resume.</Empty>
          )}
          {asOthers && me.experience.length > 0 && mine.experience.some((e) => e.highlights.length) && (
            <Note>Lines from your resume stay private. Your stories show what you did.</Note>
          )}
        </Section>
        )}

        {(!viewer || me.stories.length > 0) && (
        <Section title={viewer ? "Stories" : "Your stories"} note={me.stories.length ? storyCount(me.stories) : "none yet"} action={own && <Soonish>+ Add story</Soonish>}>
          <p className="text-[0.86rem] text-muted">
            Every piece of work you have done, as a short Situation, Task, Action, Result story, sorted into what interviewers ask about. Recruiters
            see it when they open your profile.
          </p>
          {me.stories.length ? (
            <Stories stories={me.stories} />
          ) : (
            <Empty Icon={PenLine}>
              Your stories will be drafted from your resume, college projects, internships and goals you prove, and you edit them before they are
              saved · soon.
            </Empty>
          )}
        </Section>
        )}

        {(!viewer || me.education.length > 0) && (
        <Section title="Education" note={fromResume} action={own && <Soonish>+ Add</Soonish>}>
          {me.education.length ? (
            <ul className="flex flex-col gap-3">
              {me.education.map((e, i) => (
                <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3.5">
                  <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-[12px] bg-surface-2 text-muted">
                    <BookOpen size={20} {...ICON} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <b className="text-[0.96rem] font-semibold">{e.qualification}</b>
                    <span className="text-[0.8rem] text-muted">{[e.institution, e.year].filter(Boolean).join(" · ")}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty Icon={BookOpen}>Degrees and courses fill in from your resume.</Empty>
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
          <div className="flex flex-wrap gap-1.5">
            {me.interests.map((t) => (
              <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-[0.78rem]">
                {t}
              </span>
            ))}
            {own && <span className="rounded-full border border-dashed border-muted px-2.5 py-1 text-[0.78rem] text-muted">+ Add · soon</span>}
          </div>
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
                    <b className="min-w-0 font-semibold">{t.name}</b>
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
                    <b className="block text-[0.88rem] font-[550]">{p.title}</b>
                    <small className="text-[0.76rem] text-muted">{p.detail}</small>
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
                  <span>
                    Your resume
                    <small className="block text-[0.72rem] text-muted">Read {me.resumeReadOn} · only you see it</small>
                  </span>
                </div>
                <span className="text-[0.8rem] text-muted">Replace and Edit in builder · soon</span>
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
    </div>
  );
}

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

const Soonish = ({ children }: { children: ReactNode }) => <span className="text-[0.82rem] font-[550] text-muted">{children} · soon</span>;

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
    <div className="flex flex-col gap-2">
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
    <span className="inline-flex gap-0.5" aria-label={`SMART check: ${letters.join(", ") || "none"} met`}>
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

function Stories({ stories }: { stories: Story[] }) {
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
                <b className="text-[0.88rem]">{box}</b>
                <span className="font-mono text-[0.7rem] text-muted">{inBox.length}</span>
              </div>
              {inBox.length ? (
                inBox.map((s) => <StoryCard key={s.id} s={s} />)
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

function StoryCard({ s }: { s: Story }) {
  return (
    <details className="group rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
        <b className="text-[0.86rem] font-semibold leading-[1.3]">{s.title}</b>
        <small className="text-[0.74rem] text-muted">{s.where}</small>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Smart letters={s.smart} />
          {s.confirmed && (
            <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted">
              <BadgeCheck size={13} {...ICON} />
              Confirmed
            </span>
          )}
          {s.fromGoal && <span className="text-[0.7rem] text-muted">From your goal</span>}
        </span>
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[0.8rem] [&>dt]:font-mono [&>dt]:text-[0.66rem] [&>dt]:uppercase [&>dt]:tracking-[0.05em] [&>dt]:text-muted">
        <dt>Situation</dt>
        <dd>{s.situation}</dd>
        <dt>Task</dt>
        <dd>{s.task}</dd>
        <dt>Action</dt>
        <dd>{s.action}</dd>
        <dt>Result</dt>
        <dd>{s.result}</dd>
      </dl>
      {s.hint && <p className="mt-2 border-t border-dashed border-line pt-1.5 text-[0.76rem] text-muted">{s.hint}</p>}
    </details>
  );
}
