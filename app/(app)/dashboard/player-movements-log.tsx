"use client"

import { useState } from "react"
import { ArrowRight, Download } from "lucide-react"

import type { PlayerMovementRow } from "@/lib/app-context/dashboard-data"

import { exportPlayerMovementsCsv } from "./actions"

/**
 * PLAYER REQUESTS Section 11: Club Admin's own glance at recent player
 * movement, never dispensation evidence -- just who moved, from where,
 * to where, and when. The full authorized export is a separate action
 * with a wider, still-not-raw-evidence field set.
 */
export function PlayerMovementsLog({ clubId, rows }: { clubId: string; rows: PlayerMovementRow[] }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportLog() {
    setExporting(true)
    setError(null)
    const res = await exportPlayerMovementsCsv(clubId)
    setExporting(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `player-movements-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) return null

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Recent player movements</h2>
        <button
          type="button"
          onClick={() => void exportLog()}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 disabled:opacity-50"
        >
          <Download className="size-3.5" />
          {exporting ? "Exporting..." : "Export full log"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-white px-4 py-3.5 text-sm">
            <span className="font-medium text-ink">{m.playerName}</span>
            <span className="text-ink/60">{m.fromTeamName}</span>
            <ArrowRight className="size-3.5 text-ink/40" />
            <span className="text-ink/60">{m.toTeamName}</span>
            <span className="ml-auto text-xs text-ink/45">
              {m.date ? new Date(m.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
