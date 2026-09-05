"use client"

import { useState } from "react"
import { CalendarRange, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"

import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"

import { createSchedulingGroup, setSchedulingGroupActive, setSchedulingGroupAlias, type SchedulingGroup, type SchedulingGroupMember } from "../club/actions"

/**
 * U6/U7/U8 only, real team ids selected -- create_scheduling_group itself
 * refuses anything outside the mini-rugby band or fewer than two distinct
 * ages (internal.validate_mini_rugby_team_set), so this picker only offers
 * U6-U8 teams in the first place rather than letting a Club Admin discover
 * the rule via a rejected submit. Every group belongs to the CURRENT season
 * only (seasonId/seasonName) -- there is no "shared calendar" concept here
 * any more: a Mini-Rugby Group is a season-bound operational arrangement
 * over stable component teams, never a second team identity.
 */
export function MiniRugbyCalendarsSection({
  clubId,
  seasonId,
  seasonName,
  eligibleTeams,
  initial,
}: {
  clubId: string
  seasonId: string
  seasonName: string
  eligibleTeams: SchedulingGroupMember[]
  initial: SchedulingGroup[]
}) {
  const [groups, setGroups] = useState(initial)
  const [creating, setCreating] = useState(false)
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null)
  const [aliasDraft, setAliasDraft] = useState("")

  const suggestedTag = eligibleAgesTag(selectedTeamIds, eligibleTeams)

  function toggleTeam(id: string) {
    setSelectedTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  async function handleCreate() {
    setPending(true)
    setError(null)
    const result = await createSchedulingGroup(clubId, selectedTeamIds, seasonId)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedTeamIds([])
    setCreating(false)
    window.location.reload()
  }

  async function handleToggleActive(group: SchedulingGroup) {
    setPending(true)
    setError(null)
    const result = await setSchedulingGroupActive(group.id, !group.active)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, active: !g.active } : g)))
  }

  async function handleSaveAlias(group: SchedulingGroup) {
    setPending(true)
    setError(null)
    const result = await setSchedulingGroupAlias(group.id, aliasDraft)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, alias: aliasDraft.trim() || null } : g)))
    setEditingAliasId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Mini-Rugby Groups &middot; {seasonName}</p>
        {!creating && eligibleTeams.length >= 2 && (
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setCreating(true)}>
            Create Mini-Rugby Group
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink/45">
        Combine two or three of your U6-U8 teams into one Mini-Rugby Group (e.g. &ldquo;U7/U8&rdquo;) for scheduling
        convenience only &mdash; each team keeps its own real fixtures, results, and stats. Teams in a Mini-Rugby
        Group share one fixture schedule: if the group has a fixture, every team included in it is unavailable for
        another fixture that day.
      </p>

      {eligibleTeams.length < 2 && !creating && (
        <p className="mt-3 text-sm text-ink/45">You need at least two U6, U7, or U8 teams to create a Mini-Rugby Group.</p>
      )}

      {groups.length === 0 && !creating && eligibleTeams.length >= 2 && <p className="mt-3 text-sm text-ink/45">No Mini-Rugby Groups yet this season.</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarRange className="size-4 shrink-0 text-ink/35" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {miniRugbyGroupLabel(g)} {!g.active && <span className="text-ink/40">(inactive)</span>}
                </p>
                <p className="truncate text-xs text-ink/50">Includes: {g.members.map((m) => m.displayName).join(", ")}</p>
                {editingAliasId === g.id ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={aliasDraft}
                      onChange={(e) => setAliasDraft(e.target.value)}
                      placeholder="e.g. Falcons"
                      className="h-7 w-32 rounded border border-ink/15 px-2 text-xs outline-none focus-visible:border-pitch-600"
                    />
                    <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => handleSaveAlias(g)}>
                      Save
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditingAliasId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 flex items-center gap-1 text-xs text-ink/40 outline-none hover:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    onClick={() => {
                      setEditingAliasId(g.id)
                      setAliasDraft(g.alias ?? "")
                    }}
                  >
                    <Pencil className="size-3" />
                    {g.alias ? "Edit alias" : "Add alias"}
                  </button>
                )}
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" disabled={pending} onClick={() => handleToggleActive(g)}>
              {g.active ? "Deactivate" : "Reactivate"}
            </Button>
          </li>
        ))}
      </ul>

      {creating && (
        <div className="mt-3 rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium text-ink/50 uppercase">Select teams (at least two different ages)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {eligibleTeams.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={selectedTeamIds.includes(t.id)}
                onClick={() => toggleTeam(t.id)}
                className={`min-h-11 rounded-full border px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                  selectedTeamIds.includes(t.id) ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/60 hover:bg-ink/5"
                }`}
              >
                {t.displayName} ({t.ageGroup})
              </button>
            ))}
          </div>

          {suggestedTag && (
            <p className="mt-3 text-sm text-ink/60">
              Suggested name: <span className="font-medium text-ink">{suggestedTag} Tags</span>
            </p>
          )}

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" className="h-9" disabled={pending || selectedTeamIds.length < 2} onClick={handleCreate}>
              {pending ? "Creating…" : "Create Mini-Rugby Group"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setCreating(false)
                setSelectedTeamIds([])
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && !creating && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** Pure preview of the age-derived tag as teams are selected -- the same logic the server computes canonically; purely cosmetic here, never trusted as the real value. */
function eligibleAgesTag(selectedTeamIds: string[], eligibleTeams: SchedulingGroupMember[]): string | null {
  const ages = Array.from(new Set(selectedTeamIds.map((id) => eligibleTeams.find((t) => t.id === id)?.ageGroup).filter((a): a is string => Boolean(a))))
  if (ages.length < 2) return null
  const order = ["U6", "U7", "U8"]
  return ages.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("/")
}
