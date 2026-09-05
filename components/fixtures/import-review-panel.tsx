"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeAwayBadge } from "@/app/(app)/admin/fixtures/home-away-badge"
import { OpponentPicker } from "@/app/(app)/calendar/opponent-picker"
import { type TeamSearchResult } from "@/app/(app)/calendar/fixture-actions"

export interface ExistingFixtureSummary {
  teamName: string
  opponentText: string
  date: string
  time: string | null
  gameType: string | null
  status: string
}

export interface ImportRow {
  id: string
  rowNumber: number
  raw: Record<string, string>
  status: string
  errors: string[]
  homeTeamResolved: boolean
  rawOppositionText: string | null
  normalizedGameType: string | null
  fixtureDate: string | null
  kickoffTime: string | null
  conflictingFixtureId: string | null
  conflictDecision: string | null
  publishedFixtureId: string | null
}

export interface ImportTeamOption {
  id: string
  label: string
}

export interface ImportPitchOption {
  id: string
  displayName: string
}

export interface CompetitionEditionOption {
  id: string
  competitionName: string
  seasonName: string
}

const FIXTURE_STATUS_OPTIONS = ["Planned", "Booked", "To Be Determined", "Cancelled", "Completed"] as const

export interface RowCorrectionInput {
  homeTeamId?: string | null
  awayTeamId?: string | null
  awayDirectoryId?: string | null
  awayRawText?: string
  fixtureDate?: string | null
  kickoffTime?: string | null
  competitionEditionId?: string | null
  pitchId?: string | null
  fixtureStatus?: string | null
  homeScore?: number | null
  awayScore?: number | null
}

export interface PublishResult {
  ok: true
  published: number
  excluded: number
  failed: { rowId: string; error: string }[]
}

export interface ResolveConflictInput {
  rowId: string
  decision: "replace_and_notify" | "override_no_notify" | "keep_existing" | "keep_both"
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-mint-100 text-forest-800" },
  update: { label: "Update existing", className: "bg-pitch-600/10 text-forest-800" },
  needs_review: { label: "Needs review", className: "bg-amber-500/12 text-amber-700" },
  conflict: { label: "Conflict", className: "bg-destructive/10 text-destructive" },
  invalid: { label: "Invalid", className: "bg-destructive/10 text-destructive" },
  excluded: { label: "Excluded", className: "bg-ink/8 text-ink/45" },
  published: { label: "Published", className: "bg-forest-950/8 text-forest-950" },
}

