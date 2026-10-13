import Link from "next/link";
import { label } from "./market-parts";
import type { MarketMetric, MarketState } from "@/lib/schemas";

/*
 * The tile map (handoff C6): one square per state or union territory, placed roughly where it is, coloured in five
 * plum steps. Never colour alone: each tile carries its code and figure, the legend gives each step's range, and the
 * list under it says the same in words with a full-size link per state.
 */

/** `figure` is the formatted value ("1,240" or "₹8.2 L"), null when there is not enough data; `short` fits the tile. */
export type Tile = { state: MarketState; value: number | null; step: 1 | 2 | 3 | 4 | 5 | null; figure: string | null; short: string; href: string };

const STEP = {
  1: "bg-heat-1 text-heat-ink",
  2: "bg-heat-2 text-heat-ink",
  3: "bg-heat-3 text-heat-ink",
  4: "bg-heat-4 text-heat-ink-strong",
  5: "bg-heat-5 text-heat-ink-strong",
} as const;
const SWATCH = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

export function TileMap({
  tiles,
  selected,
  metric,
  metricHrefs,
  ranges,
  rangeText,
  valueName,
  unit,
  skipTo,
}: {
  tiles: Tile[];
  selected: string | null;
  metric: MarketMetric;
  metricHrefs: Record<MarketMetric, string>;
  ranges: ({ lo: number; hi: number } | null)[];
  rangeText: (r: { lo: number; hi: number }) => string;
  /** What the figure is, for the list's column: "Openings a month" or "Median pay, 3–5 yrs". */
  valueName: string;
  /** Said after the figure: "openings a month" or "median pay at 3–5 years". */
  unit: string;
  /** The id "Skip the map" moves to: the place panel's heading. */
  skipTo: string;
}) {
  const said = (t: Tile) => (t.figure === null ? "Not enough data" : `${t.figure} ${unit}`);
  const at = new Map(tiles.map((t) => [`${t.state.col},${t.state.row}`, t]));
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Colour the map by" className="inline-flex self-start rounded-full bg-surface-2 p-1">
        {(["openings", "pay"] as const).map((m) => (
          <Link
            key={m}
            href={metricHrefs[m]}
            scroll={false}
            aria-current={metric === m ? "true" : undefined}
            className="inline-flex min-h-9 items-center rounded-full px-3.5 text-[0.82rem] font-[550] text-muted aria-[current=true]:bg-surface aria-[current=true]:text-ink aria-[current=true]:shadow-[0_1px_2px_var(--shadow)]"
          >
            {m === "openings" ? "Openings" : "Median pay"}
          </Link>
        ))}
      </div>

      <a
        href={`#${skipTo}`}
        className="sr-only self-start rounded-full bg-surface-2 px-3.5 text-[0.82rem] font-[550] focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Skip the map
      </a>
      <div role="group" aria-label="States of India, one square each. Pick a state." className="mx-auto grid w-full max-w-[460px] grid-cols-9 gap-1 min-[480px]:gap-[5px]">
        {Array.from({ length: 7 * 9 }, (_, i) => {
          const t = at.get(`${i % 9},${Math.floor(i / 9)}`);
          if (!t) return <span key={i} aria-hidden="true" />;
          const on = selected === t.state.code;
          return (
            <Link
              key={t.state.code}
              href={t.href}
              scroll={false}
              aria-current={on ? "true" : undefined}
              title={`${t.state.name} · ${said(t)}`}
              data-state={t.state.code}
              className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-[7px] font-mono text-[0.62rem] font-medium leading-[1.1] tracking-[0.02em] transition-transform hover:-translate-y-px min-[480px]:rounded-[9px] min-[480px]:text-[0.7rem] ${
                t.step ? STEP[t.step] : "border-[1.5px] border-dashed border-muted text-muted"
              } ${on ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
            >
              {/* The name starts with the code it shows (WCAG 2.5.3), then says the state and its figure in words. */}
              {t.state.code}
              <small aria-hidden="true" className="hidden text-[0.56rem] font-normal opacity-90 min-[480px]:block">
                {t.short}
              </small>
              <span className="sr-only">
                {" "}
                {t.short} · {t.state.name}: {said(t)}
              </span>
            </Link>
          );
        })}
      </div>

      <ul aria-label="Key" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.74rem] text-muted">
        {ranges.map((r, i) =>
          r ? (
            <li key={i} className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className={`inline-block size-3.5 rounded-[4px] ${SWATCH[i]}`} />
              <span className="tabular-nums">{rangeText(r)}</span>
            </li>
          ) : null,
        )}
        <li className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block size-3.5 rounded-[4px] border-[1.5px] border-dashed border-muted" />
          Not enough data
        </li>
      </ul>
      <p className="text-[0.74rem] text-muted">Each state is one square, placed roughly where it is. Not drawn to scale. Darker means {metric === "openings" ? "more openings" : "higher pay"}.</p>

      <details className="group rounded-md border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-[0.86rem] font-[550]">States as a list</summary>
        <table className="w-full border-collapse text-[0.84rem]">
          <caption className="sr-only">States of India: {valueName.toLowerCase()} for this role</caption>
          <thead>
            <tr className="border-t border-line text-left">
              <th scope="col" className={`px-3.5 py-2 ${label} font-normal`}>
                State
              </th>
              <th scope="col" className={`px-3.5 py-2 text-right ${label} font-normal`}>
                {valueName}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...tiles]
              .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.state.name.localeCompare(b.state.name))
              .map((t) => (
                <tr key={t.state.code} className="border-t border-line">
                  <th scope="row" className="px-3.5 text-left font-normal">
                    <Link href={t.href} scroll={false} aria-current={selected === t.state.code ? "true" : undefined} className="flex min-h-11 items-center underline-offset-2 hover:underline aria-[current=true]:font-semibold">
                      {t.state.name}
                    </Link>
                  </th>
                  <td className="px-3.5 text-right tabular-nums text-muted">{t.figure ?? "Not enough data"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
