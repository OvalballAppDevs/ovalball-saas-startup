"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, X } from "lucide-react"

import { ClubCombobox } from "@/components/fixtures/club-combobox"
import { Button } from "@/components/ui/button"
import { leaveNotice, takeNotice } from "@/lib/competitions/flash"
import type { CompetitionWorkspace } from "@/lib/competitions/workspace-types"
import type { ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"

import { competitionClubCatalogue, competitionClubTeams, saveParticipants, type CompetitionTeamOption } from "../../actions"

/**
 * PARTICIPANTS -- NUMBERED SLOTS, CANONICAL CLUBS AND TEAMS.
 *
 * A slot names a Club Directory club and, for an Ovalball club, one of its
 * real teams. The team the competition is for (its age and category) is
 * chosen automatically when the club runs exactly one; otherwise the organiser
 * picks. A club not on Ovalball is entered as the club -- it is not blocked,
 * and its matches are managed by the competition. Duplicates are flagged in
 * the slot, never silently merged. Nothing is saved until Save Participants.
 */

interface Slot {
  key: string
  participantId: string | null
  clubDirectoryId: string | null
  clubName: string
  clubId: string | null
  teamId: string | null
  seed: string
}

let slotKey = 0
const newKey = () => `s${++slotKey}`

const catalogueByEdition = new Map<string, Promise<ClubCatalogueEntry[]>>()
const teamsCache = new Map<string, Promise<CompetitionTeamOption[]>>()

function initialSlots(ws: CompetitionWorkspace): Slot[] {
  const entered = ws.participants.filter((p) => p.status === "entered").sort((a, b) => a.slot - b.slot)
  // Keys (and the ids built from them) must be the same on the server and in the
  // browser: an entered slot is keyed by its participant, an empty one by its place.
  const slots: Slot[] = entered.map((p) => ({
    key: `p-${p.id}`,
    participantId: p.id,
    clubDirectoryId: p.clubDirectoryId,
    clubName: p.clubName,
    clubId: p.clubId,
    teamId: p.teamId,
    seed: p.seed ? String(p.seed) : "",
  }))
  const want = Math.max(ws.teamCount ?? 0, slots.length, 2)
  while (slots.length < want) slots.push({ key: `empty-${slots.length + 1}`, participantId: null, clubDirectoryId: null, clubName: "", clubId: null, teamId: null, seed: "" })
  return slots
}

export function StepParticipants({ ws }: { ws: CompetitionWorkspace }) {
  const router = useRouter()
  const [slots, setSlots] = useState<Slot[]>(() => initialSlots(ws))
  const [teams, setTeams] = useState<Record<string, CompetitionTeamOption[]>>(() => {
    // Seed the entered teams' labels so a saved slot shows its team before any request.
    const seeded: Record<string, CompetitionTeamOption[]> = {}
    for (const p of ws.participants) if (p.clubId && p.teamId) seeded[p.clubId] = [...(seeded[p.clubId] ?? []), { id: p.teamId, label: p.teamLabel ?? "Team", canonicalTeamTypeId: null }]
    return seeded
  })
  const [loadedClubs, setLoadedClubs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => takeNotice(`${ws.editionId}:participants`))
  const [pending, start] = useTransition()
  const [initial] = useState(() => JSON.stringify(initialSlots(ws).map(strip)))

  const loadCatalogue = () => {
    let p = catalogueByEdition.get(ws.editionId)
    if (!p) {
      p = competitionClubCatalogue(ws.editionId)
      catalogueByEdition.set(ws.editionId, p)
    }
    return p
  }

  function loadTeams(clubId: string): Promise<CompetitionTeamOption[]> {
    let p = teamsCache.get(clubId)
    if (!p) {
      p = competitionClubTeams(ws.editionId, clubId)
      teamsCache.set(clubId, p)
    }
    return p.then((list) => {
      setTeams((t) => ({ ...t, [clubId]: list }))
      setLoadedClubs((s) => new Set(s).add(clubId))
      return list
    })
  }

  const update = (key: string, patch: Partial<Slot>) => setSlots((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  async function chooseClub(key: string, choice: { directoryId: string | null; name: string; tenantClubId: string | null } | null) {
    setNotice(null)
    if (!choice?.directoryId) {
      update(key, { clubDirectoryId: null, clubName: "", clubId: null, teamId: null, participantId: null })
      return
    }
    update(key, { clubDirectoryId: choice.directoryId, clubName: choice.name, clubId: choice.tenantClubId, teamId: null })
    if (choice.tenantClubId) {
      const list = await loadTeams(choice.tenantClubId)
      // The team the competition is for, when the club runs exactly one of that identity.
      const matching = ws.canonicalTeamTypeId ? list.filter((t) => t.canonicalTeamTypeId === ws.canonicalTeamTypeId) : []
      if (matching.length === 1) update(key, { teamId: matching[0].id })
    }
  }

  function move(index: number, by: -1 | 1) {
    setSlots((all) => {
      const next = [...all]
      const j = index + by
      if (j < 0 || j >= next.length) return all
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>()
    const dup = new Set<string>()
    slots.forEach((s) => {
      if (!s.clubDirectoryId) return
      const identity = s.teamId ? `team:${s.teamId}` : `club:${s.clubDirectoryId}`
      if (seen.has(identity)) {
        dup.add(s.key)
        dup.add(slots[seen.get(identity)!].key)
      } else seen.set(identity, slots.indexOf(s))
    })
    return dup
  }, [slots])

  const filled = slots.filter((s) => s.clubDirectoryId)
  const ovalballWithoutTeam = filled.filter((s) => s.clubId && !s.teamId).length
  const dirty = JSON.stringify(slots.map(strip)) !== initial

  function save() {
    setError(null)
    setNotice(null)
    start(async () => {
      const r = await saveParticipants(
        ws.editionId,
        filled.map((s, i) => ({ id: s.participantId, slot: i + 1, clubDirectoryId: s.clubDirectoryId!, clubId: s.clubId, teamId: s.teamId, seed: s.seed ? Number(s.seed) : null })),
      )
      if (!r.ok) return setError(r.error)
      setNotice(`${filled.length} participants saved.`)
      leaveNotice(`${ws.editionId}:participants`, `${filled.length} participants saved.`)
      router.refresh()
    })
  }

  const half = Math.ceil(slots.length / 2)
  const columns = slots.length > 12 ? [slots.slice(0, half), slots.slice(half)] : [slots]

  return (
    <section aria-labelledby="participants-title" className="rounded-lg border border-ink/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-5 py-4">
        <div>
          <h2 id="participants-title" className="text-base font-semibold text-ink">
            Participants
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {filled.length} of {slots.length} slots filled.
            {ovalballWithoutTeam > 0 && ` ${ovalballWithoutTeam} Ovalball club${ovalballWithoutTeam === 1 ? " needs" : "s need"} a team chosen before its matches can be issued.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => setSlots((all) => [...all, { key: newKey(), participantId: null, clubDirectoryId: null, clubName: "", clubId: null, teamId: null, seed: "" }])}
          >
            Add Slot
          </Button>
          <Button type="button" className="h-9" disabled={!dirty || pending || duplicates.size > 0} onClick={save}>
            {pending ? "Saving…" : "Save Participants"}
          </Button>
        </div>
      </div>

      {
        <div className="border-b border-ink/8 px-5 py-2 text-sm [&:not(:has(>:not(:empty)))]:hidden">
          {error && <p role="alert" className="text-destructive-text">{error}</p>}
          {duplicates.size > 0 && <p role="alert" className="text-destructive-text">The same team or club is entered twice. Replace or remove one before saving.</p>}
          <p role="status" aria-live="polite" className="text-ink empty:hidden">{notice}</p>
        </div>
      }

      <div className={`grid gap-x-6 px-5 py-3 ${columns.length === 2 ? "xl:grid-cols-2" : ""}`}>
        {columns.map((col, ci) => (
          <div key={ci}>
          {/* Visible column names, so Seed is not a placeholder-only field. */}
          <div aria-hidden="true" className="hidden gap-2 pb-1 text-xs font-medium text-ink-muted sm:flex">
            <span className="w-7 shrink-0" />
            <span className="min-w-48 flex-1">Club</span>
            <span className="w-44">Team</span>
            <span className="w-16">Seed</span>
            <span className="w-24" />
          </div>
          <ol className="divide-y divide-ink/6" start={ci === 0 ? 1 : half + 1}>
            {col.map((s) => {
              const index = slots.indexOf(s)
              const clubTeams = s.clubId ? (teams[s.clubId] ?? []) : []
              const dup = duplicates.has(s.key)
              return (
                <li key={s.key} className={`flex flex-wrap items-center gap-2 py-1.5 ${dup ? "bg-destructive/[0.05]" : ""}`}>
                  <span className="w-7 shrink-0 text-right text-sm text-ink-muted tabular-nums" aria-hidden="true">
                    {index + 1}
                  </span>
                  <ClubCombobox
                    label={`Slot ${index + 1} Club`}
                    hideLabel
                    value={s.clubDirectoryId ? { directoryId: s.clubDirectoryId, name: s.clubName, tenantClubId: s.clubId } : null}
                    onChoose={(choice) => void chooseClub(s.key, choice)}
                    loadCatalogue={loadCatalogue}
                    className="min-w-48 flex-1"
                    placeholder="Search clubs"
                  />
                  {s.clubId ? (
                    <>
                      <label htmlFor={`team-${s.key}`} className="sr-only">
                        Slot {index + 1} Team
                      </label>
                      <select
                        id={`team-${s.key}`}
                        value={s.teamId ?? ""}
                        onFocus={() => s.clubId && !loadedClubs.has(s.clubId) && void loadTeams(s.clubId)}
                        onChange={(e) => update(s.key, { teamId: e.target.value || null })}
                        className="h-9 w-44 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/40"
                      >
                        <option value="">Choose Team</option>
                        {/* The competition's own age and category first; any other team is still there to choose. */}
                        {ws.canonicalTeamTypeId && clubTeams.some((t) => t.canonicalTeamTypeId === ws.canonicalTeamTypeId) ? (
                          <>
                            <optgroup label="For This Competition">
                              {clubTeams.filter((t) => t.canonicalTeamTypeId === ws.canonicalTeamTypeId).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Other Teams">
                              {clubTeams.filter((t) => t.canonicalTeamTypeId !== ws.canonicalTeamTypeId).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.label}
                                </option>
                              ))}
                            </optgroup>
                          </>
                        ) : (
                          clubTeams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))
                        )}
                      </select>
                    </>
                  ) : s.clubDirectoryId ? (
                    <span className="w-44 text-xs text-sky-700">Not on Ovalball. Competition-managed.</span>
                  ) : (
                    <span className="w-44" aria-hidden="true" />
                  )}
                  <label htmlFor={`seed-${s.key}`} className="sr-only">
                    Slot {index + 1} Seed
                  </label>
                  <input
                    id={`seed-${s.key}`}
                    inputMode="numeric"
                    value={s.seed}
                    onChange={(e) => update(s.key, { seed: e.target.value.replace(/\D/g, "") })}
                    placeholder="Seed"
                    className="h-9 w-16 rounded-md border border-ink/15 bg-white px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/40"
                  />
                  <span className="flex">
                    <IconButton label={`Move slot ${index + 1} up`} onClick={() => move(index, -1)} disabled={index === 0}>
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton label={`Move slot ${index + 1} down`} onClick={() => move(index, 1)} disabled={index === slots.length - 1}>
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton label={`Clear slot ${index + 1}`} onClick={() => update(s.key, { clubDirectoryId: null, clubName: "", clubId: null, teamId: null, participantId: null, seed: "" })} disabled={!s.clubDirectoryId}>
                      <X className="size-3.5" />
                    </IconButton>
                  </span>
                </li>
              )
            })}
          </ol>
          </div>
        ))}
      </div>
    </section>
  )
}

function strip(s: Slot) {
  return { c: s.clubDirectoryId, t: s.teamId, seed: s.seed }
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-8 items-center justify-center rounded-md pointer-coarse:size-11 text-ink-muted outline-none hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-30"
    >
      {children}
    </button>
  )
}
