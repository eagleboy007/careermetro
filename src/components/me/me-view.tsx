"use client";

import { ArrowRight, BadgeCheck, BookOpen, Eye, FileText, FlaskConical, Lock, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import { initials } from "@/lib/departures/filter";
import { SMART, STORY_BOXES, type JourneyStop, type MeProfile, type Story } from "@/lib/schemas";

const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-[550]";
const ghost = `${btn} border border-line bg-surface px-[15px] py-[9px] text-[0.86rem] text-ink hover:bg-surface-2`;
const quiet = `${btn} px-2 py-[9px] text-[0.86rem] text-muted`;
const label = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

/**
 * Your profile (handoff section 11): the person's own profile with edit controls, and "View as others", which hides
 * private parts and edit controls the way a public profile will. Parts that need their own tables are marked "soon".
 */
export function MeView({ me }: { me: MeProfile }) {
  const [asOthers, setAsOthers] = useState(false);
  const own = !asOthers;
  const hasResume = me.resumeReadOn !== null;
  return (
    <div className="grid min-w-0 gap-6 min-[760px]:grid-cols-[minmax(0,1fr)_300px] min-[760px]:gap-10">
      <div className="flex min-w-0 flex-col">
        {asOthers && (
          <div role="status" className="mb-1.5 flex flex-wrap items-center gap-2.5 rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-[0.85rem]">
            <Eye size={16} {...ICON} className="shrink-0 text-accent" />
            <span className="flex-1">You are seeing your profile the way other people will. Private parts and your gaps are hidden.</span>
            <button type="button" className={`${ghost} px-[11px] py-1.5 text-[0.8rem]`} onClick={() => setAsOthers(false)}>
              Back to editing
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-[18px]">
          <span aria-hidden="true" className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[1.2rem] font-medium">
            {initials(me.name)}
          </span>
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <h2 className="text-[1.7rem] font-semibold leading-[1.1]">{me.name}</h2>
            <span className="self-start rounded-full bg-surface-2 px-[11px] py-[3px] text-[0.84rem] font-medium text-muted">Status · soon</span>
            <p className="text-[0.92rem] text-muted">{me.aim ? `Aiming for ${me.aim}` : "Picking a target role"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1 self-center">
            {own && (
              <button type="button" className={ghost} onClick={() => setAsOthers(true)}>
                <Eye size={17} {...ICON} />
                View as others
              </button>
            )}
            {own && <span className={quiet}>Change status · soon</span>}
            {own && <span className={quiet}>Account settings · soon</span>}
          </div>
        </div>

        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-y border-line py-3 text-[0.82rem] text-muted">
          {me.stats
            .filter((s) => own || !s.label.includes("next role"))
            .map((s) => (
              <span key={s.label}>
                <b className="mr-1 font-mono font-medium text-ink">{s.value}</b>
                {s.label}
              </span>
            ))}
        </p>

        <Section first title="Your journey" note={me.journeyLabel} action={own && <More href="/map">Open map</More>}>
          <Journey stops={me.journey} />
        </Section>

        <Section title="Experience" note={me.experienceTotal ? `${me.experienceTotal} · from your resume` : "from your resume"} action={own && <Soonish>+ Add role</Soonish>}>
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
                      {e.current && <span className="rounded-full bg-surface-2 px-[7px] py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.06em]">Current</span>}
                    </div>
                    <span className="text-[0.8rem] text-muted">
                      {e.employer} · {e.dates}
                    </span>
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
          {!own && me.experience.some((e) => e.highlights.length) && <Note>Lines from your resume stay private. Your stories show what you did.</Note>}
        </Section>

        <Section
          title="Your stories"
          note={me.stories.length ? storyCount(me.stories) : "none yet"}
          action={own && <Soonish>+ Add story</Soonish>}
        >
          <p className="text-[0.86rem] text-muted">
            Every piece of work you have done, as a short Situation, Task, Action, Result story, sorted into what interviewers ask about. Recruiters see it when they
            open your profile.
          </p>
          {me.stories.length ? (
            <Stories stories={me.stories} />
          ) : (
            <Empty Icon={PenLine}>
              Your stories will be drafted from your resume, college projects, internships and goals you prove, and you edit them before they are saved · soon.
            </Empty>
          )}
        </Section>

        <Section title="Education" note="from your resume" action={own && <Soonish>+ Add</Soonish>}>
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

        <Section title="Skills" note="from your resume and proof tasks">
          {me.skills.have.length + me.skills.weak.length + me.skills.missing.length === 0 ? (
            <Empty Icon={FileText}>Your skills and gaps fill in from your resume.</Empty>
          ) : (
            <div className={`grid gap-5 ${own ? "min-[760px]:grid-cols-3" : ""}`}>
              <SkillCol name="Have" names={me.skills.have} status="met" />
              {own && <SkillCol name="Weak" names={me.skills.weak} status="weak" />}
              {own && <SkillCol name="Missing" names={me.skills.missing} status="missing" />}
            </div>
          )}
          {!own && <Note>Your gaps show only to connections unless you turn that on.</Note>}
        </Section>

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

        <Section title="Proof of work" note="tasks you finished on your path">
          {me.proofs.length ? (
            <ul className="flex flex-col gap-2">
              {me.proofs.map((p) => (
                <li key={p.title} className="flex items-center gap-3 rounded-[14px] border border-line px-3.5 py-3">
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
      </div>

      <aside aria-label="Your settings" className="flex min-w-0 flex-col [&>section:first-child]:pt-0 [&>section:last-child]:border-b-0 [&>section]:flex [&>section]:flex-col [&>section]:gap-2.5 [&>section]:border-b [&>section]:border-line [&>section]:py-[18px]">
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
        <section>
          <RailHead name="Certifications" note={`${me.certifications.filter((c) => c.verified).length} verified`} />
          {me.certifications.length ? (
            <ul className="flex flex-col gap-1.5">
              {me.certifications.map((c) => (
                <li key={c.name} className="flex items-center gap-2 text-[0.82rem]">
                  <BadgeCheck size={16} {...ICON} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    {c.name}
                    <small className="block text-[0.72rem] text-muted">{c.verified ? "Credly badge checked" : "From your resume, not checked yet"}</small>
                  </span>
                  {c.verified && <StatusChip status="met" label="Verified" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.8rem] text-muted">None yet.</p>
          )}
          {own && <span className="text-[0.8rem] text-muted">Add from Credly · soon</span>}
        </section>
        {own && (
          <section>
            <RailHead name="Who sees what" note="soon" />
            <ul className="flex flex-col gap-2.5 text-[0.84rem] text-muted">
              {[
                ["Looking for a job", true],
                ["Show me in people lists", true],
                ["Show my pitstop on the map", true],
                ["Show my gaps to everyone", false],
              ].map(([name, on]) => (
                <li key={name as string} className="flex items-center gap-2">
                  <i aria-hidden="true" className={`relative h-5 w-9 rounded-full opacity-50 after:absolute after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface ${on ? "bg-ink after:left-[18px]" : "bg-line after:left-0.5"}`} />
                  {name} <span className="sr-only">{on ? "(on by default)" : "(off by default)"}</span>
                </li>
              ))}
            </ul>
            <small className="text-[0.74rem] text-muted">These switches come with the profile settings. Until then nobody else can see your profile.</small>
          </section>
        )}
        <section>
          <RailHead name="Never shown" />
          <p className="flex items-start gap-2 text-[0.78rem] text-muted">
            <ShieldCheck size={15} {...ICON} className="mt-0.5 shrink-0 text-good" />
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

function Section({ title, note, action, first = false, children }: { title: string; note?: string; action?: ReactNode; first?: boolean; children: ReactNode }) {
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

const RailHead = ({ name, note }: { name: string; note?: string }) => (
  <h3 className="flex items-center justify-between gap-2.5 text-[0.95rem] font-semibold">
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
    <ol className="grid auto-cols-[minmax(96px,1fr)] grid-flow-col overflow-x-auto pt-1">
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
            <section key={box} aria-label={box} className={`flex min-w-0 flex-col gap-2 rounded-[14px] ${view === "board" ? "bg-surface-2 p-2.5" : ""}`}>
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
