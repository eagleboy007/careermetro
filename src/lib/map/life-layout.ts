import { LIFE_ROWS, type LifeLine, type LifeMoment, type LifeRow } from "@/lib/schemas";

/*
 * Lays out the Life line (handoff section 7) in plain code, in the SVG's own units. Years run left to right with Now
 * near the right edge. "Last 5 years" is the default for careers over 7 years; older moments then sit behind an
 * "N earlier moments" button. "Whole career" gives the last 5 years 64% of the width and, in a row with 3 or more older
 * moments, groups them into one numbered dot.
 */

export type LifeZoom = "recent" | "all";

export const LIFE_WIDTH = 1440;
export const LIFE_HEIGHT = 540;
const X0 = 170;
const X1 = 1300;
const AHEAD = 0.35;
const RECENT_YEARS = 5;
const LONG_CAREER = 7.2;
const OLD_SHARE = 0.36;
const GROUP_AT = 3;
/** Two labels on one side of a row need about this much room. */
const LABEL_ROOM = 170;

export const ROW_Y: Record<LifeRow, number> = { journey: 70, education: 160, work: 250, certificates: 340, interests: 430 };
export const ROW_NAME: Record<LifeRow, string> = {
  journey: "Journey",
  education: "Education",
  work: "Work",
  certificates: "Certificates",
  interests: "Interests",
};

export type LifeStation =
  | { kind: "moment"; id: string; moment: LifeMoment; x: number; y: number; above: boolean; anchor: "start" | "middle" | "end" }
  | { kind: "group"; id: string; row: LifeRow; items: LifeMoment[]; label: string; years: string; x: number; y: number; above: boolean; anchor: "start" | "middle" | "end" };

export type LifeLayout = {
  zoom: LifeZoom;
  years: { x: number; label: string | null }[];
  nowX: number;
  endX: number;
  /** Where "earlier years, shown smaller" ends, when the scale is split. */
  splitX: number | null;
  tracks: { row: LifeRow; from: number; to: number }[];
  /** The journey runs on, dotted, to the destination. */
  ahead: { from: number; to: number } | null;
  stations: LifeStation[];
  hidden: { count: number; fromYear: number; toYear: number } | null;
};

/** "Last 5 years" for careers over 7 years, else the whole career. */
export function defaultZoom(line: LifeLine): LifeZoom {
  return line.now + AHEAD - Math.floor(start(line)) > LONG_CAREER ? "recent" : "all";
}

const start = (line: LifeLine) => Math.min(line.now - 1, ...line.moments.map((m) => m.t));

export function layoutLife(line: LifeLine, zoom: LifeZoom = defaultZoom(line)): LifeLayout {
  const end = line.now + AHEAD;
  const width = X1 - X0;
  const first = start(line);
  const recentFrom = line.now - RECENT_YEARS;

  let from = Math.floor(first);
  let split: number | null = null;
  let x: (t: number) => number;
  if (zoom === "recent" && first < recentFrom - 0.3) {
    from = recentFrom;
    x = (t) => X0 + ((t - from) / (end - from)) * width;
  } else if (end - from <= LONG_CAREER) {
    x = (t) => X0 + ((t - from) / (end - from)) * width;
  } else {
    split = recentFrom;
    const s = split;
    x = (t) => (t >= s ? X0 + OLD_SHARE * width + ((t - s) / (end - s)) * (1 - OLD_SHARE) * width : X0 + ((t - from) / (s - from)) * OLD_SHARE * width);
  }
  const at = (t: number) => Math.round(x(Math.max(t, from)) * 10) / 10;

  const nowX = at(line.now);
  const years: LifeLayout["years"] = [];
  let lastLabel = -Infinity;
  for (let year = Math.ceil(from); year <= Math.floor(line.now); year++) {
    const yx = at(year);
    const label = yx - lastLabel >= 56 && nowX - yx >= 50 ? String(year) : null;
    if (label) lastLabel = yx;
    years.push({ x: yx, label });
  }

  const visible = line.moments.filter((m) => m.t >= from - 0.01);
  const hiddenMoments = line.moments.filter((m) => m.t < from - 0.01);

  const stations: LifeStation[] = [];
  const tracks: LifeLayout["tracks"] = [];
  for (const row of LIFE_ROWS) {
    const inRow = visible.filter((m) => m.row === row).sort((a, b) => a.t - b.t);
    const all = line.moments.filter((m) => m.row === row);
    if (all.length) {
      const lastT = Math.max(...all.map((m) => m.t));
      // Education stops at its last moment; work, certificates, interests and the journey run on to now.
      const to = row === "education" ? lastT : line.now;
      const fromT = Math.max(Math.min(...all.map((m) => m.t)), from);
      if (to >= from) tracks.push({ row, from: at(fromT), to: at(to) });
    }

    let items: (LifeMoment | { group: LifeMoment[] })[] = inRow;
    if (split !== null) {
      const old = inRow.filter((m) => m.t < split!);
      if (old.length >= GROUP_AT) items = [{ group: old }, ...inRow.filter((m) => m.t >= split!)];
    }
    let previous: { x: number; above: boolean } | null = null;
    items.forEach((item, i) => {
      const y = ROW_Y[row];
      const ix = at("group" in item ? (item.group[0].t + item.group[item.group.length - 1].t) / 2 : item.t);
      // Labels sit above the row, and drop below only when the previous label is close enough to collide.
      const above = !(previous && previous.above && ix - previous.x < LABEL_ROOM);
      previous = { x: ix, above };
      // The journey's first label starts at its dot, and a label near Now ends at its dot, so neither runs off the map.
      const anchor = (sx: number): LifeStation["anchor"] =>
        row === "journey" && i === 0 ? "start" : sx > nowX - 120 ? "end" : anchorAt(sx);
      if ("group" in item) {
        const g = item.group;
        const t = (g[0].t + g[g.length - 1].t) / 2;
        const sx = at(t);
        stations.push({
          kind: "group",
          id: `group-${row}`,
          row,
          items: g,
          label: `${g.length} ${row === "work" ? "roles" : row === "certificates" ? "certificates" : row === "interests" ? "interests" : "moments"}`,
          years: `${Math.floor(g[0].t)} to ${Math.floor(g[g.length - 1].t)}`,
          x: sx,
          y,
          above,
          anchor: anchor(sx),
        });
      } else {
        const sx = at(item.t);
        stations.push({ kind: "moment", id: item.id, moment: item, x: sx, y, above, anchor: anchor(sx) });
      }
    });
  }

  const journey = tracks.find((t) => t.row === "journey");
  return {
    zoom,
    years,
    nowX,
    endX: at(end),
    splitX: split === null ? null : at(split),
    tracks,
    ahead: journey ? { from: journey.to, to: at(end) } : null,
    stations,
    hidden: hiddenMoments.length
      ? { count: hiddenMoments.length, fromYear: Math.floor(Math.min(...hiddenMoments.map((m) => m.t))), toYear: Math.floor(from) }
      : null,
  };
}

const anchorAt = (x: number): "start" | "middle" | "end" => (x < X0 + 60 ? "start" : x > X1 - 40 ? "end" : "middle");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-06" → 2024.42 and "Jun 2024"; "2024" → 2024 and "2024". Null when it isn't a date. */
export function readYearMonth(value: string | null | undefined): { t: number; label: string } | null {
  const m = value?.trim().match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  return month === null ? { t: year, label: String(year) } : { t: year + (month - 1) / 12, label: `${MONTHS[month - 1]} ${year}` };
}

/** A decimal year for a date. */
export function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  return y + (date.getTime() - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
}

export function monthLabel(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