function formatDate(iso: string | null): string {
  if (!iso) return "No date"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * The ONE staged-import review/authorise UI, shared by the Site Admin
 * global import and every club-scoped import -- the same Upload -> Parse
 * -> Validate -> Resolve -> Review/Edit -> Authorise -> Commit workflow,
 * never a second one. Per-caller behaviour (which RPCs actually run) is
 * injected as props, never duplicated here.
 */
export function ImportReviewPanel({
  batchId,
  batchState,
  rows,
  counts,
  existingById,
  resolveRowConflict,
  excludeImportRow,
  publishBatch,
  correctRow,
  clubTeams,
  clubPitches,
  listCompetitionEditions,
}: {
  batchId: string
  batchState: string
  rows: ImportRow[]
  counts: Record<string, number>
  existingById: Map<string, ExistingFixtureSummary>
  resolveRowConflict: (input: ResolveConflictInput) => Promise<{ ok: true } | { ok: false; error: string }>
  excludeImportRow: (rowId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  publishBatch: (batchId: string) => Promise<PublishResult | { ok: false; error: string }>
  /** Reconciliation complaint 26 -- when supplied, needs_review/invalid rows get a real correction panel instead of only Exclude. Omitted keeps the previous exclude-only behaviour for any caller not yet wired up. */
  correctRow?: (rowId: string, correction: RowCorrectionInput) => Promise<{ ok: true } | { ok: false; error: string }>
  /** The importing club's own active roster (fullTeamLabel-formatted) for the Home Team correction picker -- omitted for the Site Admin global import, where home team resolution is unrestricted across every club and a single picker doesn't apply. */
  clubTeams?: ImportTeamOption[]
  /** Reconciliation complaint 26 remainder -- the importing club's own active pitches for the Pitch/Venue correction picker. Same scope as clubTeams: omitted for the Site Admin global import (no single club to scope pitches to). */
  clubPitches?: ImportPitchOption[]
  /** Reconciliation complaint 26 remainder -- competitions/competition_editions are readable to any authenticated user regardless of club, so this is offered in both the club-scoped and Site Admin global import. Fetched per-row from the row's own rugby_code (from the CSV or the resolved home team). */
  listCompetitionEditions?: (rugbyCode: string) => Promise<CompetitionEditionOption[]>
}) {
  const router = useRouter()
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const publishableCount = rows.filter((r) => r.status === "ready" || r.status === "update" || (r.status === "conflict" && r.conflictDecision)).length
  const alreadyDone = batchState === "completed" || batchState === "completed_with_exclusions"

  async function handlePublish() {
    setPublishing(true)
    setError(null)
    const result = await publishBatch(batchId)
    setPublishing(false)
    if ("ok" in result && result.ok && "published" in result) {
      setPublishResult(result)
      router.refresh()
    } else if (!result.ok) {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryStat label="Ready" value={counts.ready} />
        <SummaryStat label="Needs review" value={counts.needsReview} />
        <SummaryStat label="Conflicts" value={counts.conflict} />
        <SummaryStat label="Invalid" value={counts.invalid} />
        <SummaryStat label="Excluded" value={counts.excluded} />
        <SummaryStat label="Published" value={counts.published} />
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <RowCard
            key={row.id}
            row={row}
            existing={row.conflictingFixtureId ? existingById.get(row.conflictingFixtureId) : undefined}
            resolveRowConflict={resolveRowConflict}
            excludeImportRow={excludeImportRow}
            correctRow={correctRow}
            clubTeams={clubTeams}
            clubPitches={clubPitches}
            listCompetitionEditions={listCompetitionEditions}
          />
        ))}
      </div>

      {publishResult && (
        <div className="rounded-lg border border-forest-950/15 bg-forest-950/[0.03] p-4">
          <p className="text-sm font-medium text-ink">
            Published {publishResult.published}, excluded {publishResult.excluded}
            {publishResult.failed.length > 0 ? `, ${publishResult.failed.length} failed` : ""}.
          </p>
          {publishResult.failed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {publishResult.failed.map((f) => (
                <li key={f.rowId} className="text-xs text-destructive">
                  Row error: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {!alreadyDone && (
        <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
          <Button type="button" className="h-10" disabled={publishing || publishableCount === 0} onClick={handlePublish}>
            {publishing ? "Publishing…" : `Publish ${publishableCount} fixture${publishableCount === 1 ? "" : "s"}`}
          </Button>
          {publishableCount === 0 && <span className="text-sm text-ink/45">Resolve needs-review/conflict rows first, or exclude them.</span>}
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-3">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
    </div>
  )
}

function RowCard({
  row,
  existing,
  resolveRowConflict,
  excludeImportRow,
  correctRow,
  clubTeams,
  clubPitches,
  listCompetitionEditions,
}: {
  row: ImportRow
  existing?: ExistingFixtureSummary
  resolveRowConflict: (input: ResolveConflictInput) => Promise<{ ok: true } | { ok: false; error: string }>
  excludeImportRow: (rowId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  correctRow?: (rowId: string, correction: RowCorrectionInput) => Promise<{ ok: true } | { ok: false; error: string }>
  clubTeams?: ImportTeamOption[]
  clubPitches?: ImportPitchOption[]
  listCompetitionEditions?: (rugbyCode: string) => Promise<CompetitionEditionOption[]>
}) {
  const router = useRouter()
  const [decision, setDecision] = useState(row.conflictDecision)
  const [excluded, setExcluded] = useState(row.status === "excluded")
  const [correcting, setCorrecting] = useState(false)
  const [working, setWorking] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const statusMeta = STATUS_LABEL[excluded ? "excluded" : row.status] ?? { label: row.status, className: "bg-ink/8 text-ink/50" }

  async function handleDecision(next: "replace_and_notify" | "override_no_notify" | "keep_existing" | "keep_both") {
    setWorking(true)
    await resolveRowConflict({ rowId: row.id, decision: next })
    setWorking(false)
    setDecision(next)
  }

  async function handleExclude() {
    setWorking(true)
    await excludeImportRow(row.id)
    setWorking(false)
    setExcluded(true)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink">
            Row {row.rowNumber}: {row.raw.home_club} {row.raw.home_team} vs {row.rawOppositionText}
          </p>
          <HomeAwayBadge value="Home" />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.className}`}>{statusMeta.label}</span>
      </div>
      <p className="mt-1 text-xs text-ink/50">
        {formatDate(row.fixtureDate)}
        {row.kickoffTime ? ` · ${row.kickoffTime}` : ""}
        {row.normalizedGameType ? ` · ${row.normalizedGameType}` : ""}
      </p>

      {row.errors.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {row.errors.map((e, i) => (
            <li key={i} className="text-xs text-destructive">
              {e}
            </li>
          ))}
        </ul>
      )}

      {row.status === "conflict" && existing && !excluded && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Existing fixture</p>
            <p className="mt-1 text-sm text-ink">
              {existing.teamName} vs {existing.opponentText}
            </p>
            <p className="text-xs text-ink/50">
              {formatDate(existing.date)}
              {existing.time ? ` · ${existing.time.slice(0, 5)}` : ""} &middot; {existing.gameType ?? "No type"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Imported fixture</p>
            <p className="mt-1 text-sm text-ink">
              {row.raw.home_team} vs {row.rawOppositionText}
            </p>
            <p className="text-xs text-ink/50">
              {formatDate(row.fixtureDate)}
              {row.kickoffTime ? ` · ${row.kickoffTime}` : ""} &middot; {row.normalizedGameType ?? "No type"}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-ink/60">Choose what happens:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <DecisionButton active={decision === "replace_and_notify"} onClick={() => handleDecision("replace_and_notify")} disabled={working}>
                Cancel existing + notify
              </DecisionButton>
              <DecisionButton active={decision === "override_no_notify"} onClick={() => handleDecision("override_no_notify")} disabled={working}>
                Cancel existing, no notification
              </DecisionButton>
              <DecisionButton active={decision === "keep_existing"} onClick={() => handleDecision("keep_existing")} disabled={working}>
                Keep existing, skip this row
              </DecisionButton>
              <DecisionButton active={decision === "keep_both"} onClick={() => handleDecision("keep_both")} disabled={working}>
                Keep both
              </DecisionButton>
            </div>
          </div>
        </div>
      )}

      {(row.status === "needs_review" || row.status === "invalid") && !excluded && (
        <div className="mt-2 flex items-center gap-2">
          {correctRow && (
            <Button type="button" variant="outline" className="h-8" disabled={working} onClick={() => setCorrecting((v) => !v)}>
              {correcting ? "Cancel correction" : "Correct this row"}
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-8 text-ink/50" disabled={working} onClick={handleExclude}>
            Exclude this row
          </Button>
        </div>
      )}

      {correcting && correctRow && (
        <RowCorrectionForm
          row={row}
          clubTeams={clubTeams}
          clubPitches={clubPitches}
          listCompetitionEditions={listCompetitionEditions}
          correctRow={correctRow}
          onError={setCorrectionError}
          onSaved={() => {
            setCorrecting(false)
            router.refresh()
          }}
        />
      )}
      {correctionError && <p className="mt-2 text-xs text-destructive">{correctionError}</p>}
    </div>
  )
}

/**
 * Reconciliation complaint 26 -- corrects a staged row via real canonical
 * pickers: OpponentPicker (already club-safe, the SAME Club
 * Directory/Team Directory resolution the Calendar's own Create Fixture
 * dialog uses) for Away Club/Team, a plain select over the importing
 * club's own active roster for Home Team, and Date/Kickoff inputs.
 */
function RowCorrectionForm({
  row,
  clubTeams,
  clubPitches,
  listCompetitionEditions,
  correctRow,
  onError,
  onSaved,
}: {
  row: ImportRow
  clubTeams?: ImportTeamOption[]
  clubPitches?: ImportPitchOption[]
  listCompetitionEditions?: (rugbyCode: string) => Promise<CompetitionEditionOption[]>
  correctRow: (rowId: string, correction: RowCorrectionInput) => Promise<{ ok: true } | { ok: false; error: string }>
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const [homeTeamId, setHomeTeamId] = useState<string | null>(null)
  const [opponentTeam, setOpponentTeam] = useState<TeamSearchResult | null>(null)
  const [opponentDirectoryId, setOpponentDirectoryId] = useState<string | null>(null)
  const [rawText, setRawText] = useState(row.rawOppositionText ?? "")
  const [date, setDate] = useState(row.fixtureDate ?? "")
  const [kickoff, setKickoff] = useState(row.kickoffTime?.slice(0, 5) ?? "")
  const [competitionEditionId, setCompetitionEditionId] = useState<string | null>(null)
  const [competitionOptions, setCompetitionOptions] = useState<CompetitionEditionOption[] | null>(null)
  const [pitchId, setPitchId] = useState<string | null>(null)
  const [fixtureStatus, setFixtureStatus] = useState<string | null>(null)
  const [homeScore, setHomeScore] = useState(row.raw.home_score ?? "")
  const [awayScore, setAwayScore] = useState(row.raw.away_score ?? "")
  const [saving, setSaving] = useState(false)

  const rugbyCode = (row.raw.rugby_code || "").toLowerCase()

  async function handleLoadCompetitions() {
    if (!listCompetitionEditions || !rugbyCode || competitionOptions) return
    setCompetitionOptions(await listCompetitionEditions(rugbyCode))
  }

  async function handleSave() {
    setSaving(true)
    onError(null)
    const trimmedHome = homeScore.toString().trim()
    const trimmedAway = awayScore.toString().trim()
    if ((trimmedHome === "") !== (trimmedAway === "")) {
      setSaving(false)
      onError("Home and away score must both be set, or both left blank.")
      return
    }
    const result = await correctRow(row.id, {
      homeTeamId: homeTeamId ?? undefined,
      awayTeamId: opponentTeam?.teamId ?? (opponentDirectoryId ? null : undefined),
      awayDirectoryId: opponentDirectoryId ?? undefined,
      awayRawText: opponentTeam ? opponentTeam.clubName : rawText || undefined,
      fixtureDate: date || undefined,
      kickoffTime: kickoff || undefined,
      competitionEditionId: competitionEditionId ?? undefined,
      pitchId: pitchId ?? undefined,
      fixtureStatus: fixtureStatus ?? undefined,
      homeScore: trimmedHome === "" ? undefined : Number(trimmedHome),
      awayScore: trimmedAway === "" ? undefined : Number(trimmedAway),
    })
    setSaving(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onSaved()
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-ink/10 bg-ink/[0.015] p-3">
      {clubTeams && clubTeams.length > 0 && (
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-home-${row.id}`}>
            Home team
          </label>
          <select
            id={`correct-home-${row.id}`}
            value={homeTeamId ?? ""}
            onChange={(e) => setHomeTeamId(e.target.value || null)}
            className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
          >
            <option value="">Keep as staged</option>
            {clubTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <OpponentPicker
        owningTeamId={homeTeamId}
        selectedTeam={opponentTeam}
        onSelectTeam={setOpponentTeam}
        selectedDirectoryId={opponentDirectoryId}
        onSelectDirectory={setOpponentDirectoryId}
        rawText={rawText}
        onRawTextChange={setRawText}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-date-${row.id}`}>
            Date
          </label>
          <Input id={`correct-date-${row.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9 border-ink/15 bg-white" />
        </div>
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-kickoff-${row.id}`}>
            Kickoff
          </label>
          <Input id={`correct-kickoff-${row.id}`} type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} className="mt-1 h-9 border-ink/15 bg-white" />
        </div>
      </div>

      <p className="text-xs text-ink/40">
        Rugby code{rugbyCode ? ` (${rugbyCode})` : ""} and season are derived from the resolved home team and date &mdash; not set here.
      </p>

      {listCompetitionEditions && (
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-competition-${row.id}`}>
            Competition
          </label>
          <select
            id={`correct-competition-${row.id}`}
            value={competitionEditionId ?? ""}
            onFocus={handleLoadCompetitions}
            onChange={(e) => setCompetitionEditionId(e.target.value || null)}
            disabled={!rugbyCode}
            className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600 disabled:opacity-50"
          >
            <option value="">Keep as staged</option>
            {(competitionOptions ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.competitionName} &middot; {c.seasonName}
              </option>
            ))}
          </select>
          {!rugbyCode && <p className="mt-1 text-xs text-ink/40">Add a rugby_code column to the CSV to pick a competition here.</p>}
        </div>
      )}

      {clubPitches && clubPitches.length > 0 && (
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-pitch-${row.id}`}>
            Pitch / venue
          </label>
          <select
            id={`correct-pitch-${row.id}`}
            value={pitchId ?? ""}
            onChange={(e) => setPitchId(e.target.value || null)}
            className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
          >
            <option value="">Keep as staged</option>
            {clubPitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-status-${row.id}`}>
            Status
          </label>
          <select
            id={`correct-status-${row.id}`}
            value={fixtureStatus ?? ""}
            onChange={(e) => setFixtureStatus(e.target.value || null)}
            className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
          >
            <option value="">Keep as staged</option>
            {FIXTURE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-home-score-${row.id}`}>
            Home score
          </label>
          <Input
            id={`correct-home-score-${row.id}`}
            type="number"
            min={0}
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            className="mt-1 h-9 border-ink/15 bg-white"
          />
        </div>
        <div>
          <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor={`correct-away-score-${row.id}`}>
            Away score
          </label>
          <Input
            id={`correct-away-score-${row.id}`}
            type="number"
            min={0}
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            className="mt-1 h-9 border-ink/15 bg-white"
          />
        </div>
      </div>
      <p className="text-xs text-ink/40">Set both scores for a historical/backfilled result, or leave both blank.</p>

      <Button type="button" size="sm" className="h-9 w-fit" disabled={saving} onClick={handleSave}>
        {saving ? "Saving…" : "Save correction"}
      </Button>
    </div>
  )
}

function DecisionButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
        active ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70 hover:border-ink/30"
      }`}
    >
      {children}
    </button>
  )
}
