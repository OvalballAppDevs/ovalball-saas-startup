"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { groupLetter } from "@/lib/competitions/drafts"
import { distanceAllocation, groupTravel, randomAllocation, swapEntrants, validateAllocation, type GroupEntrant } from "@/lib/competitions/groups"
import { participantLabel, type CompetitionWorkspace } from "@/lib/competitions/workspace-types"
import { leaveNotice, takeNotice } from "@/lib/competitions/flash"
import { cn } from "@/lib/utils"

import { saveStage } from "../../actions"

/**
 * GROUPS -- A BOARD, NOT A FORM.
 *
 * Columns per group separated by hairlines. Allocation is Random (a numbered
 * draw that can be redrawn and repeated exactly), By Distance (nearby clubs
 * together, from recorded club locations only) or Manual. Moving teams is two
 * clicks -- choose a team, then another team to swap with or a group to move
 * it to -- so the keyboard and a pointer do exactly the same thing and no
 * drag is ever required. Nothing is saved until Save Groups.
 */

type Mode = "random" | "distance" | "manual"

export function StepGroups({ ws }: { ws: CompetitionWorkspace }) {
  const router = useRouter()
  const league = ws.stages.find((s) => s.kind === "league")
  const entered = useMemo(() => ws.participants.filter((p) => p.status === "entered"), [ws.participants])
  const byId = useMemo(() => new Map(entered.map((p) => [p.id, p])), [entered])
  const entrants: GroupEntrant[] = useMemo(() => entered.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })), [entered])

  const savedGroups = league?.groups.map((g) => g.members.filter((m) => byId.has(m))) ?? []
  const [mode, setMode] = useState<Mode>((league?.settings.allocation as Mode) ?? "random")
  const [groupCount, setGroupCount] = useState<number>(league?.settings.groupCount ?? (league?.groups.length || Math.max(1, Math.round(entered.length / 8)) || 1))
  const [seedNumber, setSeedNumber] = useState<number>(league?.settings.seedNumber ?? 1)
  const [groups, setGroups] = useState<string[][]>(() => (savedGroups.length > 0 ? savedGroups : []))
  const [selected, setSelected] = useState<string | null>(null)
  const [unlocated, setUnlocated] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => takeNotice(`${ws.editionId}:groups`))
  const [pending, start] = useTransition()

  if (ws.format === "knockout") {
    return (
      <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">
        This competition is a knockout, so it has no groups. Change the format in Details to add a group stage.
      </p>
    )
  }
  if (entered.length < 2) {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">Add at least two participants before drawing groups.</p>
  }

  const allocated = new Set(groups.flat())
  const unallocated = entered.filter((p) => !allocated.has(p.id)).map((p) => p.id)
  const check = validateAllocation(groups, entered.map((p) => p.id))
  const travel = groups.length > 0 && entrants.some((e) => e.lat !== null) ? Math.round(groupTravel(groups, entrants)) : null
  const hasDrafts = ws.matches.some((m) => m.stageId === league?.id)
  const hasIssued = ws.matches.some((m) => m.stageId === league?.id && m.status !== "draft")

  function draw(nextMode: Mode, nextCount = groupCount, nextSeed = seedNumber) {
    setNotice(null)
    setSelected(null)
    const count = Math.max(1, Math.min(nextCount, entered.length))
    if (nextMode === "random") {
      const a = randomAllocation(entrants, count, nextSeed)
      setGroups(a.groups)
      setUnlocated([])
    } else if (nextMode === "distance") {
      const a = distanceAllocation(entrants, count)
      setGroups(a.groups)
      setUnlocated(a.unlocated)
    } else {
      setGroups(Array.from({ length: count }, (_, i) => groups[i] ?? []))
      setUnlocated([])
    }
  }

  function clickTeam(id: string) {
    if (!selected) return setSelected(id)
    if (selected === id) return setSelected(null)
    setGroups((g) => swapEntrants(g, selected, id))
    setMode("manual")
    setSelected(null)
  }

  function moveTo(groupIndex: number) {
    if (!selected) return
    setGroups((all) => {
      const next = all.map((g) => g.filter((m) => m !== selected))
      next[groupIndex] = [...(next[groupIndex] ?? []), selected]
      return next
    })
    setMode("manual")
    setSelected(null)
  }

  function save() {
    setError(null)
    setNotice(null)
    start(async () => {
      const r = await saveStage(ws.editionId, {
        stageId: league?.id ?? null,
        kind: "league",
        name: "Group Stage",
        sortOrder: 1,
        settings: { ...(league?.settings ?? {}), allocation: mode, groupCount: groups.length, seedNumber },
        groups: groups.map((members, i) => ({ name: `Group ${groupLetter(i)}`, members })),
      })
      if (!r.ok) return setError(r.error)
      setNotice(hasDrafts ? "Groups saved. Regenerate the draft fixtures so they match." : "Groups saved.")
      leaveNotice(`${ws.editionId}:groups`, hasDrafts ? "Groups saved. Regenerate the draft fixtures so they match." : "Groups saved.")
      router.refresh()
    })
  }

  const label = (id: string) => participantLabel(byId.get(id))

  return (
    <section aria-labelledby="groups-title" className="rounded-lg border border-ink/10 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/8 px-5 py-4">
        <div>
          <h2 id="groups-title" className="text-base font-semibold text-ink">
            Groups
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {entered.length} teams{groups.length > 0 ? ` in ${groups.length} groups` : ""}.{travel !== null ? ` Clubs in the same group are ${travel.toLocaleString("en-GB")} miles apart in total, in straight lines.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="group-count" className="block text-xs font-medium text-ink-muted">
              Number of Groups
            </label>
            <input
              id="group-count"
              type="number"
              min={1}
              max={entered.length}
              value={groupCount}
              onChange={(e) => setGroupCount(Math.max(1, Number(e.target.value) || 1))}
              className="mt-1 h-9 w-20 rounded-md border border-ink/15 bg-white px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/40"
            />
          </div>
          <div className="inline-flex rounded-md border border-ink/15 p-0.5" role="radiogroup" aria-label="Allocation">
            {(["random", "distance", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m)
                  draw(m)
                }}
                className={cn("h-8 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400", mode === m ? "bg-forest-800 font-medium text-white" : "text-ink hover:bg-ink/[0.05]")}
              >
                {m === "random" ? "Random" : m === "distance" ? "By Distance" : "Manual"}
              </button>
            ))}
          </div>
          {mode === "random" && groups.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => {
                setSeedNumber((s) => s + 1)
                draw("random", groupCount, seedNumber + 1)
              }}
            >
              Draw Again
            </Button>
          )}
          <Button type="button" variant="outline" className="h-9" onClick={() => draw(mode)}>
            {groups.length > 0 ? "Redraw" : "Draw Groups"}
          </Button>
          <Button type="button" className="h-9" disabled={pending || groups.length === 0 || !check.ok || hasIssued} onClick={save}>
            {pending ? "Saving…" : "Save Groups"}
          </Button>
        </div>
      </div>

      <div className="space-y-1 border-b border-ink/8 px-5 py-2 text-sm [&:not(:has(>:not(:empty)))]:hidden">
        {mode === "random" && groups.length > 0 && <p className="text-ink-muted">Draw number {seedNumber}. The same number always gives the same groups.</p>}
        {selected && <p className="text-ink">{label(selected)} chosen. Choose another team to swap with, or a group to move it to.</p>}
        {unlocated.length > 0 && (
          <p className="text-amber-800">
            ▲ {unlocated.length === entered.length
              ? "None of these clubs has a location on record, so By Distance cannot group them by travel. Use Random or Manual, or add club locations."
              : `${unlocated.length} club${unlocated.length === 1 ? " has" : "s have"} no location on record, so By Distance placed ${unlocated.length === 1 ? "it" : "them"} last: ${unlocated.slice(0, 5).map(label).join(", ")}${unlocated.length > 5 ? ` and ${unlocated.length - 5} more` : ""}.`}
          </p>
        )}
        {!check.ok && groups.length > 0 && <p className="text-destructive-text">■ Every team must be in exactly one group before saving.</p>}
        {hasIssued && <p className="text-ink-muted">Group fixtures have been issued, so the groups are fixed.</p>}
        {error && <p role="alert" className="text-destructive-text">{error}</p>}
        <p role="status" aria-live="polite" className="text-ink empty:hidden">{notice}</p>
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-8 text-sm text-ink-muted">Choose how many groups and how to allocate, then Draw Groups.</p>
      ) : (
        <div className="grid divide-y divide-ink/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {groups.map((members, gi) => (
            <div key={gi} className="min-w-0 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  Group {groupLetter(gi)} <span className="font-normal text-ink-muted tabular-nums">({members.length})</span>
                </h3>
                {selected && !members.includes(selected) && (
                  <button type="button" onClick={() => moveTo(gi)} className="min-h-8 rounded px-2.5 text-xs font-medium text-forest-800 pointer-coarse:min-h-11 outline-none hover:bg-forest-800/[0.06] focus-visible:ring-2 focus-visible:ring-pitch-400">
                    Move Here
                  </button>
                )}
              </div>
              <ol className="mt-1.5">
                {members.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={selected === id}
                      onClick={() => clickTeam(id)}
                      title={label(id)}
                      className={cn(
                        "flex h-9 w-full items-center truncate rounded px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                        selected === id ? "bg-forest-800 text-white" : "text-ink hover:bg-ink/[0.04]",
                        unlocated.includes(id) && selected !== id && "text-amber-900",
                      )}
                    >
                      {label(id)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {unallocated.length > 0 && groups.length > 0 && (
        <div className="border-t border-ink/8 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Not in a Group ({unallocated.length})</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {unallocated.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                onClick={() => setSelected(selected === id ? null : id)}
                className={cn("h-8 rounded border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400", selected === id ? "border-forest-800 bg-forest-800 text-white" : "border-ink/15 text-ink hover:bg-ink/[0.04]")}
              >
                {label(id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
