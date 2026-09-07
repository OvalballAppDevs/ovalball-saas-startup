import type { ReactNode } from "react"

/**
 * The dashboard's two charts, hand-built as SVG.
 *
 * No chart dependency was added, deliberately. Phase A shipped none, the
 * tree is 19 production dependencies, and Phase B needs exactly two shapes:
 * a twelve-bucket grouped bar chart and a single-series line. A charting
 * framework would be more code than the charts, would bring its own
 * accessibility model to argue with, and would need wrapping to hit the
 * palette anyway. If a later phase needs stacked areas, brushing or
 * zooming, that is the moment to reconsider -- and this file is small
 * enough to throw away.
 *
 * Accessibility is the reason these are components rather than inline SVG:
 * every chart here is required to carry a title, a text summary, and a real
 * <table> of the same numbers. The table is not a fallback for a broken
 * chart -- it is always in the DOM, visually collapsed behind a
 * <details>, so a screen-reader user and a sighted user read the same data
 * rather than one of them reading an apology. Series are distinguished by
 * fill AND by pattern AND by label, never by colour alone.
 */

function ChartFrame({
  title,
  summary,
  children,
  table,
}: {
  title: string
  summary: string
  children: ReactNode
  table: ReactNode
}) {
  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {title}. {summary}
      </figcaption>
      <div role="img" aria-label={`${title}. ${summary}`}>
        {children}
      </div>
      <details className="mt-3 group">
        <summary className="cursor-pointer text-xs text-ink-muted outline-none hover:text-ink/80 focus-visible:ring-2 focus-visible:ring-pitch-400">
          View as table
        </summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  )
}

const TABLE_CLS = "w-full text-left text-xs tabular-nums"
const TH_CLS = "border-b border-ink/10 px-2 py-1.5 font-medium text-ink-muted"
const TD_CLS = "border-b border-ink/5 px-2 py-1.5 text-ink/80"

/* ------------------------------------------------------------------ */
/* Grouped bars: fixtures booked vs playing, by week                   */
/* ------------------------------------------------------------------ */

export interface GroupedBarPoint {
  label: string
  a: number
  b: number
}

export function GroupedBarChart({
  title,
  summary,
  points,
  aLabel,
  bLabel,
}: {
  title: string
  summary: string
  points: GroupedBarPoint[]
  aLabel: string
  bLabel: string
}) {
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]))
  const W = 100
  const H = 42
  const slot = W / Math.max(1, points.length)
  const barW = Math.min(3.2, slot * 0.32)

  return (
    <ChartFrame
      title={title}
      summary={summary}
      table={
        <table className={TABLE_CLS}>
          <thead>
            <tr>
              <th scope="col" className={TH_CLS}>Week beginning</th>
              <th scope="col" className={TH_CLS}>{aLabel}</th>
              <th scope="col" className={TH_CLS}>{bLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row" className={`${TD_CLS} font-normal`}>{p.label}</th>
                <td className={TD_CLS}>{p.a}</td>
                <td className={TD_CLS}>{p.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {/* Legend first: the reader learns what the shapes mean before seeing
          them, and each series is named in text, not just coloured. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-forest-800" />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm border border-forest-800/60 bg-mint-100"
          />
          {bLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H + 6}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" className="text-ink-muted" strokeWidth="0.3" />
        {points.map((p, i) => {
          const x = i * slot + slot / 2
          const ha = (p.a / max) * (H - 2)
          const hb = (p.b / max) * (H - 2)
          return (
            <g key={i}>
              <rect
                x={x - barW - 0.3}
                y={H - ha}
                width={barW}
                height={ha}
                rx="0.4"
                className="fill-forest-800"
              />
              <rect
                x={x + 0.3}
                y={H - hb}
                width={barW}
                height={hb}
                rx="0.4"
                className="fill-mint-100 stroke-forest-800/60"
                strokeWidth="0.3"
              />
            </g>
          )
        })}
      </svg>

      {/* Only the ends are labelled: twelve rotated dates at 390px is
          unreadable, and the table carries every value anyway. */}
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </ChartFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Single-series line: growth                                          */
/* ------------------------------------------------------------------ */

export interface LinePoint {
  label: string
  value: number
}

export function LineChart({
  title,
  summary,
  points,
  seriesLabel,
}: {
  title: string
  summary: string
  points: LinePoint[]
  seriesLabel: string
}) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const W = 100
  const H = 42
  const step = points.length > 1 ? W / (points.length - 1) : W

  const xy = points.map((p, i) => ({
    x: points.length > 1 ? i * step : W / 2,
    y: H - (p.value / max) * (H - 2),
  }))
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
  const area = `${path} L${xy[xy.length - 1]?.x.toFixed(2) ?? 0},${H} L${xy[0]?.x.toFixed(2) ?? 0},${H} Z`

  const total = points.reduce((s, p) => s + p.value, 0)

  return (
    <ChartFrame
      title={title}
      summary={summary}
      table={
        <table className={TABLE_CLS}>
          <thead>
            <tr>
              <th scope="col" className={TH_CLS}>Period</th>
              <th scope="col" className={TH_CLS}>{seriesLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row" className={`${TD_CLS} font-normal`}>{p.label}</th>
                <td className={TD_CLS}>{p.value}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className={`${TD_CLS} font-medium`}>Total</th>
              <td className={`${TD_CLS} font-medium`}>{total}</td>
            </tr>
          </tbody>
        </table>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H + 6}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" className="text-ink-muted" strokeWidth="0.3" />
        <path d={area} className="fill-pitch-600/12" />
        <path
          d={path}
          fill="none"
          className="stroke-forest-800"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </ChartFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Adoption: proportion bars                                           */
/* ------------------------------------------------------------------ */

export function AdoptionBars({
  rows,
  denominator,
  denominatorLabel,
}: {
  rows: { label: string; value: number; note?: string }[]
  denominator: number
  denominatorLabel: string
}) {
  return (
    <div>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const pct = denominator > 0 ? Math.round((r.value / denominator) * 100) : 0
          return (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink/80">{r.label}</span>
                <span className="shrink-0 tabular-nums text-ink/60">
                  <span className="font-medium text-ink">{r.value}</span> of {denominator} · {pct}%
                </span>
              </div>
              {/* The number is stated in text above; the bar is a second,
                  redundant signal rather than the only one. */}
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink/8"
                role="meter"
                aria-valuenow={r.value}
                aria-valuemin={0}
                aria-valuemax={denominator}
                aria-label={`${r.label}: ${r.value} of ${denominator} ${denominatorLabel}`}
              >
                <div className="h-full rounded-full bg-forest-800" style={{ width: `${pct}%` }} />
              </div>
              {r.note ? <p className="mt-1 text-xs text-ink-muted">{r.note}</p> : null}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        Measured against {denominator.toLocaleString("en-GB")} {denominatorLabel} — never the
        canonical club directory, which is addressable market rather than customers.
      </p>
    </div>
  )
}
