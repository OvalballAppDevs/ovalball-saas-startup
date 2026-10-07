import { dispensationLadder, dispensationLadderSentence, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

/**
 * THE AGE-GRADE BRIDGE -- the one picture of a dispensation, drawn the same on the website and the phone
 * from `dispensationLadder` (packages/contracts/src/team/dispensation.ts).
 *
 * A short ladder of age grades: the child's own grade filled, the team's outlined, and the bridge between
 * them in the state the record is in -- dashed amber while a request waits (nothing is built yet), solid
 * green once approved, broken grey when declined, withdrawn, expired or revoked. It says, before a word is
 * read, that the child does not normally fit and that crossing the gap is an exception.
 *
 * The drawing is decorative to assistive technology: its meaning is one sentence, read instead of it.
 */
const RUNG = 88
const BOX_W = 72
const BOX_H = 44

const BRIDGE = {
  waiting: { stroke: "#8a5a00", dash: "7 6", width: 3 },
  built: { stroke: "var(--pitch-600)", dash: undefined, width: 4 },
  broken: { stroke: "#9ca3a0", dash: "3 8", width: 3 },
} as const

export function AgeGradeBridge({
  record,
  className,
}: {
  record: Pick<DispensationRecord, "playerAgeGroup" | "teamAgeGroup" | "verdict" | "status" | "player" | "team">
  className?: string
}) {
  const ladder = dispensationLadder(record)
  if (!ladder) return null
  const width = ladder.rungs.length * RUNG
  const playerAt = ladder.rungs.findIndex((r) => r.role === "player")
  const teamAt = ladder.rungs.findIndex((r) => r.role === "team")
  const cx = (i: number) => i * RUNG + RUNG / 2
  const from = cx(Math.min(playerAt, teamAt))
  const to = cx(Math.max(playerAt, teamAt))
  const bridge = BRIDGE[ladder.bridge]
  const y = 8 + BOX_H + 14
  const gap = ladder.bridge === "broken" ? 14 : 0
  const mid = (from + to) / 2

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${y + 10}`}
        className="h-auto w-full max-w-md"
        aria-hidden="true"
        focusable="false"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {ladder.rungs.map((rung, i) => {
          const x = i * RUNG + (RUNG - BOX_W) / 2
          const player = rung.role === "player"
          const team = rung.role === "team"
          return (
            <g key={rung.grade}>
              <rect
                x={x}
                y={8}
                width={BOX_W}
                height={BOX_H}
                rx={10}
                fill={player ? "var(--forest-800)" : team ? "#ffffff" : "transparent"}
                stroke={player ? "var(--forest-800)" : team ? "var(--forest-800)" : "rgba(16,21,18,0.14)"}
                strokeWidth={team ? 2.5 : 1.5}
                strokeDasharray={rung.role === "edge" ? "4 4" : undefined}
              />
              <text
                x={x + BOX_W / 2}
                y={8 + BOX_H / 2 + 8}
                textAnchor="middle"
                fontSize={24}
                letterSpacing={1}
                fill={player ? "#ffffff" : team ? "var(--forest-800)" : "#8a8f8b"}
              >
                {rung.grade}
              </text>
            </g>
          )
        })}
        {/* The bridge: from the child's rung to the team's, in the record's state. */}
        <line x1={from} y1={y} x2={gap ? mid - gap / 2 : to} y2={y} stroke={bridge.stroke} strokeWidth={bridge.width} strokeDasharray={bridge.dash} strokeLinecap="round" />
        {gap > 0 && <line x1={mid + gap / 2} y1={y} x2={to} y2={y} stroke={bridge.stroke} strokeWidth={bridge.width} strokeDasharray={bridge.dash} strokeLinecap="round" />}
        <circle cx={from} cy={y} r={5} fill={bridge.stroke} />
        <circle cx={to} cy={y} r={5} fill={bridge.stroke} />
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-forest-800" />
          {record.player.firstName ? `${record.player.firstName}'s age grade` : "Their age grade"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm border-2 border-forest-800 bg-white" />
          {record.team.label}
        </span>
        <span className="sr-only">{dispensationLadderSentence(record)}</span>
      </figcaption>
    </figure>
  )
}
