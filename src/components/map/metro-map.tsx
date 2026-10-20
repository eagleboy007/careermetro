"use client";

import { LazyCertificateForm, preloadCertificateForm } from "@/components/proof/certificate-form-lazy";
import { NotConfirmedNote } from "@/components/proof/not-confirmed-note";
import { ChoiceTag } from "@/components/ui/choice-tag";
import type { CertificateInput, CertificateResult } from "@/lib/proofs/result";
import { ArrowLeft, Award, BookOpen, BriefcaseBusiness, CircleHelp, Map as MapIcon, Pencil, Play, Plus, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { RemoveGoal } from "@/components/gaps/job-check-actions";
import { NotForMe } from "./not-for-me";
import { Cta, ghost, ICON, Key, Label, List, Panel, plural, seg, Soon, type Item } from "./map-parts";
import { layoutLine, pitstopLabel, type Layout, type PitstopKind, type Station } from "@/lib/map/layout";
import { defaultZoom, layoutLife, type LifeZoom } from "@/lib/map/life-layout";
import type { LifeLine, MapLine } from "@/lib/schemas";
// The Life line shows only after "Life line" is picked, so it loads then, not with the map.
const LifeSvg = dynamic(() => import("./life-line").then((m) => m.LifeSvg));
const LifeSheet = dynamic(() => import("./life-line").then((m) => m.LifeSheet));
const LifeLegend = dynamic(() => import("./life-line").then((m) => m.LifeLegend));
import { emptySentence, sharesSentence, toAddText } from "@/components/nearby/nearby-lines";

const NAME_MAX = 18;
const short = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1).trimEnd()}…` : s);

type Pitstop = Extract<Station, { kind: PitstopKind }>;

/**
 * The Map (handoff section 7): the person's line as an SVG, with a side panel for the pitstop they tap. `line` is null
 * before there is a resume; the map then shows a locked card over an empty grid.
 */
export function MetroMap({
  line,
  life = null,
  onAddCertificate,
  initialMode = "role",
}: {
  line: MapLine | null;
  life?: LifeLine | null;
  /** Which map shows first; /design opens some examples on the Life line. */
  initialMode?: "role" | "life";
  /** Saves a certificate for a prove pitstop; without it the form only says nothing is saved. */
  onAddCertificate?: (input: CertificateInput) => Promise<CertificateResult>;
}) {
  const layout = useMemo(() => (line ? layoutLine(line) : null), [line]);
  const [mode, setMode] = useState<"role" | "life">(initialMode);
  const [zoom, setZoom] = useState<LifeZoom>(() => (life ? defaultZoom(life) : "all"));
  const lifeLayout = useMemo(() => (life ? layoutLife(life, zoom) : null), [life, zoom]);
  const [lifeSelected, setLifeSelected] = useState<string | null>(null);
  const showLife = mode === "life" && life !== null && lifeLayout !== null;
  const [selected, setSelected] = useState<string | null>(() => layout?.stations.find((s) => s.state === "now")?.id ?? null);
  const [replay, setReplay] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // On a narrow screen the map scrolls sideways; open it with the train in view.
  // The Life line opens at Now.
  useEffect(() => {
    const box = scroller.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    if (showLife) box.scrollLeft = box.scrollWidth;
    else if (layout) box.scrollLeft = (layout.train.x / layout.width) * box.scrollWidth - box.clientWidth / 2;
  }, [layout, showLife, zoom]);

  return (
    <div className={`grid min-w-0 ${line ? "min-[960px]:min-h-[700px] min-[960px]:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
      <div className={`flex min-w-0 flex-col gap-3 pb-6 ${line ? "min-[960px]:border-r min-[960px]:border-line min-[960px]:pr-6" : ""}`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[1.5rem] font-semibold">Your journey</h2>
          {line && (
            <div role="group" aria-label="Which map" className="inline-flex gap-0.5 rounded-full bg-surface-2 p-[3px]">
              <button type="button" aria-pressed={mode === "role"} className={seg} onClick={() => setMode("role")}>
                Role line
              </button>
              <button type="button" aria-pressed={mode === "life"} disabled={!life} className={`${seg} disabled:cursor-not-allowed`} onClick={() => setMode("life")}>
                Life line
              </button>
            </div>
          )}
          {showLife && (
            <div role="group" aria-label="Time range" className="inline-flex gap-0.5 rounded-full bg-surface-2 p-[3px]">
              {(["recent", "all"] as const).map((z) => (
                <button key={z} type="button" aria-pressed={zoom === z} className={seg} onClick={() => setZoom(z)}>
                  {z === "recent" ? "Last 5 years" : "Whole career"}
                </button>
              ))}
            </div>
          )}
          {!showLife && line && layout && (
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">
              {line.role.title} · {plural(layout.goalCount, "goal")}, {plural(layout.pitstopCount, "pitstop")}
            </span>
          )}
          {!showLife && line && (
            <div className="flex flex-wrap gap-2 min-[960px]:ml-auto">
              <button type="button" disabled className={`${ghost} cursor-not-allowed opacity-60`}>
                <Plus size={16} {...ICON} />
                Add a pitstop · soon
              </button>
              <button type="button" className={ghost} onClick={() => setReplay((n) => n + 1)}>
                <Play size={16} {...ICON} />
                Replay my ride
              </button>
            </div>
          )}
        </div>
        {showLife && lifeLayout.hidden && (
          <button
            type="button"
            onClick={() => setZoom("all")}
            className="inline-flex items-center gap-2.5 self-start rounded-full border border-dashed border-line bg-surface px-3.5 py-2 text-[0.84rem] text-muted"
          >
            <ArrowLeft size={16} {...ICON} />
            <span>
              <b className="font-semibold text-ink">{plural(lifeLayout.hidden.count, "earlier moment")}</b>, {lifeLayout.hidden.fromYear} to {lifeLayout.hidden.toYear}
            </span>
            <span className="font-medium text-ink underline underline-offset-2">Show whole career</span>
          </button>
        )}
        {!showLife && line && (
          <p className="max-w-[72ch] text-[0.86rem] text-muted">
            Each goal is one gap, named under its pitstops. A goal can have several pitstops: learn (free courses and daily tasks) then prove. Only a prove
            pitstop (a skill check, certification or confirmed work experience) fills the gap and moves your train to the next goal. Your destination is your
            next role, not your last.
          </p>
        )}

        <div ref={scroller} className="relative overflow-x-auto rounded-[20px] border border-line bg-surface">
          {showLife ? (
            <Suspense fallback={null}>
              <LifeSvg layout={lifeLayout} selected={lifeSelected} onSelect={setLifeSelected} />
            </Suspense>
          ) : layout && line ? (
            <MapSvg layout={layout} line={line} selected={selected} onSelect={setSelected} replay={replay} />
          ) : (
            <LockedMap />
          )}
        </div>

        {showLife && (
          <Suspense fallback={null}>
            <LifeLegend />
          </Suspense>
        )}
        {!showLife && line && (
          <ul className="flex flex-wrap items-center gap-4 text-[0.78rem] text-muted" aria-label="Key">
            <Key swatch="bg-accent">Gaps filled with proof ✓</Key>
            <Key swatch="bg-[repeating-linear-gradient(90deg,var(--accent)_0_5px,transparent_5px_10px)]">Getting ready (prep)</Key>
            <Key swatch="bg-line">Still ahead</Key>
            <Key swatch="bg-muted opacity-30">Other people&apos;s lines</Key>
            {layout?.crossings.some((c) => c.nearby) && (
              <li className="inline-flex items-center gap-[7px]">
                <i className="inline-block size-3.5 rounded-full border-[3px] border-ink bg-surface" />
                Interchange with a nearby line
              </li>
            )}
            <li className="inline-flex items-center gap-[7px]">
              <i className="inline-block size-3 rounded-full border-2 border-ink" />
              Tap any pitstop
            </li>
          </ul>
        )}
        {!showLife && line && layout && line.nearby && (
          <NearbyOnMap
            nearby={line.nearby}
            layout={layout}
            onShow={(slug) => {
              setSelected(`x-${slug}`);
              const g = scroller.current?.querySelector<SVGGElement>(`[data-crossing="${slug}"]`);
              // Bring the interchange into the sideways-scrolling map first, then give it focus.
              g?.scrollIntoView({ block: "nearest", inline: "center" });
              g?.focus();
            }}
          />
        )}
        {!showLife && line && (line.choiceGoals?.length ?? 0) > 0 && (
          <ChoiceGoals goals={line.choiceGoals!} pathHref={line.resumeId ? `/resume/${line.resumeId}/path/${line.role.slug}` : null} onAddCertificate={line.resumeId ? onAddCertificate : undefined} />
        )}
      </div>

      {line && layout && (
        <aside aria-live="polite" aria-label={showLife ? "Moment details" : "Pitstop details"} className="flex min-w-0 flex-col gap-3.5 border-t border-line bg-surface px-4 py-5 min-[960px]:border-t-0 min-[960px]:p-[22px]">
          {showLife ? (
            <Suspense fallback={null}>
              <LifeSheet key={`life-${lifeSelected ?? "none"}`} id={lifeSelected} line={life} layout={lifeLayout} onSelect={setLifeSelected} onZoom={() => setZoom("recent")} />
            </Suspense>
          ) : (
            <Sheet key={selected ?? "none"} id={selected} layout={layout} line={line} onAddCertificate={onAddCertificate} />
          )}
        </aside>
      )}
    </div>
  );
}

