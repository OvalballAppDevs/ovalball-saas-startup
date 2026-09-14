"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import type { CompetitionFormat } from "@/lib/competitions/workspace-types"
import { cn } from "@/lib/utils"

import { createCompetitionFromDetails, saveCompetitionDetails, type CompetitionDetailsInput } from "../../actions"

const FORMATS: { value: CompetitionFormat; label: string; hint: string }[] = [
  { value: "league", label: "League", hint: "Every team plays in groups; the table decides." },
  { value: "knockout", label: "Knockout", hint: "A draw of ties; the winner goes through." },
  { value: "league_knockout", label: "League + Knockout", hint: "Groups first, then the top teams play a knockout." },
]

const field = "mt-1 h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40 disabled:bg-ink/[0.03] disabled:text-ink-muted"

export function CompetitionDetailsForm({
  mode,
  editionId,
  codes,
  teamTypes,
  seasons = [],
  initial,
  seasonName,
}: {
  mode: "create" | "edit"
  editionId?: string
  codes: ("union" | "league")[]
  teamTypes: { id: string; label: string; rugbyCode: "union" | "league" }[]
  seasons?: { id: string; name: string; rugbyCode: "union" | "league" }[]
  initial: CompetitionDetailsInput
  seasonName?: string | null
}) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof CompetitionDetailsInput>(k: K, value: CompetitionDetailsInput[K]) => setV((s) => ({ ...s, [k]: value }))
  const typesForCode = teamTypes.filter((t) => t.rugbyCode === v.rugbyCode)
  const seasonsForCode = seasons.filter((x) => x.rugbyCode === v.rugbyCode)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    start(async () => {
      if (mode === "create") {
        const r = await createCompetitionFromDetails(v)
        if (!r.ok) return setError(r.error)
        if (!r.editionId) {
          setNotice(r.notice ?? "The competition was created without a season.")
          return
        }
        router.push(`/fixtures/competitions/${r.editionId}/participants`)
      } else {
        const r = await saveCompetitionDetails(editionId!, { canonicalTeamTypeId: v.canonicalTeamTypeId, format: v.format, teamCount: v.teamCount, organiserName: v.organiserName })
        if (!r.ok) return setError(r.error)
        setNotice("Details saved.")
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="comp-name" className="text-sm font-medium text-ink">
            Name
          </label>
          <input
            id="comp-name"
            required
            value={v.name}
            disabled={mode === "edit"}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Lancashire U12 Cup"
            className={field}
            autoFocus={mode === "create"}
          />
        </div>

        <fieldset disabled={mode === "edit" || codes.length === 1}>
          <legend className="text-sm font-medium text-ink">Rugby Code</legend>
          <div className="mt-1 inline-flex rounded-md border border-ink/15 p-0.5" role="radiogroup" aria-label="Rugby Code" aria-required="true">
            {codes.map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={v.rugbyCode === code}
                onClick={() => setV((s) => ({ ...s, rugbyCode: code, seasonId: null, canonicalTeamTypeId: null }))}
                className={cn(
                  "h-8 min-w-20 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-not-allowed",
                  v.rugbyCode === code ? "bg-forest-800 font-medium text-white" : "text-ink hover:bg-ink/[0.05]",
                )}
              >
                {code === "union" ? "Union" : "League"}
              </button>
            ))}
          </div>
          {mode === "create" && !v.rugbyCode && <p className="mt-1 text-xs text-ink-muted">Choose the code first. Union and League competitions are kept apart.</p>}
          {mode === "edit" && seasonName && <p className="mt-1 text-xs text-ink-muted">Season {seasonName}</p>}
        </fieldset>

        {mode === "create" && (
          <div>
            <label htmlFor="comp-season" className="text-sm font-medium text-ink">
              Season
            </label>
            <select id="comp-season" value={v.seasonId ?? ""} disabled={!v.rugbyCode} onChange={(e) => set("seasonId", e.target.value || null)} className={field}>
              <option value="">Current Season</option>
              {seasonsForCode.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="comp-type" className="text-sm font-medium text-ink">
            Age and Category
          </label>
          <select id="comp-type" value={v.canonicalTeamTypeId ?? ""} onChange={(e) => set("canonicalTeamTypeId", e.target.value || null)} className={field}>
            <option value="">Not set</option>
            {typesForCode.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-ink">Format</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={v.format === f.value}
                onClick={() => set("format", v.format === f.value ? null : f.value)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                  v.format === f.value ? "border-forest-800 bg-forest-800/[0.04]" : "border-ink/15 hover:border-ink/30",
                )}
              >
                <span className="block text-sm font-medium text-ink">{f.label}</span>
                <span className="block text-xs text-ink-muted">{f.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="comp-teams" className="text-sm font-medium text-ink">
            Number of Teams
          </label>
          <input
            id="comp-teams"
            type="number"
            inputMode="numeric"
            min={2}
            max={128}
            value={v.teamCount ?? ""}
            onChange={(e) => set("teamCount", e.target.value ? Number(e.target.value) : null)}
            placeholder="32"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="comp-organiser" className="text-sm font-medium text-ink">
            Organiser
          </label>
          <input id="comp-organiser" value={v.organiserName ?? ""} onChange={(e) => set("organiserName", e.target.value || null)} placeholder="Lancashire RFU" className={field} />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-ink">
          {notice}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2">
        <Button type="submit" className="h-10" disabled={pending || !v.name.trim() || !v.rugbyCode || (mode === "edit" && !dirty)}>
          {pending ? "Saving…" : mode === "create" ? "Create Competition" : "Save Details"}
        </Button>
      </div>
    </form>
  )
}
