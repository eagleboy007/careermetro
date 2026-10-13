import { ArrowRight, FlaskConical, MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { NearbyLinesList } from "@/components/nearby/nearby-lines";
import { DEFAULT_MARKET_ROLE, marketData, marketRoles } from "@/lib/market/data";
import { compareSentence, count, heatRanges, heatSteps, lakh, monthLabel, PAY_BAND, placeName, shortMonth, type Cell, type MarketData } from "@/lib/market/query";
import { INDIA_PLACE, marketChoices, marketHref, parsePlace, placeKey, readMarketView, type MarketView as View } from "@/lib/market/view";
import { MARKET_BAND_LABELS, MARKET_BANDS, type MarketPlace, type MarketTrend, type NearbyLines, type StateCode } from "@/lib/schemas";
import { Card, ICON, label, NotEnough, SourceLine, Stat } from "./market-parts";
import { MarketSearch, MarketSelect, type PickGroup } from "./market-pickers";
import { TileMap, type Tile } from "./tile-map";

const JOB_BOARD_SHAPE = "in the shape of public company job-board counts (role × place × month)";
const PAY_SHAPE = "in the shape of advertised pay by experience band";
const TREND_ICON: Record<MarketTrend, typeof TrendingUp> = { Growing: TrendingUp, Steady: MoveRight, Shrinking: TrendingDown };

export type MarketNearby = { nearby: NearbyLines | null; changeRoleHref: string | null; example: boolean };

/**
 * Market (handoff C6, dev/market-plan.md): where the openings are, what they pay, and which way each role is moving.
 * The figures are example data until a licensed source exists, and every card says so with its month. Nearby lines
 * are real: the person's own, from the role profiles and their resume, as on Me.
 */
/** `ids` prefixes the card headings' ids, so two views on one page (the design page) never share one. */
export function MarketView({
  params,
  defaultRole = DEFAULT_MARKET_ROLE,
  nearby,
  today,
  market = marketData,
  ids = "market",
}: {
  params: Record<string, string | string[] | undefined>;
  defaultRole?: string;
  nearby: MarketNearby;
  today: Date;
  market?: MarketData;
  ids?: string;
}) {
  const view = readMarketView(params, { roles: marketRoles.map((r) => r.slug), states: market.states, defaultRole });
  const role = marketRoles.find((r) => r.slug === view.role)!;
  const here = market.cell(view.role, view.place);
  const where = placeName(view.place, market);
  const href = (patch: Partial<View>) => marketHref(view, patch);

  const choices = marketChoices(marketRoles, market.states).map((c) => ({
    ...c,
    href: href({ ...(c.patch.role ? { role: c.patch.role } : {}), ...(c.patch.place ? { place: parsePlace(c.patch.place, market.states) ?? INDIA_PLACE } : {}) }),
  }));
  const placeGroups = (patchKey: "place" | "a" | "b"): PickGroup[] => [
    { label: "India", options: [{ label: "All India", href: href({ [patchKey]: INDIA_PLACE }) }] },
    ...[...market.states]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        label: s.name,
        options: [
          { label: `${s.name} (state)`, href: href({ [patchKey]: { kind: "state", state: s.code } }) },
          ...s.cities.map((city) => ({ label: city, href: href({ [patchKey]: { kind: "city", state: s.code, city } }) })),
        ],
      })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Market</h1>
          <p className="mt-1.5 max-w-[62ch] text-[0.92rem] text-muted">Where the openings are, what they pay, and which way each role is moving. Pick a role and a place.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 font-mono text-[0.72rem] font-medium uppercase tracking-[0.06em] text-ink">
          <FlaskConical size={14} {...ICON} />
          Example data
        </span>
      </div>
      <p className="-mt-1 max-w-[70ch] text-[0.84rem] text-muted">
        <b className="font-semibold text-ink">These figures are made up to show the design.</b> Real ones come from public company job boards and government surveys once their licences are
        checked. Every card names its source and month.
      </p>

      <MarketSearch choices={choices} />
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <MarketSelect label="Role" value={href({})} options={marketRoles.map((r) => ({ label: r.title, href: href({ role: r.slug }) }))} />
        <MarketSelect label="Place" value={href({})} groups={placeGroups("place")} />
      </div>

      <div className="grid gap-4 min-[960px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] min-[960px]:items-start">
        <MapCard ids={ids} view={view} roleTitle={role.title} market={market} href={href} className="min-[960px]:row-span-2" />
        <TrendCard ids={ids} view={view} roleTitle={role.title} market={market} />
        <PayCard ids={ids} cell={here} where={where} />
        <CitiesCard ids={ids} view={view} market={market} />
        <CompareCard ids={ids} view={view} roleTitle={role.title} market={market} groups={{ a: placeGroups("a"), b: placeGroups("b") }} href={href} />
        <Card
          id={`${ids}-nearby`}
          title="Nearby lines"
          note={<span className={label}>Roles that share your skills</span>}
          className="min-[960px]:col-span-2"
          source={
            <p className="font-mono text-[0.66rem] tracking-[0.04em] text-muted">
              Source: CareerMetro role profiles{nearby.example ? " and an example resume" : " and your resume"} · {monthLabel(today.toISOString().slice(0, 7))}
            </p>
          }
        >
          {nearby.nearby ? (
            <>
              <NearbyLinesList nearby={nearby.nearby} changeRoleHref={nearby.changeRoleHref} />
              {nearby.nearby.lines.length > 0 && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.84rem]">
                  <span className="text-muted">See the market for</span>
                  {nearby.nearby.lines.map((l) => (
                    <Link key={l.slug} href={href({ role: l.slug })} scroll={false} className="inline-flex min-h-11 items-center gap-1 font-[550] underline-offset-2 hover:underline">
                      {l.title}
                      <ArrowRight size={14} {...ICON} />
                    </Link>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="text-[0.86rem] text-muted">
              Add your resume to see the roles that share your skills.{" "}
              <Link href="/start" className="inline-flex min-h-11 items-center font-[550] text-ink underline underline-offset-2">
                Add your resume
              </Link>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function MapCard({ ids, view, roleTitle, market, href, className }: { ids: string; view: View; roleTitle: string; market: MarketData; href: (p: Partial<View>) => string; className: string }) {
  const raw = market.tiles(view.role, view.metric);
  const values = raw.map((t) => t.value);
  const steps = heatSteps(values);
  const format = (v: number) => (view.metric === "openings" ? count(v) : lakh(v));
  const selected = view.place.kind === "india" ? null : view.place.state;
  const tiles: Tile[] = raw.map((t, i) => ({
    state: t.state,
    value: t.value,
    step: steps[i]!,
    figure: t.value === null ? null : format(t.value),
    short: t.value === null ? "n/a" : view.metric === "openings" ? count(t.value) : `${Math.round(t.value)}L`,
    // Picking the selected state again goes back to all of India.
    href: href({ place: selected === t.state.code && view.place.kind === "state" ? { kind: "india" } : { kind: "state", state: t.state.code } }),
  }));
  return (
    <Card
      id={`${ids}-map`}
      title={view.metric === "openings" ? "Where the openings are" : "Where it pays most"}
      className={className}
      source={<SourceLine of={market.cell(view.role, { kind: "india" })} shape={view.metric === "openings" ? JOB_BOARD_SHAPE : PAY_SHAPE} />}
    >
      <TileMap
        tiles={tiles}
        selected={selected}
        metric={view.metric}
        metricHrefs={{ openings: href({ metric: "openings" }), pay: href({ metric: "pay" }) }}
        ranges={heatRanges(values)}
        rangeText={(r) => (r.lo === r.hi ? format(r.lo) : `${format(r.lo)}–${format(r.hi)}`)}
        valueName={view.metric === "openings" ? "Openings a month" : "Median pay, 3–5 yrs"}
        unit={view.metric === "openings" ? "openings a month" : "median pay at 3–5 years"}
      />
      <PlacePanel view={view} roleTitle={roleTitle} market={market} href={href} />
    </Card>
  );
}

/** The picked place: its figures, and for a state (or a city's state) its top roles and top cities. */
function PlacePanel({ view, roleTitle, market, href }: { view: View; roleTitle: string; market: MarketData; href: (p: Partial<View>) => string }) {
  const cell = market.cell(view.role, view.place);
  const pay = cell.bands[PAY_BAND].pay;
  const state = view.place.kind === "india" ? null : market.state(view.place.state);
  return (
    <div aria-live="polite" className="flex flex-col gap-3 rounded-md bg-surface-2 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]">
          {placeName(view.place, market)} · {roleTitle}
        </h3>
        {view.place.kind !== "india" && (
          <Link href={href({ place: { kind: "india" } })} scroll={false} className="ml-auto inline-flex min-h-11 items-center text-[0.82rem] font-[550] text-muted underline-offset-2 hover:text-ink hover:underline">
            Show all of India
          </Link>
        )}
      </div>
      {cell.enough ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Stat value={count(cell.openings)}>openings a month</Stat>
          <Stat value={pay ? lakh(pay.median) : "Not enough data"}>median pay, 3–5 yrs</Stat>
        </div>
      ) : (
        <NotEnough />
      )}
      {state ? (
        <div className="grid gap-3.5 min-[480px]:grid-cols-2">
          <div className="min-w-0">
            <h4 className={label}>Top roles in {state.name}</h4>
            <TopRoles state={state.code} market={market} href={href} />
          </div>
          <div className="min-w-0">
            <h4 className={label}>Top cities for {roleTitle}</h4>
            <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-[0.86rem]">
              {market.topCities(view.role, { kind: "state", state: state.code }, { keepThin: true }).map((x) => (
                <li key={x.city} className="min-h-6">
                  {x.city} <span className="text-muted">· {x.cell.enough ? `${count(x.cell.openings)} a month` : "not enough data"}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="text-[0.8rem] text-muted">Pick a state on the map for its top roles, top cities and pay.</p>
      )}
    </div>
  );
}

const marketRoleTitle = (slug: string) => marketRoles.find((r) => r.slug === slug)?.title ?? slug;

function TopRoles({ state, market, href }: { state: StateCode; market: MarketData; href: (p: Partial<View>) => string }) {
  const top = market.topRoles(state);
  if (!top.length)
    return (
      <p className="mt-1.5">
        <NotEnough small />
      </p>
    );
  return (
    <ol className="mt-1 flex list-decimal flex-col pl-5 text-[0.86rem]">
      {top.map((x) => (
        <li key={x.role}>
          <Link href={href({ role: x.role })} scroll={false} className="inline-flex min-h-11 items-center underline-offset-2 hover:underline">
            {marketRoleTitle(x.role)}
          </Link>{" "}
          <span className="text-muted">· {count(x.cell.openings)}</span>
        </li>
      ))}
    </ol>
  );
}

function TrendCard({ ids, view, roleTitle, market }: { ids: string; view: View; roleTitle: string; market: MarketData }) {
  const t = market.trend(view.role, view.place);
  const where = placeName(t.where, market) + (view.place.kind === "city" ? " (state)" : "");
  const Icon = TREND_ICON[t.trend];
  const pct = Math.round(Math.abs(t.change) * 100);
  const moved = pct < 2 ? "flat" : `${t.change > 0 ? "up" : "down"} ${pct}%`;
  return (
    <Card
      id={`${ids}-trend`}
      title="Which way it's moving"
      note={
        t.enough && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[0.8rem] font-semibold">
            <Icon size={15} {...ICON} />
            {t.trend}
          </span>
        )
      }
      source={<SourceLine of={t} shape={JOB_BOARD_SHAPE} />}
    >
      {t.enough ? (
        <>
          <TrendChart points={t.points} months={market.months} label={`${roleTitle} openings in ${where} over the last 12 months: ${t.trend.toLowerCase()}, ${moved}.`} />
          <p className="text-[0.86rem]">
            {roleTitle} openings {moved} over 12 months <span className="text-muted">· {where} · monthly count</span>
          </p>
        </>
      ) : (
        <NotEnough>A trend needs at least 15 openings in each of the last 12 months{view.place.kind === "india" ? "" : ` in ${where}`}.</NotEnough>
      )}
    </Card>
  );
}

/** Twelve months of openings as a line, in ink. The label says the trend in words. */
function TrendChart({ points, months, label: said }: { points: number[]; months: string[]; label: string }) {
  const W = 460;
  const H = 150;
  const P = 6;
  const lo = Math.min(...points) * 0.9;
  const hi = Math.max(...points) * 1.05;
  const xy = points.map((v, i) => [P + (i * (W - 2 * P)) / 11, H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 34)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={said} className="block h-auto max-h-[190px] w-full overflow-visible">
      {[0.33, 0.66].map((f) => (
        <line key={f} x1="0" x2={W} y1={(H - 20) * f + 6} y2={(H - 20) * f + 6} className="stroke-line" strokeDasharray="3 4" />
      ))}
      <path d={`${d} L${last[0]} ${H - 20} L${xy[0]![0]} ${H - 20}Z`} className="fill-ink/[0.07]" />
      <path d={d} className="fill-none stroke-ink" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} className="fill-ink" />
      {[0, 3, 6, 9, 11].map((i) => (
        <text key={i} x={xy[i]![0]} y={H - 4} textAnchor={i === 0 ? "start" : i === 11 ? "end" : "middle"} className="fill-muted font-mono text-[13px]">
          {months[i] ? shortMonth(months[i]) : ""}
        </text>
      ))}
    </svg>
  );
}

function PayCard({ ids, cell, where }: { ids: string; cell: Cell; where: string }) {
  const max = Math.max(...MARKET_BANDS.map((b) => cell.bands[b].pay?.p75 ?? 0)) * 1.05;
  return (
    <Card id={`${ids}-pay`} title="Pay by experience" note={<span className={label}>{where}</span>} source={<SourceLine of={cell} shape={PAY_SHAPE} />}>
      {cell.enough ? (
        <>
          <ul className="flex flex-col gap-3">
            {MARKET_BANDS.map((b) => {
              const pay = cell.bands[b].pay;
              return (
                <li key={b} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1">
                  <span className={`${label} whitespace-nowrap`}>{MARKET_BAND_LABELS[b]}</span>
                  {pay ? (
                    <>
                      <div className="relative h-3 rounded-full bg-surface-2" aria-hidden="true">
                        <i className="absolute inset-y-0 rounded-full bg-ink/30" style={{ left: `${(pay.p25 / max) * 100}%`, width: `${((pay.p75 - pay.p25) / max) * 100}%` }} />
                        <i className="absolute -inset-y-1 -ml-[1.5px] w-[3px] rounded-[2px] bg-ink" style={{ left: `${(pay.median / max) * 100}%` }} />
                      </div>
                      <p className="col-start-2 text-[0.78rem] text-muted">
                        <b className="font-semibold tabular-nums text-ink">{lakh(pay.median)}</b> median · {lakh(pay.p25)} to {lakh(pay.p75)}
                      </p>
                    </>
                  ) : (
                    <NotEnough small />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[0.78rem] text-muted">Bar: middle half of offers. Tick: median. Per year, before tax.</p>
        </>
      ) : (
        <NotEnough />
      )}
    </Card>
  );
}

function CitiesCard({ ids, view, market }: { ids: string; view: View; market: MarketData }) {
  const scope: MarketPlace = view.place.kind === "india" ? view.place : { kind: "state", state: view.place.state };
  const rows = market.topCities(view.role, scope);
  const most = rows[0]?.cell.openings ?? 1;
  return (
    <Card
      id={`${ids}-cities`}
      title="Top cities"
      note={<span className={label}>{placeName(scope, market)}</span>}
      source={<SourceLine of={market.cell(view.role, scope)} shape={JOB_BOARD_SHAPE} />}
    >
      {rows.length ? (
        <ol className="flex flex-col gap-2.5">
          {rows.map((x, i) => {
            const pay = x.cell.bands[PAY_BAND].pay;
            const on = view.place.kind === "city" && view.place.city === x.city;
            return (
              <li key={x.city} aria-current={on ? "true" : undefined} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[0.88rem]">
                <span className="font-mono text-[0.72rem] text-muted">{i + 1}</span>
                <b className={on ? "font-bold" : "font-semibold"}>{x.city}</b>
                <span className="text-right text-[0.78rem] tabular-nums text-muted">
                  {count(x.cell.openings)} a month{pay ? ` · ${lakh(pay.median)}` : ""}
                </span>
                <i aria-hidden="true" className="col-span-2 col-start-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <i className="block h-full rounded-full bg-ink/55" style={{ width: `${Math.round((x.cell.openings / most) * 100)}%` }} />
                </i>
              </li>
            );
          })}
        </ol>
      ) : (
        <NotEnough>No city here has at least 15 openings a month for this role.</NotEnough>
      )}
    </Card>
  );
}

function CompareCard({
  ids,
  view,
  roleTitle,
  market,
  groups,
  href,
}: {
  ids: string;
  view: View;
  roleTitle: string;
  market: MarketData;
  groups: { a: PickGroup[]; b: PickGroup[] };
  href: (p: Partial<View>) => string;
}) {
  const sides = [view.a, view.b].map((p) => ({ place: p, name: placeName(p, market), cell: market.cell(view.role, p) }));
  const sentence = compareSentence(roleTitle, sides[0]!, sides[1]!);
  return (
    <Card id={`${ids}-compare`} title="Compare two places" note={<span className={label}>Planning a move?</span>} source={<SourceLine of={sides[0]!.cell.sources.length ? sides[0]!.cell : sides[1]!.cell} shape={JOB_BOARD_SHAPE} />}>
      <div className="grid grid-cols-2 gap-3">
        <MarketSelect label="First place" value={href({})} groups={groups.a} />
        <MarketSelect label="Second place" value={href({})} groups={groups.b} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 min-[480px]:gap-3">
        {sides.map((s, i) => {
          const mid = s.cell.bands[PAY_BAND].pay;
          const junior = s.cell.bands["0-2"].pay;
          return (
            <div key={`${i}-${placeKey(s.place)}`} className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-3 min-[480px]:p-3.5">
              <h3 className="text-[1.02rem] font-semibold">{s.name}</h3>
              {s.cell.enough ? (
                <dl className="flex flex-col text-[0.84rem]">
                  {[
                    ["Openings", `${count(s.cell.openings)} a month`],
                    ["Median, 3–5 yrs", mid ? lakh(mid.median) : "Not enough data"],
                    ["Middle half, 3–5 yrs", mid ? `${lakh(mid.p25)} to ${lakh(mid.p75)}` : "Not enough data"],
                    ["Median, 0–2 yrs", junior ? lakh(junior.median) : "Not enough data"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-0.5 border-t border-line py-1.5">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <NotEnough />
              )}
            </div>
          );
        })}
      </div>
      {sentence && <p className="rounded-md bg-surface-2 px-3 py-2.5 text-[0.86rem]">{sentence}</p>}
    </Card>
  );
}