function MapSvg({
  layout,
  line,
  selected,
  onSelect,
  replay,
}: {
  layout: Layout;
  line: MapLine;
  selected: string | null;
  onSelect: (id: string) => void;
  replay: number;
}) {
  const keyed = (id: string) => ({
    tabIndex: 0,
    role: "button",
    "aria-pressed": selected === id,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(id);
      }
    },
  });
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-label={`Metro map of your line to ${line.role.title}`}
      className="block h-auto w-full"
      style={{ minWidth: Math.max(780, Math.round(layout.width * 0.52)) }}
    >
      <g className="stroke-line opacity-50" aria-hidden="true">
        {layout.gridXs.map((x) => (
          <line key={x} x1={x} y1={20} x2={x} y2={540} strokeWidth={1} />
        ))}
      </g>

      {layout.crossings.map((c) => (
        <path
          key={c.slug}
          d={`M${c.station.x} 20 V540`}
          aria-hidden="true"
          // A Nearby line is drawn in ink, a plain other line in muted grey: neutral line colours, never cobalt.
          className={`fill-none ${c.nearby ? "stroke-ink" : "stroke-muted"} ${selected === `x-${c.slug}` ? "opacity-50" : c.nearby ? "opacity-[0.28]" : "opacity-[0.22]"}`}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c.nearby ? "18 8" : undefined}
        />
      ))}

      <path d={layout.track} className="fill-none stroke-line" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
      <path
        key={`done-${replay}`}
        d={layout.done}
        pathLength={1}
        strokeDasharray="1 1"
        className={`fill-none stroke-accent ${replay ? "animate-[map-draw_1.6s_cubic-bezier(.3,.8,.2,1)_both]" : ""}`}
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={layout.prep} className="fill-none stroke-accent" strokeWidth={10} strokeLinecap="round" strokeDasharray="2 16" />

      <g aria-hidden="true">
        <text x={layout.width - 25} y={58} textAnchor="end" className="fill-ink font-display text-[26px] font-[650] tracking-[-0.01em]">
          {line.role.title}
        </text>
        <text x={layout.width - 25} y={82} textAnchor="end" className="fill-muted font-mono text-[13px] tracking-[0.06em]">
          NEXT DESTINATION · NOT YOUR LAST
        </text>
      </g>

      {layout.crossings.map((c) =>
        c.nearby ? (
          // An interchange station: a solid ring round the pitstop, in ink. It is not a pitstop and never holds the train.
          <circle key={c.slug} aria-hidden="true" cx={c.station.x} cy={c.station.y} r={17} className="fill-surface stroke-ink" strokeWidth={3} />
        ) : (
          <circle key={c.slug} aria-hidden="true" cx={c.station.x} cy={c.station.y} r={16} className="fill-none stroke-muted opacity-60" strokeWidth={2} strokeDasharray="3 4" />
        ),
      )}

      {layout.stations.map((s) => (
        <StationMark key={s.id} s={s} selected={selected === s.id} {...keyed(s.id)} />
      ))}

      {layout.crossings.map((c) => {
        const labelX = c.station.x + (c.labelAtTop ? -14 : 14);
        const labelY = c.labelAtTop ? 40 : 534;
        const near = line.nearby?.lines.find((n) => n.slug === c.slug);
        const shown = c.nearby ? `${c.title} line · nearby` : `${c.title} line`;
        // The name starts with the label on screen (WCAG 2.5.3); a Nearby line adds its share and where it crosses.
        const name = near
          ? `${shown}, interchange at Pitstop ${c.station.n}, ${c.station.name}. Shares ${near.shared} of its ${near.total} key skills with you`
          : shown;
        return (
          <g key={c.slug} data-crossing={c.slug} className="group cursor-pointer outline-none" aria-label={name} {...keyed(`x-${c.slug}`)}>
            {/* A wide, invisible strip along the line, so it is easy to tap. */}
            <rect x={c.station.x - 14} y={20} width={28} height={c.station.y - 40} className="fill-transparent" />
            <rect x={c.station.x - 14} y={c.station.y + 20} width={28} height={520 - c.station.y} className="fill-transparent" />
            <text
              x={labelX}
              y={labelY}
              textAnchor={c.labelAtTop ? "end" : "start"}
              className={`font-mono text-[11px] uppercase tracking-[0.06em] ${c.nearby ? "group-focus-visible:fill-ink" : "group-focus-visible:fill-accent"} ${selected === `x-${c.slug}` || c.nearby ? "fill-ink" : "fill-muted"}`}
            >
              {shown}
            </text>
            <path
              d={`M${c.station.x} 20 V540`}
              className={`fill-none opacity-0 group-focus-visible:opacity-60 ${c.nearby ? "stroke-ink" : "stroke-accent"}`}
              strokeWidth={2}
              strokeDasharray="4 6"
            />
          </g>
        );
      })}

      <g
        key={`train-${replay}`}
        transform={`translate(${layout.train.x} ${layout.train.y - 42})`}
        className={replay ? "animate-[map-train_1.7s_ease-out_both]" : ""}
        aria-label="You are here"
        role="img"
      >
        <circle cx={0} cy={42} r={14} className="origin-center fill-none stroke-accent [transform-box:fill-box] motion-safe:animate-[map-pulse_2s_ease-out_infinite]" strokeWidth={2} />
        <rect x={-30} y={-13} width={60} height={24} rx={12} className="fill-accent" />
        <path
          d="M-19 -5 h8 a2 2 0 0 1 2 2 v7 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 v-7 a2 2 0 0 1 2 -2 z M-19 0 h12"
          className="fill-none stroke-on-accent"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x={7} y={3} textAnchor="middle" className="fill-on-accent text-[13px] font-semibold">
          YOU
        </text>
        <rect x={-1} y={11} width={2} height={20} className="fill-accent" />
      </g>
    </svg>
  );
}

