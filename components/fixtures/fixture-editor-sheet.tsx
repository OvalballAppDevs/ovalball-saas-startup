"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Lock, Loader2 } from "lucide-react"

import {
  fixtureClubCatalogue,
  fixtureOppositionOptions,
  openFixtureEditor,
  saveFixture,
  type OpenFixtureEditorResult,
} from "@/app/(app)/fixtures/editor/actions"
import { ClubCombobox, type ClubChoice } from "@/components/fixtures/club-combobox"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"
import type { FieldAuthority, FixtureEditorModel, FixtureEditorPatch, OppositionOptions } from "@/lib/fixtures/fixture-editor"
import { FIXTURE_TYPE_OPTIONS, competitionApplies } from "@/lib/fixtures/fixture-type"
import { applyDefaultableChange, defaultVenue, type ClubGrounds, type DefaultableState } from "@/lib/fixtures/venue-defaults"
import { cn } from "@/lib/utils"

/**
 * EDIT FIXTURE -- ONE EDITOR, WHEREVER A FIXTURE IS OPENED.
 *
 * The Fixture Control Centre, Calendar and fixture detail open this sheet.
 * Which fields are editable, and why a field is not, comes from the server
 * (public.fixture_editable_fields); saving sends only what changed to each
 * field's canonical writer (lib/fixtures/fixture-editor.ts). No surface
 * decides either for itself.
 *
 * Requests: opening is one; the club catalogue is one per page, and only when
 * somebody starts looking for a different club; choosing a club is one.
 * Typing a club name filters in the browser.
 */

const SETTABLE_STATUSES = ["Planned", "Booked", "To Be Determined", "Completed"] as const

// One catalogue per page, whichever fixture opens it.
const catalogueCache = new Map<string, Promise<ClubCatalogueEntry[]>>()
const oppositionCache = new Map<string, Promise<OppositionOptions | null>>()

function loadCatalogue(rugbyCode: string, clubId: string) {
  const key = `${rugbyCode}|${clubId}`
  let p = catalogueCache.get(key)
  if (!p) {
    p = fixtureClubCatalogue(rugbyCode, clubId).catch(() => {
      catalogueCache.delete(key)
      return []
    })
    catalogueCache.set(key, p)
  }
  return p
}

function loadOpposition(fixtureId: string, directoryId: string, ourTeamId: string) {
  const key = `${fixtureId}|${directoryId}|${ourTeamId}`
  let p = oppositionCache.get(key)
  if (!p) {
    p = fixtureOppositionOptions(fixtureId, directoryId, ourTeamId).catch(() => {
      oppositionCache.delete(key)
      return null
    })
    oppositionCache.set(key, p)
  }
  return p
}

/** Loads a fixture into the editor. Shared by the sheet and the inline (Calendar) form. */
function useEditorLoad(fixtureId: string | null, version = 0) {
  const [loaded, setLoaded] = useState<{ id: string; version: number; result: OpenFixtureEditorResult } | null>(null)
  useEffect(() => {
    if (!fixtureId) return
    let live = true
    openFixtureEditor(fixtureId)
      .then((result) => {
        if (live) setLoaded({ id: fixtureId, version, result })
      })
      .catch(() => {
        if (live) setLoaded({ id: fixtureId, version, result: { ok: false, error: "The fixture could not be opened. Try again." } })
      })
    return () => {
      live = false
    }
  }, [fixtureId, version])
  // After a save, the form waits for the saved fixture rather than remounting on the old one.
  return loaded && loaded.id === fixtureId && loaded.version === version ? loaded.result : null
}

