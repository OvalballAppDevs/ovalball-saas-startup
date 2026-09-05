"use client"

import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { AdminFixtureQuery, CodeFilter, DateFilter, StatusFilter } from "@/app/(app)/admin/fixtures/types"

import { exportClubFixturesCsv } from "./actions"

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
]
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "Planned", label: "Planned" },
  { value: "Booked", label: "Booked" },
  { value: "To Be Determined", label: "To Be Determined" },
  { value: "Completed", label: "Completed" },
  { value: "Cancelled", label: "Cancelled" },
]
const CODE_OPTIONS: { value: CodeFilter; label: string }[] = [
  { value: "all", label: "Union & League" },
  { value: "union", label: "Union only" },
  { value: "league", label: "League only" },
]

/**
 * Reconciliation complaint 29: exporting used to always mean "export
 * everything" for a club, with no way to export a narrowed set. This
 * gives Club Admin/Fixtures Secretary the SAME filter shape the Site
 * Admin master export already applies (lib/fixtures/csv-export.ts) --
 * Date/Status/Rugby code -- so what downloads is exactly what was asked
 * for, not a silent full dump every time. Filters here only affect the
 * export; the Fixtures page above doesn't render a filterable fixture
 * list of its own (that's the Calendar), so this panel is the one place
 * a club chooses what a downloaded CSV should contain.
 */
export function ExportClubFixturesButton() {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<DateFilter>("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [code, setCode] = useState<CodeFilter>("all")
  const [exportStatus, setExportStatus] = useState<"idle" | "working" | "error">("idle")

  const hasFilters = date !== "all" || status !== "all" || code !== "all"

  async function handleExport() {
    setExportStatus("working")
    const query: AdminFixtureQuery = {
      q: "",
      date,
      status,
      code,
      source: "all",
      resultStatus: "all",
      competitionEditionId: null,
      sort: "date-asc",
      page: 1,
      size: 100,
    }
    const result = await exportClubFixturesCsv(query)
    setExportStatus("idle")
    if (!result.ok) {
      setExportStatus("error")
      return
    }
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={hasFilters ? "size-10 border-pitch-600/40 text-forest-800" : "size-10 text-ink/60"}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Export filters"
          title="Filter what gets exported"
        >
          <SlidersHorizontal className="size-4" />
        </Button>
        <Button type="button" variant="outline" className="h-10" disabled={exportStatus === "working"} onClick={handleExport}>
          {exportStatus === "working" ? "Preparing export…" : hasFilters ? "Export filtered" : "Export fixtures"}
        </Button>
      </div>
      {exportStatus === "error" && <p className="text-xs text-destructive">Export failed. Please try again.</p>}
      {open && (
        <div className="absolute top-full z-10 mt-2 flex w-64 flex-col gap-2.5 rounded-lg border border-ink/10 bg-white p-3 shadow-lg">
          <div>
            <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor="export-filter-date">
              Date
            </label>
            <select
              id="export-filter-date"
              value={date}
              onChange={(e) => setDate(e.target.value as DateFilter)}
              className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor="export-filter-status">
              Status
            </label>
            <select
              id="export-filter-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase" htmlFor="export-filter-code">
              Rugby code
            </label>
            <select
              id="export-filter-code"
              value={code}
              onChange={(e) => setCode(e.target.value as CodeFilter)}
              className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            >
              {CODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