function StationMark({ s, selected, ...props }: { s: Station; selected: boolean } & React.SVGProps<SVGGElement>) {
  const pit = s.kind !== "end" ? s : null;
  const n = pit ? pitstopLabel(pit) : null;
  const cap = s.id === "practice" || s.id === "match";
  const name = short(s.name);
  const textClass = `font-sans text-[18px] font-[550] ${s.state === "future" ? "fill-muted" : "fill-ink"}`;
  const nClass = "fill-muted font-mono text-[12.5px] tracking-[0.05em]";
  return (
    <g
      className="group cursor-pointer outline-none"
      pointerEvents="bounding-box"
      aria-label={stationLabel(n, name, s.name, s.state === "now")}
      {...props}
    >
      {cap ? (
        <>
          <rect
            x={s.x - 30}
            y={s.y - 20}
            width={60}
            height={40}
            rx={20}
            className={`fill-none stroke-accent opacity-0 transition-opacity group-focus-visible:opacity-100 ${selected ? "opacity-100" : ""}`}
            strokeWidth={2}
          />
          <rect x={s.x - 22} y={s.y - 12} width={44} height={24} rx={12} className={dotClass(s.state)} strokeWidth={s.state === "now" ? 4.5 : 3.5} />
        </>
      ) : (
        <>
          <circle
            cx={s.x}
            cy={s.y}
            r={19}
            className={`fill-none stroke-accent opacity-0 transition-opacity group-focus-visible:opacity-100 ${selected ? "opacity-100" : ""}`}
            strokeWidth={2}
          />
          <circle cx={s.x} cy={s.y} r={22} className="fill-transparent" />
          <circle cx={s.x} cy={s.y} r={10} className={`${dotClass(s.state)} transition-[r] group-hover:[r:12px]`} strokeWidth={s.state === "now" ? 4.5 : 3.5} />
        </>
      )}
      {s.above ? (
        <>
          {n && (
            <text x={s.x} y={s.y - 48} textAnchor="middle" className={nClass}>
              {/* The trailing space isn't drawn; it keeps the number and the name apart for screen readers. */}
              {`${n} `}
            </text>
          )}
          <text x={s.x} y={s.y - (cap ? 26 : 28)} textAnchor="middle" className={textClass}>
            {name}
          </text>
        </>
      ) : (
        <>
          {n && (
            <text x={s.x} y={s.y + 36} textAnchor="middle" className={nClass}>
              {/* The trailing space isn't drawn; it keeps the number and the name apart for screen readers. */}
              {`${n} `}
            </text>
          )}
          <text x={s.x} y={s.y + (n ? 56 : 40)} textAnchor="middle" className={textClass}>
            {name}
          </text>
        </>
      )}
    </g>
  );
}