export function FixtureEditorSheet({
  fixtureId,
  onClose,
  detailHref,
}: {
  /** The fixture to edit; null keeps the sheet closed. */
  fixtureId: string | null
  onClose: () => void
  /** Where "Open Full Fixture Details" goes. */
  detailHref?: string
}) {
  const [version, setVersion] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const current = useEditorLoad(fixtureId, version)
  const [guard, setGuard] = useState<{ dirty: boolean; confirming: boolean }>({ dirty: false, confirming: false })

  function requestClose() {
    if (guard.dirty) setGuard({ dirty: true, confirming: true })
    else close(false)
  }

  function close(saved: boolean, notices: string[] = []) {
    setGuard({ dirty: false, confirming: false })
    // A save with something to say stays open on the fresh fixture, so it is read.
    if (saved && notices.length > 0) {
      setFlash(notices.join(" "))
      setVersion((n) => n + 1)
      return
    }
    setFlash(null)
    onClose()
  }

  return (
    <Sheet
      open={fixtureId !== null}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <SheetContent side="right" aria-modal="true" className="w-full gap-0 bg-white p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b border-ink/10 px-5 py-4 pr-12">
          <SheetTitle className="font-display text-xl text-ink">Edit Fixture</SheetTitle>
          <SheetDescription className="text-sm text-ink-muted">
            {current?.ok ? describe(current.model) : "Change the date, teams, venue or details. Only what you change is saved."}
          </SheetDescription>
        </SheetHeader>
        <EditorBody
          current={current}
          version={version}
          flash={flash}
          layout="sheet"
          detailHref={detailHref}
          confirmingClose={guard.confirming}
          onDirtyChange={(dirty) => setGuard((g) => (g.dirty === dirty ? g : { ...g, dirty }))}
          onKeepEditing={() => setGuard((g) => ({ ...g, confirming: false }))}
          onCancel={requestClose}
          onClose={close}
        />
      </SheetContent>
    </Sheet>
  )
}

/**
 * The same editor inside a panel that is already open -- Calendar's fixture
 * sheet -- so a person is never stacked two sheets deep.
 */
export function FixtureEditorInline({ fixtureId, onSaved, onCancel }: { fixtureId: string; onSaved: () => void; onCancel: () => void }) {
  const [version, setVersion] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const current = useEditorLoad(fixtureId, version)
  const [guard, setGuard] = useState<{ dirty: boolean; confirming: boolean }>({ dirty: false, confirming: false })
  return (
    <div className="flex flex-col">
      <h3 className="font-display text-lg text-ink">Edit Fixture</h3>
      <EditorBody
        current={current}
        version={version}
        flash={flash}
        layout="inline"
        confirmingClose={guard.confirming}
        onDirtyChange={(dirty) => setGuard((g) => (g.dirty === dirty ? g : { ...g, dirty }))}
        onKeepEditing={() => setGuard((g) => ({ ...g, confirming: false }))}
        onCancel={() => (guard.dirty ? setGuard({ dirty: true, confirming: true }) : onCancel())}
        onClose={(saved, notices = []) => {
          setGuard({ dirty: false, confirming: false })
          if (saved && notices.length > 0) {
            setFlash(notices.join(" "))
            setVersion((n) => n + 1)
          } else if (saved) onSaved()
          else onCancel()
        }}
      />
    </div>
  )
}

function EditorBody({
  current,
  version,
  flash,
  ...rest
}: {
  current: OpenFixtureEditorResult | null
  version: number
  flash: string | null
  layout: "sheet" | "inline"
  detailHref?: string
  confirmingClose: boolean
  onDirtyChange: (dirty: boolean) => void
  onKeepEditing: () => void
  onCancel: () => void
  onClose: (saved: boolean, notices?: string[]) => void
}) {
  if (!current) {
    return (
      <div className="flex items-center gap-2 px-5 py-6 text-sm text-ink-muted" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Opening fixture…
      </div>
    )
  }
  if (!current.ok) {
    return (
      <p role="alert" className="px-5 py-6 text-sm text-destructive-text">
        {current.error}
      </p>
    )
  }
  return (
    <>
      {flash && (
        <p role="status" className="mx-5 mt-3 rounded-md border border-pitch-600/30 bg-pitch-600/[0.06] px-3 py-2 text-sm text-ink">
          {flash}
        </p>
      )}
      <EditorForm key={`${current.model.fixtureId}:${version}`} model={current.model} initialOpposition={current.opposition} {...rest} />
    </>
  )
}

function describe(model: FixtureEditorModel): string {
  const team = model.options.ourTeams.find((t) => t.id === model.values.ourTeamId)?.label ?? model.ourTeam.label
  const opp = model.values.opponentClubName ?? model.values.rawOppositionText
  return `${team} v ${opp}`
}

// ---------------------------------------------------------------------------


