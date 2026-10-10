"use client";

import { BadgeCheck, CalendarClock, Route } from "lucide-react";
import { LIFE_HEIGHT, LIFE_WIDTH, ROW_NAME, ROW_Y, X0, type LifeLayout, type LifeStation } from "@/lib/map/life-layout";
import { LIFE_ROWS, type LifeLine } from "@/lib/schemas";
import { Key, Label, List, Panel, Soon } from "./map-parts";

/** The Life line SVG (handoff section 7): five rows by year, big moments only. */
export function LifeSvg({
  layout,
  selected,
  onSelect,
}: {
  layout: LifeLayout;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const filled = new Set(layout.stations.map((s) => (s.kind === "group" ? s.row : s.moment.row)));
  return (
    <svg
      viewBox={`0 0 ${LIFE_WIDTH} ${LIFE_HEIGHT}`}
      role="group"
      aria-label="Life line: work, education, certificates and interests by year"
      className="block h-auto w-full min-w-[860px]"
    >
      {LIFE_ROWS.filter((row) => !filled.has(row)).length > 0 && (
        <desc>{LIFE_ROWS.filter((row) => !filled.has(row)).map((row) => `${ROW_NAME[row]}: ${emptyText(row, layout)}`).join(". ")}</desc>
      )}
      <g aria-hidden="true">
        {layout.splitX !== null && (
          <>
            <rect x={X0} y={36} width={layout.splitX - X0} height={454} className="fill-surface-2 opacity-60" />
            <text x={X0 + 8} y={484} className="fill-muted font-mono text-[12px] tracking-[0.08em]">
              EARLIER YEARS, SHOWN SMALLER
            </text>
          </>
        )}
        {layout.years.map((y) => (
          <g key={y.x}>
            <line x1={y.x} y1={36} x2={y.x} y2={490} className="stroke-line opacity-60" strokeWidth={1} />
            {y.label && (
              <text x={y.x} y={522} textAnchor="middle" className="fill-muted font-mono text-[16px] tracking-[0.05em]">
                {y.label}
              </text>
            )}
          </g>
        ))}
        <line x1={X0} y1={496} x2={layout.endX} y2={496} className="stroke-ink" strokeWidth={1.5} />
        <line x1={layout.nowX} y1={36} x2={layout.nowX} y2={496} className="stroke-ink" strokeWidth={1.5} strokeDasharray="4 5" />
        <text x={layout.nowX} y={522} textAnchor="middle" className="fill-ink font-mono text-[16px] font-medium tracking-[0.05em]">
          NOW
        </text>

        {LIFE_ROWS.map((row) => (
          <g key={row}>
            <text x={20} y={ROW_Y[row] + 5} className="fill-muted font-mono text-[14px] tracking-[0.08em]">
              {ROW_NAME[row].toUpperCase()}
            </text>
            {!filled.has(row) && (
              <text x={X0 + 20} y={ROW_Y[row] + 5} className="fill-muted text-[15px]">
                {emptyText(row, layout)}
              </text>
            )}
          </g>
        ))}

        {layout.tracks.map((t) => (
          <path
            key={t.row}
            d={`M${t.from} ${ROW_Y[t.row]} H${t.to}`}
            className={`fill-none ${trackClass[t.row]}`}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={t.row === "interests" ? "14 9" : undefined}
          />
        ))}
        {layout.ahead && (
          <>
            <path d={`M${layout.ahead.from} ${ROW_Y.journey} H${layout.ahead.to}`} className="fill-none stroke-accent opacity-60" strokeWidth={6} strokeLinecap="round" strokeDasharray="2 12" />
            <text x={layout.ahead.to + 8} y={ROW_Y.journey + 5} className="fill-accent font-display text-[19px] font-semibold">
              Destination
            </text>
          </>
        )}
      </g>

      {layout.stations.map((s) => (
        <LifeMark key={s.id} s={s} selected={selected === s.id} onSelect={onSelect} />
      ))}
    </svg>
  );
}

const emptyText = (row: (typeof LIFE_ROWS)[number], layout: LifeLayout) =>
  layout.earlierRows.includes(row)
    ? "Earlier years only · show the whole career"
    : row === "interests"
      ? "Your interests show here · soon"
      : row === "certificates"
        ? "Certificates with a date show here · soon"
        : "Nothing dated yet";

const trackClass: Record<(typeof LIFE_ROWS)[number], string> = {
  journey: "stroke-accent",
  education: "stroke-muted opacity-55",
  work: "stroke-ink",
  certificates: "stroke-muted opacity-55",
  interests: "stroke-muted opacity-55",
};

function LifeMark({ s, selected, onSelect }: { s: LifeStation; selected: boolean; onSelect: (id: string) => void }) {
  const group = s.kind === "group";
  const row = group ? s.row : s.moment.row;
  const name = group ? s.label : s.moment.name;
  const date = group ? s.years : s.moment.date;
  const dx = s.anchor === "start" ? -8 : s.anchor === "end" ? 8 : 0;
  const text = "[paint-order:stroke] stroke-surface [stroke-width:4px] [stroke-linejoin:round]";
  return (
    <g
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${name}, ${date}`}
      className="group cursor-pointer outline-none"
      onClick={() => onSelect(s.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(s.id);
        }
      }}
    >
      <circle cx={s.x} cy={s.y} r={22} className="fill-transparent" />
      <circle
        cx={s.x}
        cy={s.y}
        r={group ? 21 : 17}
        className={`fill-none stroke-accent opacity-0 transition-opacity group-focus-visible:opacity-100 ${selected ? "opacity-100" : ""}`}
        strokeWidth={2}
      />
      <circle
        cx={s.x}
        cy={s.y}
        r={group ? 13 : 9}
        className={`fill-surface ${row === "journey" ? "stroke-accent" : "stroke-ink"}`}
        strokeWidth={row === "journey" ? 4.5 : 3.5}
      />
      {group && (
        <text x={s.x} y={s.y + 5} textAnchor="middle" className="fill-ink font-mono text-[13px] font-medium">
          {s.items.length}
        </text>
      )}
      {s.above ? (
        <>
          <text x={s.x + dx} y={s.y - 40} textAnchor={s.anchor} className={`fill-muted font-mono text-[13.5px] tracking-[0.05em] ${text}`}>
            {date}
          </text>
          <text x={s.x + dx} y={s.y - 19} textAnchor={s.anchor} className={`fill-ink text-[18px] font-[550] ${text}`}>
            {name}
          </text>
        </>
      ) : (
        <>
          <text x={s.x + dx} y={s.y + 36} textAnchor={s.anchor} className={`fill-ink text-[18px] font-[550] ${text}`}>
            {name}
          </text>
          <text x={s.x + dx} y={s.y + 55} textAnchor={s.anchor} className={`fill-muted font-mono text-[13.5px] tracking-[0.05em] ${text}`}>
            {date}
          </text>
        </>
      )}
    </g>
  );
}

export function LifeLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-[0.78rem] text-muted" aria-label="Key">
      <Key swatch="bg-accent">Your journey</Key>
      <Key swatch="bg-ink">Work</Key>
      <Key swatch="bg-muted">Education and certificates</Key>
      <Key swatch="bg-[repeating-linear-gradient(90deg,var(--muted)_0_7px,transparent_7px_11px)] opacity-70">Interests</Key>
    </ul>
  );
}

/** The side panel for a moment, or for a group of older moments. */
export function LifeSheet({
  id,
  line,
  layout,
  onSelect,
  onZoom,
}: {
  id: string | null;
  line: LifeLine;
  layout: LifeLayout;
  onSelect: (id: string) => void;
  onZoom: () => void;
}) {
  const station = layout.stations.find((s) => s.id === id);
  const moment = station?.kind === "moment" ? station.moment : line.moments.find((m) => m.id === id);
  if (station?.kind === "group") {
    return (
      <Panel kicker={`${ROW_NAME[station.row]} · ${station.years}`} title={station.label}>
        <p>Grouped so the earlier years stay readable. Tap one to open it.</p>
        <ul className="flex flex-col gap-1.5">
          {station.items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className="flex w-full items-center gap-2.5 rounded-md bg-surface-2 px-[11px] py-[9px] text-left text-[0.84rem] hover:underline"
              >
                {m.verified ? <BadgeCheck size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" /> : <Route size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">{m.name}</span>
                <small className="font-mono text-[0.7rem] text-muted">{m.date}</small>
              </button>
            </li>
          ))}
        </ul>
        {layout.zoom === "all" && (
          <div className="flex">
            <button type="button" onClick={onZoom} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[0.84rem] font-medium hover:bg-surface-2">
              Last 5 years
            </button>
          </div>
        )}
      </Panel>
    );
  }
  if (moment) {
    return (
      <Panel kicker={`${ROW_NAME[moment.row]} · ${moment.date}`} title={moment.heading}>
        {moment.detail && <p>{moment.detail}</p>}
        {moment.verified && (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-2 px-2.5 py-1 text-[0.78rem] font-medium text-ink">
            <BadgeCheck size={14} strokeWidth={1.75} aria-hidden className="text-muted" />
            Verified
          </span>
        )}
        <Soon>Add a moment</Soon>
      </Panel>
    );
  }
  return (
    <Panel kicker="Life line" title="Your big moments">
      <p>Work, education, certificates and interests by year. Pitstops and prep stay on the Role line. Tap any moment to open it.</p>
      {line.undated.length > 0 && (
        <>
          <Label>Not on the map yet: no date on your resume</Label>
          <List items={line.undated.slice(0, 6).map((u) => ({ Icon: CalendarClock, title: u.name, detail: ROW_NAME[u.row].toLowerCase() }))} />
        </>
      )}
      <Soon>Add a moment</Soon>
    </Panel>
  );
}
