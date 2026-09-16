"use client"

import { useState } from "react"
import { ArrowRight, Download } from "lucide-react"

import type { PlayerMovementRow } from "@/lib/app-context/dashboard-data"

import { exportPlayerMovementsCsv } from "./actions"

/**
 * PLAYER REQUESTS Section 11: Club Admin's own glance at recent player
 * movement, never dispensation evidence -- just who moved, from where,
 * to where, and when. The full authorised export is a separate action
 * with a wider, still-not-raw-evidence field set.
 */
export function PlayerMovementsLog({ clubId, rows }: { clubId: string; rows: PlayerMovementRow[] }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [askingReason, setAskingReason] = useState(false)

  async function exportLog() {
    setExporting(true)
    setError(null)
    const res = await exportPlayerMovementsCsv(clubId, reason)
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
    setAskingReason(false)
    setReason("")
  }

  if (rows.length === 0) return null

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Recent Player Movements</h2>
        <button
          type="button"
          onClick={() => setAskingReason(true)}
          disabled={exporting || askingReason}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 disabled:opacity-50"
        >
          <Download className="size-3.5" />
          {exporting ? "Exporting..." : "Export Full Log"}
        </button>
      </div>
      {/* Identity/Auth Slice 4H, section S. This file names children, the teams they moved between and
          their dispensation references, so it needs club.reporting.export and a reason the club can be
          shown afterwards. Asking here rather than after the download is the only point at which the
          person actually knows why they are doing it. */}
      {askingReason && (
        <div className="mt-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
          <label className="block text-sm text-ink">
            Reason for Export
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why this record of children's movements is being taken out of Ovalball."
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-1 text-xs text-ink-muted">This export names children. Your reason is recorded against it.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void exportLog()}
              disabled={exporting || reason.trim().length === 0}
              className="rounded-md bg-forest-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
            <button
              type="button"
              onClick={() => { setAskingReason(false); setReason(""); setError(null) }}
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-white px-4 py-3.5 text-sm">
            <span className="font-medium text-ink">{m.playerName}</span>
            <span className="text-ink/60">{m.fromTeamName}</span>
            <ArrowRight className="size-3.5 text-ink-muted" />
            <span className="text-ink/60">{m.toTeamName}</span>
            <span className="ml-auto text-xs text-ink-muted">
              {m.date ? new Date(m.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