function EditorForm({
  model,
  initialOpposition,
  layout,
  detailHref,
  confirmingClose,
  onDirtyChange,
  onKeepEditing,
  onCancel,
  onClose,
}: {
  model: FixtureEditorModel
  initialOpposition: OppositionOptions | null
  layout: "sheet" | "inline"
  detailHref?: string
  confirmingClose: boolean
  onDirtyChange: (dirty: boolean) => void
  onKeepEditing: () => void
  onCancel: () => void
  onClose: (saved: boolean, notices?: string[]) => void
}) {
  const router = useRouter()
  const v = model.values
  const f = model.fields

  const [kickoffDate, setKickoffDate] = useState(v.kickoffDate)
  const [kickoffTime, setKickoffTime] = useState(v.kickoffTime ?? "")
  const [meetTime, setMeetTime] = useState(v.meetTime ?? "")
  const [ourTeamId, setOurTeamId] = useState(v.ourTeamId)
  const [homeAway, setHomeAway] = useState(v.homeAway)
  const [club, setClub] = useState<ClubChoice>({
    directoryId: v.opponentDirectoryId,
    name: v.opponentClubName ?? v.rawOppositionText,
    tenantClubId: initialOpposition?.tenantClubId ?? null,
  })
  const [opposition, setOpposition] = useState<OppositionOptions | null>(initialOpposition)
  const [oppositionLoading, setOppositionLoading] = useState(false)
  const [where, setWhere] = useState<DefaultableState>({
    homeAway: v.homeAway === "Home" || v.homeAway === "Away" ? v.homeAway : null,
    oppositionClubKey: v.opponentDirectoryId,
    oppositionTeamId: v.opponentTeamId,
    venueId: v.venueId,
    venueText: v.venueAddress,
    pitchId: v.pitchId,
    // What is stored was somebody's choice: a default never replaces it.
    touched: { oppositionTeam: v.opponentTeamId !== null, venue: v.venueId !== null || Boolean(v.venueAddress), pitch: v.pitchId !== null },
  })
  const [gameType, setGameType] = useState(v.gameType ?? "Friendly")
  const [competitionEditionId, setCompetitionEditionId] = useState(v.competitionEditionId)
  const [status, setStatus] = useState(v.status)
  const [notes, setNotes] = useState(v.notes ?? "")
  // An Ovalball club's team is asked for, never set: the team to ask them to confirm.
  // A fixture already recorded against an Ovalball club with no team of theirs
  // opens with the one strong match suggested, as choosing the club would.
  const initialAsk =
    initialOpposition?.tenantClubId && v.opponentTeamId === null && !model.pendingTeamRequest ? (initialOpposition.suggestion.preselect?.id ?? null) : null
  const [askTeamId, setAskTeamId] = useState<string | null>(initialAsk)
  // A team the person chose is theirs, not a suggestion, even when it is the same team.
  const [askChosen, setAskChosen] = useState(false)
  const [homeScore, setHomeScore] = useState(v.homeScore?.toString() ?? "")
  const [awayScore, setAwayScore] = useState(v.awayScore?.toString() ?? "")

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const clubSeq = useRef(0)

  const storedOpponentClubId = initialOpposition?.tenantClubId ?? null
  const clubChanged = club.directoryId !== v.opponentDirectoryId || (club.directoryId === null && club.name !== v.rawOppositionText)
  const sideChanged = homeAway !== v.homeAway
  // A different Ovalball club is asked, not booked: its teams are shown for
  // context only, and saving records the club without binding a team.
  // Only a fixture already agreed with that club's team can move to another of their teams.
  const teamBindable = Boolean(club.tenantClubId) && club.tenantClubId === storedOpponentClubId && v.opponentTeamId !== null
  const differentOvalballClub = Boolean(club.tenantClubId) && !teamBindable

  const ourGrounds = model.options.ourGrounds
  const theirGrounds: ClubGrounds | null =
    !clubChanged && !sideChanged && v.homeAway === "Away" ? model.options.homeGrounds : (opposition?.grounds ?? null)
  // Away with no Ovalball home TEAM on the fixture (a club not on Ovalball, or an
  // Ovalball club still to be asked): no venue record can belong to the home
  // side, so their ground is kept as its name.
  const externalAway = homeAway === "Away" && !(teamBindable && where.oppositionTeamId)
  const venueGrounds: ClubGrounds | null = homeAway === "Home" ? ourGrounds : homeAway === "Away" && club.tenantClubId ? theirGrounds : null

  function applyVenueDefault(state: DefaultableState, grounds: { ours: ClubGrounds; theirs: ClubGrounds | null }, asText = false): DefaultableState {
    const d = defaultVenue(state.homeAway, grounds.ours, grounds.theirs)
    if (d.source === "none") return state
    if (asText && state.homeAway === "Away") {
      const name = d.venueId ? (grounds.theirs?.venues.find((x) => x.id === d.venueId)?.name ?? null) : d.venueText
      return applyDefaultableChange(state, { kind: "venue", id: null, text: name, byUser: false })
    }
    let next = applyDefaultableChange(state, { kind: "venue", id: d.venueId, text: d.venueText, byUser: false })
    if (d.pitchId) next = applyDefaultableChange(next, { kind: "pitch", id: d.pitchId, byUser: false })
    return next
  }

  function onHomeAway(value: FixtureEditorModel["values"]["homeAway"]) {
    setHomeAway(value)
    const side = value === "Home" || value === "Away" ? value : null
    setWhere((s) =>
      applyVenueDefault(applyDefaultableChange(s, { kind: "homeAway", value: side }), { ours: ourGrounds, theirs: opposition?.grounds ?? null }, !(teamBindable && s.oppositionTeamId)),
    )
  }

  async function onClubChosen(choice: ClubChoice) {
    setClub(choice)
    setErrors((e) => e.filter((x) => x.field !== "opposition"))
    setWhere((s) => applyDefaultableChange(s, { kind: "oppositionClub", key: choice.directoryId ?? `text:${choice.name}` }))
    setOpposition(null)
    if (!choice.directoryId) return
    const mine = ++clubSeq.current
    setOppositionLoading(true)
    const options = await loadOpposition(model.fixtureId, choice.directoryId, ourTeamId)
    if (mine !== clubSeq.current) return
    setOppositionLoading(false)
    setOpposition(options)
    const askable = Boolean(options?.tenantClubId) && !(options?.tenantClubId === storedOpponentClubId && v.opponentTeamId !== null)
    setAskTeamId(askable ? (options?.suggestion.preselect?.id ?? null) : null)
    setAskChosen(false)
    setWhere((s) => {
      let next = s
      const bindable = Boolean(options?.tenantClubId) && options?.tenantClubId === storedOpponentClubId && v.opponentTeamId !== null
      if (bindable && options?.suggestion.preselect) {
        next = applyDefaultableChange(next, { kind: "oppositionTeam", id: options.suggestion.preselect.id, byUser: false })
      }
      return applyVenueDefault(next, { ours: ourGrounds, theirs: options?.grounds ?? null }, !(bindable && next.oppositionTeamId))
    })
  }

  async function onOurTeam(id: string) {
    setOurTeamId(id)
    if (!club.directoryId || !club.tenantClubId) return
    const mine = ++clubSeq.current
    const options = await loadOpposition(model.fixtureId, club.directoryId, id)
    if (mine !== clubSeq.current || !options) return
    setOpposition(options)
    if (teamBindable && options.suggestion.preselect) {
      const pre = options.suggestion.preselect.id
      setWhere((s) => applyDefaultableChange(s, { kind: "oppositionTeam", id: pre, byUser: false }))
    }
  }

  // ----- the patch: every editable field's current value; the server diffs.
  const patch = useMemo<FixtureEditorPatch>(() => {
    const p: FixtureEditorPatch = {}
    if (f.schedule.editable) {
      p.kickoffDate = kickoffDate
      p.kickoffTime = kickoffTime || null
    }
    if (f.meetTime.editable) p.meetTime = meetTime || null
    if (f.ourTeam.editable) p.ourTeamId = ourTeamId
    if (f.homeAway.editable) p.homeAway = homeAway
    if (f.opposition.editable) {
      p.opposition = {
        teamId: teamBindable ? where.oppositionTeamId : null,
        directoryId: club.directoryId,
        rawText: club.name,
      }
    }
    if (f.venue.editable || (f.homeAway.editable && sideChanged)) {
      if (externalAway) p.venueText = where.venueText
      else {
        p.venueId = where.venueId
        p.pitchId = where.pitchId
      }
    }
    if (f.details.editable) {
      p.gameType = gameType
      p.status = status
      p.notes = notes
    }
    if (f.competition.editable) p.competitionEditionId = competitionApplies(gameType) ? competitionEditionId : null
    if (f.opposition.editable && differentOvalballClub && askTeamId && !model.pendingTeamRequest) p.askTeamId = askTeamId
    if (f.result.editable && homeScore !== "" && awayScore !== "") p.result = { home: Number(homeScore), away: Number(awayScore) }
    return p
  }, [f, kickoffDate, kickoffTime, meetTime, ourTeamId, homeAway, teamBindable, where, club, externalAway, sideChanged, gameType, status, notes, competitionEditionId, differentOvalballClub, askTeamId, model.pendingTeamRequest, homeScore, awayScore])

  const fieldsChanged =
    kickoffDate !== v.kickoffDate ||
    (kickoffTime || null) !== v.kickoffTime ||
    (meetTime || null) !== v.meetTime ||
    ourTeamId !== v.ourTeamId ||
    sideChanged ||
    clubChanged ||
    (teamBindable && where.oppositionTeamId !== v.opponentTeamId) ||
    where.venueId !== v.venueId ||
    where.pitchId !== v.pitchId ||
    (externalAway && (where.venueText ?? "") !== (v.venueAddress ?? "")) ||
    gameType !== (v.gameType ?? "Friendly") ||
    (competitionApplies(gameType) ? competitionEditionId : null) !== v.competitionEditionId ||
    status !== v.status ||
    notes.trim() !== (v.notes ?? "").trim() ||
    (homeScore !== (v.homeScore?.toString() ?? "") && homeScore !== "" && awayScore !== "") ||
    (awayScore !== (v.awayScore?.toString() ?? "") && homeScore !== "" && awayScore !== "")
  const dirty = fieldsChanged || (differentOvalballClub && askTeamId !== null && !model.pendingTeamRequest)

  // Layout effect, not effect: the close guard must know the sheet is dirty
  // before the very next key press can reach it.
  // Closing with only the untouched suggestion is not losing anybody's work,
  // so the close guard does not ask; Save still offers to send it.
  const askPending = differentOvalballClub && askTeamId !== null && !model.pendingTeamRequest
  const onlyTheSuggestion = askPending && !askChosen && askTeamId === initialAsk && !clubChanged
  const guardDirty = dirty && !(onlyTheSuggestion && !fieldsChanged)
  useLayoutEffect(() => {
    onDirtyChange(guardDirty)
  }, [guardDirty, onDirtyChange])

  async function save() {
    setSaving(true)
    setErrors([])
    setNotices([])
    const result = await saveFixture(model.fixtureId, patch).catch(() => ({
      ok: false,
      saved: [] as string[],
      errors: [{ field: "fixture", message: "The fixture could not be saved. Try again." }],
      notices: [] as string[],
    }))
    setSaving(false)
    if (result.saved.length > 0) router.refresh()
    if (result.ok) {
      oppositionCache.clear()
      onDirtyChange(false)
      onClose(true, result.notices)
      return
    }
    setErrors(result.errors)
    setNotices(result.notices)
  }

  const errorFor = (...fields: string[]) => errors.filter((e) => fields.includes(e.field)).map((e) => e.message)
  const suggested = (field: "team" | "venue" | "pitch") => {
    if (field === "team") return !where.touched.oppositionTeam && where.oppositionTeamId !== null && where.oppositionTeamId !== v.opponentTeamId
    if (field === "venue") return !where.touched.venue && (where.venueId !== null || Boolean(where.venueText)) && (where.venueId !== v.venueId || where.venueText !== v.venueAddress)
    return !where.touched.pitch && where.pitchId !== null && where.pitchId !== v.pitchId
  }

  const pitches = (venueGrounds?.pitches ?? []).filter((p) => p.venueId === where.venueId)
  const typeLocked = !f.details.editable

  return (
    <>
      <div className={layout === "sheet" ? "flex-1 overflow-y-auto px-5 pb-6" : "pb-2"}>
        {model.competitionName && (
          <p className="mt-4 rounded-md border border-sky-600/25 bg-sky-50 px-3 py-2 text-sm text-ink">
            Scheduled by {model.competitionName}. The organiser sets its date, kick-off, teams and opposition.
          </p>
        )}
        {model.pendingKickoff && (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A new date of {formatDate(model.pendingKickoff.date)}
            {model.pendingKickoff.time ? ` at ${model.pendingKickoff.time}` : ""} is waiting for the other club to agree.
          </p>
        )}

        <Section title="When">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date" authority={f.schedule} className="col-span-2 sm:col-span-1" errors={errorFor("schedule")}>
              {(id) => <input id={id} type="date" required value={kickoffDate} disabled={!f.schedule.editable} onChange={(e) => setKickoffDate(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Kick-Off" authority={f.schedule} hideReason>
              {(id) => <input id={id} type="time" value={kickoffTime} disabled={!f.schedule.editable} onChange={(e) => setKickoffTime(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Meet Time" authority={f.meetTime} errors={errorFor("meetTime")}>
              {(id) => <input id={id} type="time" value={meetTime} disabled={!f.meetTime.editable} onChange={(e) => setMeetTime(e.target.value)} className={inputClass} />}
            </Field>
          </div>
        </Section>

        <Section title="Who">
          <Field label="Our Team" authority={f.ourTeam} errors={errorFor("ourTeam")}>
            {(id) => (
              <select id={id} value={ourTeamId} disabled={!f.ourTeam.editable} onChange={(e) => onOurTeam(e.target.value)} className={inputClass}>
                {model.options.ourTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <fieldset className="mt-3" disabled={!f.homeAway.editable}>
            <legend className={labelClass}>
              Home or Away
              {!f.homeAway.editable && <Lock className="ml-1 inline size-3 text-ink-muted" aria-hidden="true" />}
            </legend>
            <div className="mt-1 inline-flex rounded-md border border-ink/15 p-0.5" role="radiogroup" aria-label="Home or Away">
              {(["Home", "Away", "TBD"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={homeAway === option}
                  disabled={!f.homeAway.editable}
                  onClick={() => onHomeAway(option)}
                  className={cn(
                    "h-8 min-w-16 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-not-allowed",
                    homeAway === option ? "bg-forest-800 font-medium text-white" : "text-ink hover:bg-ink/[0.05]",
                  )}
                >
                  {option === "TBD" ? "To Be Decided" : option}
                </button>
              ))}
            </div>
            {!f.homeAway.editable && f.homeAway.reason && <p className={reasonClass}>{f.homeAway.reason}</p>}
          </fieldset>

          <div className="mt-3">
            <ClubCombobox
              label="Opposition Club"
              value={club}
              onChoose={(choice) => choice && onClubChosen(choice)}
              loadCatalogue={() => loadCatalogue(model.rugbyCode, model.owningClubId)}
              disabled={!f.opposition.editable}
              lockedReason={f.opposition.reason}
              allowFreeText
              describe={club.tenantClubId ? "On Ovalball" : null}
              errors={errorFor("opposition")}
            />
          </div>

          {club.directoryId && (
            <div className="mt-3">
              {oppositionLoading ? (
                <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Finding {club.name}&rsquo;s teams…
                </p>
              ) : differentOvalballClub && model.pendingTeamRequest && !clubChanged ? (
                <p className="rounded-md border border-ink/10 bg-chalk px-3 py-2 text-sm text-ink">
                  <span aria-hidden="true">○ </span>
                  Waiting for {club.name} to confirm {model.pendingTeamRequest.teamLabel}. The fixture updates when they accept.
                </p>
              ) : differentOvalballClub ? (
                <div className="rounded-md border border-ink/10 bg-chalk px-3 py-2">
                  <Field label="Opposition Team" authority={f.opposition} hideReason badge={!askChosen && askTeamId && askTeamId === opposition?.suggestion.preselect?.id ? "Suggested" : undefined}>
                    {(id) => (
                      <select id={id} value={askTeamId ?? ""} disabled={!f.opposition.editable || !opposition} onChange={(e) => {
                        setAskTeamId(e.target.value || null)
                        setAskChosen(true)
                      }} className={inputClass}>
                        <option value="">Choose their team</option>
                        {(opposition?.suggestion.ranked ?? []).map((r) => (
                          <option key={r.team.id} value={r.team.id}>
                            {r.team.label}
                            {r.strength === "strong" ? " (best match)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <p className={reasonClass}>
                    {club.name} is on Ovalball, so they are asked rather than booked. Saving asks them to confirm this team; the fixture updates when they accept.
                  </p>
                </div>
              ) : teamBindable && opposition ? (
                <Field label="Opposition Team" authority={f.opposition} hideReason badge={suggested("team") ? "Suggested" : undefined}>
                  {(id) => (
                    <select
                      id={id}
                      value={where.oppositionTeamId ?? ""}
                      disabled={!f.opposition.editable}
                      onChange={(e) => setWhere((s) => applyDefaultableChange(s, { kind: "oppositionTeam", id: e.target.value || null, byUser: true }))}
                      className={inputClass}
                    >
                      <option value="">Team not set</option>
                      {opposition.suggestion.ranked.map((r) => (
                        <option key={r.team.id} value={r.team.id}>
                          {r.team.label}
                          {r.strength === "strong" ? " (best match)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : null}
              {teamBindable && opposition && opposition.suggestion.ranked.length === 0 && (
                <p className={reasonClass}>{club.name} has no team that can play this one. The club is recorded without a team.</p>
              )}
            </div>
          )}
        </Section>

        <Section title="Where">
          {homeAway !== "Home" && homeAway !== "Away" ? (
            <p className="text-sm text-ink-muted">Choose Home or Away first. The venue belongs to the home club.</p>
          ) : externalAway ? (
            <Field label="Ground" authority={f.venue.editable || (sideChanged && f.homeAway.editable) ? { editable: true, reason: null } : f.venue} errors={errorFor("schedule", "details")} badge={suggested("venue") ? "Suggested" : undefined}>
              {(id) => (
                <input
                  id={id}
                  value={where.venueText ?? ""}
                  placeholder={`${club.name || "Their"} ground`}
                  disabled={!(f.venue.editable || (sideChanged && f.homeAway.editable))}
                  onChange={(e) => setWhere((s) => applyDefaultableChange(s, { kind: "venue", id: null, text: e.target.value, byUser: true }))}
                  className={inputClass}
                />
              )}
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Venue" authority={f.venue.editable || sideChanged ? { editable: true, reason: null } : f.venue} errors={errorFor("schedule")} badge={suggested("venue") ? "Suggested" : undefined}>
                {(id) => (
                  <select
                    id={id}
                    value={where.venueId ?? ""}
                    disabled={!(f.venue.editable || sideChanged) || !venueGrounds}
                    onChange={(e) => setWhere((s) => applyDefaultableChange(s, { kind: "venue", id: e.target.value || null, byUser: true }))}
                    className={inputClass}
                  >
                    <option value="">{venueGrounds && venueGrounds.venues.length === 0 ? "No grounds recorded" : "Not set"}</option>
                    {(venueGrounds?.venues ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Pitch" authority={f.venue.editable || sideChanged ? { editable: true, reason: null } : f.venue} hideReason badge={suggested("pitch") ? "Suggested" : undefined}>
                {(id) => (
                  <select
                    id={id}
                    value={where.pitchId ?? ""}
                    disabled={!(f.venue.editable || sideChanged) || !where.venueId || pitches.length === 0}
                    onChange={(e) => setWhere((s) => applyDefaultableChange(s, { kind: "pitch", id: e.target.value || null, byUser: true }))}
                    className={inputClass}
                  >
                    <option value="">{where.venueId && pitches.length === 0 ? "No pitches recorded" : "Not set"}</option>
                    {pitches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}
        </Section>

        {(f.result.editable || v.homeScore !== null) && (
          <Section title="Result">
            <div className="grid grid-cols-2 gap-3">
              {(["home", "away"] as const).map((side) => {
                const ours = (side === "home") === (v.homeAway !== "Away")
                const name = ours ? (model.options.ourTeams.find((t) => t.id === v.ourTeamId)?.label ?? model.ourTeam.label) : v.opponentClubName ?? v.rawOppositionText
                return (
                  <Field key={side} label={side === "home" ? "Home Score" : "Away Score"} authority={f.result} hideReason={side === "away"} errors={side === "home" ? errorFor("result") : []}>
                    {(id) => (
                      <>
                        <input
                          id={id}
                          inputMode="numeric"
                          value={side === "home" ? homeScore : awayScore}
                          disabled={!f.result.editable}
                          onChange={(e) => (side === "home" ? setHomeScore : setAwayScore)(e.target.value.replace(/\D/g, "").slice(0, 3))}
                          className={cn(inputClass, "tabular-nums")}
                        />
                        <p className="mt-1 truncate text-xs text-ink-muted">{name}</p>
                      </>
                    )}
                  </Field>
                )
              })}
            </div>
          </Section>
        )}

        <Section title="What">
          <fieldset disabled={typeLocked}>
            <legend className={labelClass}>
              Fixture Type
              {typeLocked && <Lock className="ml-1 inline size-3 text-ink-muted" aria-hidden="true" />}
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Fixture Type">
              {FIXTURE_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={gameType === o.value}
                  disabled={typeLocked}
                  onClick={() => setGameType(o.value)}
                  className={cn(
                    "h-8 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-not-allowed",
                    gameType === o.value ? "border-forest-800 bg-forest-800 font-medium text-white" : "border-ink/15 text-ink hover:bg-ink/[0.04]",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          {competitionApplies(gameType) && (
            <div className="mt-3">
              <Field label="Competition" authority={f.competition} errors={errorFor("competition")}>
                {(id) => (
                  <select
                    id={id}
                    value={competitionEditionId ?? ""}
                    disabled={!f.competition.editable}
                    onChange={(e) => setCompetitionEditionId(e.target.value || null)}
                    className={inputClass}
                  >
                    <option value="">Not set</option>
                    {model.options.competitions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}

          <div className="mt-3">
            <Field label="Status" authority={f.details} hideReason errors={errorFor("details")}>
              {(id) => (
                <select id={id} value={status} disabled={!f.details.editable || v.status === "Cancelled"} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                  {!SETTABLE_STATUSES.includes(v.status as (typeof SETTABLE_STATUSES)[number]) && (
                    <option value={v.status} disabled>
                      {v.status}
                    </option>
                  )}
                  {SETTABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {v.status === "Cancelled" && <p className={reasonClass}>This fixture is cancelled. Restore it from fixture details.</p>}
          </div>

          <div className="mt-3">
            <Field label="Notes" authority={f.details}>
              {(id) => (
                <textarea id={id} rows={3} value={notes} disabled={!f.details.editable} onChange={(e) => setNotes(e.target.value)} className={cn(inputClass, "h-auto py-2")} />
              )}
            </Field>
          </div>
        </Section>

        {errorFor("fixture").map((m) => (
          <p key={m} role="alert" className="mt-4 text-sm text-destructive-text">
            {m}
          </p>
        ))}
        {notices.map((n) => (
          <p key={n} role="status" className="mt-4 text-sm text-ink">
            {n}
          </p>
        ))}
      </div>

      <div className={layout === "sheet" ? "border-t border-ink/10 bg-white px-5 py-3" : "sticky bottom-0 border-t border-ink/10 bg-white py-3"}>
        {confirmingClose ? (
          <div className="flex flex-wrap items-center justify-between gap-2" role="alertdialog" aria-label="Unsaved changes">
            <p className="text-sm text-ink">You have unsaved changes.</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="h-9" onClick={onKeepEditing} autoFocus>
                Keep Editing
              </Button>
              <Button type="button" variant="destructive" className="h-9" onClick={() => onClose(false)}>
                Discard Changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button type="button" className="h-9" disabled={!dirty || saving} onClick={save}>
                {saving ? "Saving…" : "Save Changes"}
              </Button>
              <Button type="button" variant="ghost" className="h-9 text-ink-muted" disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
              {errors.length > 0 && <span className="text-xs text-destructive-text">Some changes were not saved.</span>}
            </div>
            {detailHref && (
              <Link href={detailHref} className="text-sm text-ink-muted underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                Open Full Fixture Details
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

const inputClass =
  "mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40 disabled:cursor-not-allowed disabled:bg-ink/[0.03] disabled:text-ink-muted"
const labelClass = "text-sm font-medium text-ink"
const reasonClass = "mt-1 text-xs text-ink-muted"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-ink/8 py-4 last:border-0">
      <h3 className="mb-2 text-xs font-semibold text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label,
  authority,
  children,
  className,
  hideReason = false,
  errors = [],
  badge,
}: {
  label: string
  authority: FieldAuthority
  children: (id: string) => React.ReactNode
  className?: string
  hideReason?: boolean
  errors?: string[]
  badge?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className={cn(labelClass, "flex items-center gap-1.5")}>
        {label}
        {!authority.editable && <Lock className="size-3 text-ink-muted" aria-label="Locked" />}
        {badge && <span className="rounded bg-pitch-600/10 px-1.5 text-[11px] font-medium text-forest-800">{badge}</span>}
      </label>
      {children(id)}
      {!authority.editable && authority.reason && !hideReason && <p className={reasonClass}>{authority.reason}</p>}
      {errors.map((m) => (
        <p key={m} role="alert" className="mt-1 text-xs text-destructive-text">
          {m}
        </p>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
