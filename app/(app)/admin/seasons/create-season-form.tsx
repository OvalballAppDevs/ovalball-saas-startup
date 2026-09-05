"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { seasonYearLabel, seasonYearStartOptions, validateSeasonDates } from "@/lib/seasons/validation"

import { createSeason } from "./actions"

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = seasonYearStartOptions(CURRENT_YEAR)

export function CreateSeasonForm() {
  const [rugbyCode, setRugbyCode] = useState<"union" | "league">("union")
  const [seasonYearStart, setSeasonYearStart] = useState(CURRENT_YEAR)
  const [startsOn, setStartsOn] = useState("")
  const [endsOn, setEndsOn] = useState("")
  const [preSeasonStartsOn, setPreSeasonStartsOn] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const preview = useMemo(() => `${rugbyCode === "union" ? "Rugby Union" : "Rugby League"} ${seasonYearLabel(rugbyCode, seasonYearStart)}`, [rugbyCode, seasonYearStart])

  const clientError = useMemo(
    () =>
      startsOn && endsOn
        ? validateSeasonDates({ rugbyCode, seasonYearStart, preSeasonStartsOn: preSeasonStartsOn || null, startsOn, endsOn })
        : null,
    [rugbyCode, seasonYearStart, preSeasonStartsOn, startsOn, endsOn]
  )

  async function handleCreate() {
    setStatus("saving")
    setError(null)
    const result = await createSeason({
      rugbyCode,
      seasonYearStart,
      startsOn,
      endsOn,
      preSeasonStartsOn: preSeasonStartsOn || null,
    })
    if (result.ok) {
      setStatus("idle")
      setStartsOn("")
      setEndsOn("")
      setPreSeasonStartsOn("")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  // Client constraints are for fast feedback only -- createSeason() re-runs
  // the exact same validateSeasonDates() call server-side, which is the
  // real, authoritative boundary (Section R: "Server validation must still
  // enforce the rules even if UI constraints exist").
  const canSubmit = startsOn && endsOn && !clientError

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="season-code" className="text-ink/80">
          Rugby code
        </Label>
        <select
          id="season-code"
          value={rugbyCode}
          onChange={(e) => setRugbyCode(e.target.value as "union" | "league")}
          className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="union">Union</option>
          <option value="league">League</option>
        </select>
      </div>
      <div>
        <Label htmlFor="season-year-start" className="text-ink/80">
          Season
        </Label>
        <select
          id="season-year-start"
          value={seasonYearStart}
          onChange={(e) => setSeasonYearStart(Number(e.target.value))}
          className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {seasonYearLabel(rugbyCode, y)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink/45">Canonical name: {preview}</p>
      </div>
      <div>
        <Label htmlFor="season-pre-start" className="text-ink/80">
          Pre-season starts (optional)
        </Label>
        <Input
          id="season-pre-start"
          type="date"
          value={preSeasonStartsOn}
          onChange={(e) => setPreSeasonStartsOn(e.target.value)}
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>
      <div>
        <Label htmlFor="season-starts" className="text-ink/80">
          Main season starts
        </Label>
        <Input
          id="season-starts"
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>
      <div>
        <Label htmlFor="season-ends" className="text-ink/80">
          Main season ends
        </Label>
        <Input
          id="season-ends"
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>
      {(clientError ?? error) && <p className="text-sm text-destructive sm:col-span-2">{clientError ?? error}</p>}
      <div className="sm:col-span-2">
        <Button type="button" className="h-10" disabled={status === "saving" || !canSubmit} onClick={handleCreate}>
          {status === "saving" ? "Adding…" : "Add season"}
        </Button>
      </div>
    </div>
  )
}
