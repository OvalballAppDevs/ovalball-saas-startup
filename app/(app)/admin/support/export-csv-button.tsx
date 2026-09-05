"use client"

import { useState } from "react"
import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"

import { exportSupportTicketsCsv } from "./actions"
import type { AdminSupportQuery } from "./query"

/** Safe fields only -- see exportSupportTicketsCsv's own comment for exactly what that means. */
export function ExportCsvButton({ query }: { query: AdminSupportQuery }) {
  const [downloading, setDownloading] = useState(false)

  async function handleClick() {
    setDownloading(true)
    const result = await exportSupportTicketsCsv(query)
    setDownloading(false)
    if (!result.ok) return

    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ovalball-support-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleClick} disabled={downloading}>
      <Download className="size-3.5" />
      {downloading ? "Exporting…" : "Export CSV"}
    </Button>
  )
}
