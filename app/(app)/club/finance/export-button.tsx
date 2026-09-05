"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { exportFinanceCsv } from "./actions"

/** A normal same-origin file download from data this app generated itself -- not an artifact/third-party download, so a plain Blob + <a> click is the correct, safe pattern here. */
export function ExportButton({ clubId, billingPeriod }: { clubId: string; billingPeriod: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setStatus("loading")
    setError(null)
    const result = await exportFinanceCsv(clubId, billingPeriod)
    if (!result.ok) {
      setError(result.error)
      setStatus("error")
      return
    }
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `finance-export-${billingPeriod.slice(0, 7)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setStatus("idle")
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className="h-9" disabled={status === "loading"} onClick={handleClick}>
        {status === "loading" ? "Exporting…" : "Export CSV"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