/**
 * The station's accessible name starts with exactly the text it shows (WCAG 2.5.3, label in name), so a voice user can
 * say what they see; the full skill name, "done" and "you are here" follow it.
 */
export function stationLabel(n: string | null, shown: string, full: string, now: boolean): string {
  const parts = [n ? `${n} ${shown}` : shown];
  if (full !== shown) parts.push(full);
  if (n?.includes("✓")) parts.push("done");
  if (now) parts.push("you are here");
  return parts.join(", ");
}

const dotClass = (state: Station["state"]) =>
  state === "done" ? "fill-accent stroke-accent" : state === "now" ? "fill-surface stroke-accent" : "fill-surface stroke-ink";

function LockedMap() {
  return (
    <div className="relative min-h-[360px]">
      <svg viewBox="0 0 1400 560" aria-hidden="true" className="block h-auto w-full min-w-[780px]">
        <g className="stroke-line opacity-50">
          {Array.from({ length: 16 }, (_, i) => 40 + i * 80).map((x) => (
            <line key={x} x1={x} y1={20} x2={x} y2={540} strokeWidth={1} />
          ))}
        </g>
        <path d="M935 20 V540" className="fill-none stroke-muted opacity-[0.22]" strokeWidth={7} strokeLinecap="round" />
        <path d="M1010 20 V310 L1240 540" className="fill-none stroke-muted opacity-[0.22]" strokeWidth={7} strokeLinecap="round" />
      </svg>
      <div className="absolute left-1/2 top-1/2 flex w-[min(420px,88%)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-[20px] border border-line bg-surface p-5 text-center">
        <MapIcon size={30} className="text-accent" {...ICON} />
        <b className="font-display text-[1.3rem] font-semibold tracking-[-0.02em]">Your map draws itself from your resume</b>
        <span className="max-w-[40ch] text-[0.88rem] text-muted">Until then, the lines of other roles are here to explore.</span>
        <Link href="/today" className="mt-1 inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-[0.84rem] font-medium text-on-accent hover:opacity-90">
          Add resume
        </Link>
      </div>
    </div>
  );
}

