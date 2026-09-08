import Link from "next/link"

/**
 * The transition ledger.
 *
 * Deliberately not a grid of stat cards. A Club Admin arriving here wants to
 * read what is about to happen to their club as a list of plain statements,
 * and every one of those statements is in the FUTURE tense until the handover
 * runs -- "will become", "will be created", "will not continue". The tense is
 * decided by the server (handover_consequences), so this cannot drift into
 * telling somebody a team was added when it has not been.
 */

export interface HandoverConsequence {
  kind: "progress" | "graduate" | "fold" | "plan" | "created" | "reactivated"
  fromLabel: string | null
  toLabel: string | null
  note: string | null
  isApplied: boolean
}

export interface OverviewCounts {
  teamsTotal: number
  teamsPending: number
  playersTotal: number
  playersNeedingAttention: number
  dispensationsPending: number
  playersClubHolding: number
}

function ConsequenceLine({ c }: { c: HandoverConsequence }) {
  const applied = c.isApplied
  let sentence: React.ReactNode
  switch (c.kind) {
    case "progress":
      sentence = (
        <>
          <span className="font-medium text-ink">{c.fromLabel}</span>
          <span className="text-ink/40"> {applied ? "became" : "will become"} </span>
          <span className="font-medium text-ink">{c.toLabel}</span>
        </>
      )
      break
    case "graduate":
      sentence = (
        <>
          <span className="font-medium text-ink">{c.fromLabel}</span>
          <span className="text-ink/55"> {applied ? "completed" : "completes"} the youth pathway</span>
        </>
      )
      break
    case "fold":
      sentence = (
        <>
          <span className="font-medium text-ink">{c.fromLabel}</span>
          <span className="text-ink/55"> {applied ? "did not continue" : "will not continue"}</span>
        </>
      )
      break
    case "reactivated":
      sentence = (
        <>
          <span className="font-medium text-ink">{c.toLabel}</span>
          <span className="text-ink/55"> {applied ? "was reactivated" : "will be reactivated"}</span>
        </>
      )
      break
    default:
      sentence = (
        <>
          <span className="font-medium text-ink">{c.toLabel}</span>
          <span className="text-ink/55"> {applied ? "was created" : "will be created"}</span>
        </>
      )
  }

  return (
    <li className="px-5 py-3.5">
      <p className="text-sm">{sentence}</p>
      {c.note && <p className="mt-0.5 text-sm text-ink/55">{c.note}</p>}
    </li>
  )
}

export function HandoverOverview({
  consequences,
  counts,
  toSeasonName,
  isApplied,
}: {
  consequences: HandoverConsequence[]
  counts: OverviewCounts
  toSeasonName: string | null
  isApplied: boolean
}) {
  if (consequences.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium text-ink">Nothing prepared yet</p>
        <p className="mt-1 max-w-lg text-sm text-ink/55">
          Once a handover is prepared, everything it will do to {toSeasonName ? `your club for ${toSeasonName}` : "your club"} is
          listed here before any of it happens. Prepare one from{" "}
          <Link href="/club/rollover?section=teams" className="text-forest-800 underline underline-offset-2">
            Teams
          </Link>
          .
        </p>
      </div>
    )
  }

  const teamLines = consequences.filter((c) => c.kind !== "plan" && c.kind !== "created" && c.kind !== "reactivated")
  const newLines = consequences.filter((c) => c.kind === "plan" || c.kind === "created" || c.kind === "reactivated")

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-ink/10 bg-white">
        <div className="border-b border-ink/8 px-5 py-3.5">
          <p className="text-sm font-medium text-ink">Teams already at the club</p>
          <p className="mt-0.5 text-sm text-ink/55">
            {isApplied ? "What this handover did to each cohort." : "What this handover will do to each cohort when you apply it."}
          </p>
        </div>
        <ul className="divide-y divide-ink/8">
          {teamLines.map((c, i) => (
            <ConsequenceLine key={`${c.kind}-${c.fromLabel}-${i}`} c={c} />
          ))}
          {teamLines.length === 0 && <li className="px-5 py-3.5 text-sm text-ink/55">No team decisions recorded yet.</li>}
        </ul>
      </div>

      {newLines.length > 0 && (
        <div className="rounded-lg border border-ink/10 bg-white">
          <div className="border-b border-ink/8 px-5 py-3.5">
            <p className="text-sm font-medium text-ink">Teams the club will run</p>
            <p className="mt-0.5 text-sm text-ink/55">
              {isApplied
                ? "Sides this handover created."
                : "Planned, not created. Each of these takes an identity that a current cohort only gives up when the handover runs."}
            </p>
          </div>
          <ul className="divide-y divide-ink/8">
            {newLines.map((c, i) => (
              <ConsequenceLine key={`new-${c.toLabel}-${i}`} c={c} />
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-ink/10 bg-white">
        <div className="border-b border-ink/8 px-5 py-3.5">
          <p className="text-sm font-medium text-ink">People</p>
        </div>
        <ul className="divide-y divide-ink/8 text-sm">
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">Players reviewed</span>
            <span className="font-medium text-ink tabular-nums">{counts.playersTotal}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">
              {counts.playersNeedingAttention > 0 ? (
                <Link href="/club/rollover?section=attention" className="text-forest-800 underline underline-offset-2">
                  Need a decision
                </Link>
              ) : (
                "Need a decision"
              )}
            </span>
            <span className="font-medium text-ink tabular-nums">{counts.playersNeedingAttention}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">Reaching the end of the youth pathway</span>
            <span className="font-medium text-ink tabular-nums">{counts.playersClubHolding}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">Awaiting governing-body approval</span>
            <span className="font-medium text-ink tabular-nums">{counts.dispensationsPending}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">
              {counts.teamsPending > 0 ? (
                <Link href="/club/rollover?section=teams" className="text-forest-800 underline underline-offset-2">
                  Teams still undecided
                </Link>
              ) : (
                "Teams still undecided"
              )}
            </span>
            <span className="font-medium text-ink tabular-nums">{counts.teamsPending}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
