"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { exportFixturesCsv } from "./actions"
import type { AdminFixtureQuery } from "./types"

export function ExportFixturesButton({ query }: { query: AdminFixtureQuery }) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle")
  const hasFilters = query.q.length > 0 || query.date !== "all" || query.status !== "all" || query.code !== "all" || query.source !== "all"

  async function handleExport() {
    setStatus("working")
    const result = await exportFixturesCsv(query)
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
        {status === "working" ? "Preparing export…" : hasFilters ? "Export filtered results" : "Export all fixtures"}
      </Button>
      {status === "error" && <p className="text-xs text-destructive">Export failed. Please try again.</p>}
    </div>
  )
}