/* ---------- side panel ---------- */

/** The prove pitstop's "Add a certificate": a button that opens the form in the panel. */
function AddCertificate({ goal, onSave }: { goal: MapLine["goals"][number]; onSave?: (input: CertificateInput) => Promise<CertificateResult> }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // Opening moves focus to the first field (the form does it once it has loaded); Cancel brings it back to the button.
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={preloadCertificateForm}
        onFocus={preloadCertificateForm}
        className="min-h-11 self-start rounded-full border border-line bg-surface px-3.5 py-1.5 text-[0.84rem] font-semibold"
      >
        {goal.renew ? "Renew certificate" : "Add a certificate"}
      </button>
      {open && (
        <Suspense fallback={null}>
          <LazyCertificateForm
            focusFirst
            goalId={goal.goalId ?? ""}
            goalName={goal.name}
            certificates={goal.certificates}
            renew={goal.renew}
            onSave={goal.goalId ? onSave : undefined}
            onCancel={() => {
              setOpen(false);
              opener.current?.focus();
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function Sheet({
  id,
  layout,
  line,
  onAddCertificate,
}: {
  id: string | null;
  layout: Layout;
  line: MapLine;
  onAddCertificate?: (input: CertificateInput) => Promise<CertificateResult>;
}) {
  const station = layout.stations.find((s) => s.id === id);
  const crossing = layout.crossings.find((c) => `x-${c.slug}` === id);
  const links = line.resumeId
    ? {
        resume: `/resume/${line.resumeId}`,
        gaps: `/resume/${line.resumeId}/gaps/${line.role.slug}`,
        path: `/resume/${line.resumeId}/path/${line.role.slug}`,
      }
    : null;

  const near = crossing ? line.nearby?.lines.find((n) => n.slug === crossing.slug) : undefined;
  if (crossing && crossing.nearby && near) {
    return (
      <Panel kicker="Nearby line · interchange" title={`${crossing.title} line`}>
        <p>
          {sharesSentence(near)} It crosses your line at Pitstop {crossing.station.n} ({crossing.station.name}), a goal both roles ask for.
        </p>
        <Label>Shared</Label>
        <p>{near.sharedSkills.length ? near.sharedSkills.map((s) => (s.byProof ? `${s.name} (proved)` : s.name)).join(", ") : "None yet"}</p>
        {near.onResume.length > 0 && (
          <>
            <Label>On your resume, not yet shown in work</Label>
            <p>{near.onResume.join(", ")}</p>
          </>
        )}
        <p>{toAddText(near)}</p>
        <p>Looking only: an interchange is not a pitstop. Your goals, your gaps and your train stay as they are.</p>
        <Cta href={`/roles/${near.slug}`} ghost>
          See the role
        </Cta>
        {line.resumeId && (
          <Cta href={`/resume/${line.resumeId}/role`} ghost>
            Change your target role
          </Cta>
        )}
      </Panel>
    );
  }
  if (crossing) {
    return (
      <Panel kicker="Other line" title={`${crossing.title} line`}>
        <p>
          It crosses yours at {crossing.station.name} (Pitstop {crossing.station.n}). Shared pitstops are where people swap notes.
        </p>
        <Soon>See people on it</Soon>
      </Panel>
    );
  }
  if (!station) return <p className="text-[0.88rem] text-muted">Tap any pitstop to see what it is for.</p>;

  if (station.id === "resume") {
    return (
      <Panel kicker="Done" title="Resume">
        <p>{plural(line.skillsFound, "skill")} found that this role asks for.</p>
        {links && <Cta href={links.resume}>See your resume</Cta>}
      </Panel>
    );
  }
  if (station.id === "gaps") {
    const goals = line.goals.slice(0, 4);
    return (
      <Panel kicker="Done" title="Gaps">
        <p>
          {plural(line.goals.length, "skill")} to work on for {line.role.title}. Each gap quotes the line from your resume it is based on.
        </p>
        {goals.length > 0 && (
          <List
            items={goals.map((g) => ({
              Icon: g.status === "missing" ? TriangleAlert : CircleHelp,
              title: g.name,
              detail: g.status,
            }))}
          />
        )}
        {links && <Cta href={links.gaps}>See all gaps</Cta>}
      </Panel>
    );
  }
  if (station.id === "practice") {
    return (
      <Panel kicker={station.state === "now" ? "You are here" : "Opens after your goals"} title="Practice">
        <p>Interview questions on your goals, with feedback in words and a stronger sample. No scores, and practice never fills a goal or moves your train.</p>
        <Cta href="/practice">Practise questions</Cta>
      </Panel>
    );
  }
  if (station.id === "match") {
    return (
      <Panel kicker="Destination" title={`Match: ${line.role.title}`}>
        <p>
          Your next role, not your last. Roles and job posts are matched against your updated profile. Once you get there, pick a new destination and a new
          line starts from here.
        </p>
        <Cta href="/match">See matching roles</Cta>
        <Cta href="/departures" ghost>
          See departures
        </Cta>
      </Panel>
    );
  }

  const pit = station as Pitstop;
  const goal = pit.goal;
  const goalWord = `${goal.name} goal`;
  const kicker = goal.skipped
    ? `Skipped · ${goalWord}`
    : pit.state === "now"
      ? `You are here · ${goalWord}`
      : pit.state === "done" ? (pit.kind === "prove" ? "Goal met" : `Done · ${goalWord}`) : `Ahead · ${goalWord}`;
  const resources: Item[] = goal.resources.map((r) => ({ Icon: r.detail.includes("video") ? Play : BookOpen, title: r.title, detail: r.detail }));

  if (pit.kind === "learn") {
    const items: Item[] = [...resources, ...(goal.practice ? [{ Icon: Pencil, title: goal.practice, detail: `practice for Pitstop ${pit.n + 1}` }] : [])];
    return (
      <Panel kicker={kicker} title={`Pitstop ${pit.n}: learn ${goal.name}`}>
        <p>
          Free courses plus daily tasks. This pitstop gets you ready. It does not fill the gap; Pitstop {pit.n + 1} does.
        </p>
        {items.length > 0 ? (
          <>
            <Label>Get ready: courses, videos and practice</Label>
            <List items={items} />
          </>
        ) : (
          <p>Open your path to pick the free courses for this goal.</p>
        )}
        {pit.state === "now" ? <Cta href="/today">Go to today&apos;s ride</Cta> : links && <Cta href={links.path} ghost>Open your path</Cta>}
        <NotForMe goal={goal} demo={!line.resumeId} />
      </Panel>
    );
  }

  const fresh = goal.status === "missing";
  return (
    <Panel kicker={kicker} title={`Pitstop ${pit.n}: prove ${goal.name}`}>
      <p>
        {goal.renew
          ? `Your ${goal.name} certificate has expired. Add the renewed one to fill the gap again.`
          : fresh
            ? `The pitstop that fills the ${goal.name} gap. Pick any one way to prove it.`
            : `${goal.name} is already on your resume, so the app suggests only a prove pitstop. Pick any one way to prove it.`}
      </p>
      <Label>Ways to prove it</Label>
      <List
        items={[
          { Icon: CircleHelp, title: `${goal.name} skill check`, detail: "on camera · soon" },
          {
            Icon: Award,
            title: "A certification the role accepts",
            detail: goal.certificates.length ? `${goal.certificates.length} on our list · add it below` : "none on our list for this skill yet",
          },
          { Icon: BriefcaseBusiness, title: `${goal.name} work you did`, detail: "a manager or colleague confirms · soon" },
        ]}
      />
      {!goal.proved && goal.notConfirmed && <NotConfirmedNote />}
      {!goal.proved && goal.certificates.length > 0 && <AddCertificate goal={goal} onSave={line.resumeId ? onAddCertificate : undefined} />}
      {!fresh && resources.length > 0 && (
        <>
          <Label>Brush up if you need to</Label>
          <List items={resources} />
        </>
      )}
      <NotForMe goal={goal} demo={!line.resumeId} />
    </Panel>
  );
}

const CHOICE_STATUS = { missing: "Missing", weak: "Weak evidence", outdated: "Outdated" } as const;

/**
 * "Your choice": goals the person added, off the main line (handoff section 7 draws them as spurs labelled YOUR
 * CHOICE). They never carry the train or count toward Match. Each shows how to learn and prove it, and can be removed.
 */
function ChoiceGoals({
  goals,
  pathHref,
  onAddCertificate,
}: {
  goals: MapLine["goals"];
  pathHref: string | null;
  onAddCertificate?: (input: CertificateInput) => Promise<CertificateResult>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const moveFocus = useRef(false);
  // A removed goal leaves the list once the page refreshes; focus moves to the list's heading, never to the page.
  useEffect(() => {
    if (refreshing || !moveFocus.current) return;
    heading.current?.focus();
    moveFocus.current = false;
  }, [refreshing]);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 ref={heading} id={headingId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
          Your choice
        </h3>
        <p className="text-[0.86rem] text-muted">
          Goals you added, off your line. Each has a learn and a prove pitstop of its own; none moves your train or changes your match.
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {goals.map((g) => (
          <li key={g.skillId} className="flex flex-col gap-2 rounded-[14px] border border-line p-3 text-[0.86rem]">
            <div className="flex flex-wrap items-center gap-2">
              <b className="font-semibold">{g.name}</b>
              <ChoiceTag company={g.choice?.company ?? null} />
              <span className="ml-auto font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">
                {g.proved ? "Met" : g.renew ? "Renew" : CHOICE_STATUS[g.status]}
              </span>
            </div>
            {!g.proved && (
              <p className="text-muted">
                Learn: {g.learnDone ? "done" : g.resources[0]?.title ?? (g.practice ? g.practice : pathHref ? "pick free courses on your path, or study it on your own" : "study it on your own")}
                . Prove: a skill check, a certificate or work you did.
              </p>
            )}
            {!g.proved && g.notConfirmed && <NotConfirmedNote />}
            <div className="flex flex-wrap items-start justify-between gap-2">
              {!g.proved && g.certificates.length > 0 ? <AddCertificate goal={g} onSave={g.goalId ? onAddCertificate : undefined} /> : <span />}
              <RemoveGoal
                goalId={g.goalId ?? "example"}
                name={g.name}
                demo={!g.goalId}
                onRemoved={() => {
                  moveFocus.current = true;
                  setNote(`${g.name} removed from your goals.`);
                  startRefresh(() => router.refresh());
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
    </section>
  );
}

/**
 * Nearby lines under the map, in words: the text alternative to the interchange stations, and the way to reach each
 * by keyboard. A line that shares no goal with the person's line has no interchange and says so.
 */
function NearbyOnMap({ nearby, layout, onShow }: { nearby: NonNullable<MapLine["nearby"]>; layout: Layout; onShow: (slug: string) => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">
          Nearby lines
        </h3>
        <p className="text-[0.86rem] text-muted">Roles that share at least half their key skills with you. Where one crosses your line is an interchange; it never moves your train.</p>
      </div>
      {nearby.lines.length ? (
        <ul className="flex flex-col gap-2.5">
          {nearby.lines.map((n) => {
            const at = layout.crossings.find((c) => c.slug === n.slug && c.nearby);
            return (
              <li key={n.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-line px-3 py-2 text-[0.86rem]">
                <span className="min-w-0 flex-1 basis-[220px]">
                  <b className="font-semibold">{n.title}</b>
                  <span className="block text-muted">
                    Shares {n.shared} of its {n.total} key skills ·{" "}
                    {at ? `interchange at Pitstop ${at.station.n}, ${at.station.name}` : "no interchange on your line"}
                  </span>
                </span>
                {at && (
                  <button type="button" onClick={() => onShow(n.slug)} className={`${ghost} min-h-11`}>
                    Show on map
                    <span className="sr-only">: {n.title} line</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[0.86rem] text-muted">{emptySentence(nearby.closest)}</p>
      )}
    </section>
  );
}
