"use client"

import { useState } from "react"
import { CheckCircle2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"

import { createNextSeasonSchedulingGroup } from "./actions"

export interface MiniRugbyGroupTeamOption {
  teamId: string
  displayName: string
  projectedAgeGroup: string | null
}

export interface MiniRugbyGroupRow {
  id: string
  displayTag: string
  alias: string | null
  teams: MiniRugbyGroupTeamOption[]
  /** Set once a next-season group already exists for this group's teams -- the wizard shows its result instead of offering the actions again. */
  alreadyCreatedTag: string | null
}

/**
 * Season Handover Section 7-10: for each of this club's active
 * Mini-Rugby Groups in the current season, offer CREATE NEXT-SEASON
 * GROUP (same teams) / EDIT COMPOSITION THEN CREATE / SKIP. Every path
 * creates a brand-new group_id for toSeasonId -- the historical group
 * shown here is never mutated, exactly like graduate_team() archives
 * rather than renames a cohort.
 */
export function MiniRugbyNextSeasonReview({
  toSeasonId,
  toSeasonName,
  groups,
}: {
  toSeasonId: string | null
  toSeasonName: string | null
  groups: MiniRugbyGroupRow[]
}) {
  if (groups.length === 0) return null

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-forest-800" />
        <h2 className="font-display text-lg text-ink">Mini-Rugby Groups -- next season</h2>
      </div>
      <p className="mt-1.5 text-sm text-ink/55">
        {toSeasonName
          ? `Decide how each shared Mini-Rugby Group should continue into ${toSeasonName}. Skipping leaves it for later -- nothing here changes this season's group.`
          : "A next season must be configured before a Mini-Rugby Group can be progressed."}
      </p>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <MiniRugbyGroupCard key={group.id} group={group} toSeasonId={toSeasonId} toSeasonName={toSeasonName} />
        ))}
      </div>
    </div>
  )
}

function MiniRugbyGroupCard({ group, toSeasonId, toSeasonName }: { group: MiniRugbyGroupRow; toSeasonId: string | null; toSeasonName: string | null }) {
  const [mode, setMode] = useState<"idle" | "editing">("idle")
  const [selected, setSelected] = useState<Set<string>>(new Set(group.teams.map((t) => t.teamId)))
  const [alias, setAlias] = useState(group.alias ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(group.alreadyCreatedTag)

  if (result) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-pitch-600/25 bg-mint-100/40 px-4 py-3 text-sm text-ink">
        <CheckCircle2 className="size-4 shrink-0 text-pitch-600" />
        <span>
          <strong className="font-medium">{group.alias ?? group.displayTag}</strong> continues into {toSeasonName} as <strong className="font-medium">{result}</strong>.
        </span>
      </div>
    )
  }

  async function submit() {
    if (!toSeasonId) return
    const teamIds = Array.from(selected)
    if (teamIds.length === 0) {
      setError("Select at least one team.")
      return
    }
    setPending(true)
    setError(null)
    const res = await createNextSeasonSchedulingGroup(group.id, toSeasonId, teamIds, alias.trim() || null)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const chosenTag = group.teams
      .filter((t) => selected.has(t.teamId))
      .map((t) => t.projectedAgeGroup)
      .filter(Boolean)
      .join("/")
    setResult(chosenTag || "the new group")
  }

  function toggleTeam(teamId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-chalk/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{group.alias ?? group.displayTag}</p>
          <p className="text-xs text-ink/55">
            Currently {group.displayTag} -- {group.teams.map((t) => t.displayName).join(", ")}
          </p>
        </div>
      </div>

      {mode === "editing" && (
        <div className="mt-3 space-y-2 border-t border-ink/10 pt-3">
          <p className="text-xs font-medium tracking-wide text-ink/55 uppercase">Teams in the next-season group</p>
          {group.teams.map((t) => (
            <label key={t.teamId} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={selected.has(t.teamId)}
                onChange={() => toggleTeam(t.teamId)}
                className="size-4 rounded border-ink/25 text-pitch-600 focus-visible:ring-pitch-600"
              />
              {t.displayName}
              {t.projectedAgeGroup && <span className="text-ink/45"> -&gt; {t.projectedAgeGroup}</span>}
            </label>
          ))}
          <div>
            <label className="text-xs font-medium tracking-wide text-ink/55 uppercase">Alias (optional)</label>
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. The Minis"
              className="mt-1 h-9 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === "idle" ? (
          <>
            <Button
              size="sm"
              disabled={!toSeasonId || pending}
              onClick={() => {
                setSelected(new Set(group.teams.map((t) => t.teamId)))
                void submit()
              }}
            >
              Create next-season group
            </Button>
            <Button size="sm" variant="outline" disabled={!toSeasonId} onClick={() => setMode("editing")}>
              Edit composition then create
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={pending} onClick={() => void submit()}>
              {pending ? "Creating..." : "Create with these teams"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
