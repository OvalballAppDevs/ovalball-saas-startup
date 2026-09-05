"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { exportClubsCsv } from "./actions"
import { hasActiveFilters, type AdminClubQuery } from "./types"

/**
 * Server-generated CSV (exportClubsCsv), not a client-side dump of
 * already-fetched rows -- the button only ever has the current page's
 * rows in memory, and "export filtered results" has to mean every
 * matching row, not just the 25/50/100 on screen. The label makes clear
 * this exports exactly what's currently filtered, never "everything"
 * silently.
 */
export function ExportButton({ query }: { query: AdminClubQuery }) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle")

  const hasFilters = hasActiveFilters(query)

  async function handleExport() {
    setStatus("working")
    const result = await exportClubsCsv(query)
    setStatus("idle")
    if (!result.ok) {
      setStatus("error")
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
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" className="h-10" disabled={status === "working"} onClick={handleExport}>
        {status === "working" ? "Preparing export…" : hasFilters ? "Export filtered results" : "Export all clubs"}
      </Button>
      {status === "error" && <p className="text-xs text-destructive">Export failed. Please try again.</p>}
    </div>
  )
}
