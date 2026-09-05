"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { parseCsv } from "@/lib/fixtures/parse-csv"

const TEMPLATE_HEADERS = [
  "fixture_date",
  "kickoff_time",
  "home_club",
  "home_team",
  "away_club",
  "away_team",
  "game_type",
  "competition",
  "venue",
  "notes",
  "source_reference",
]
const TEMPLATE_EXAMPLE = ["2026-09-12", "14:00", "Burnley RUFC", "U15 A", "Rossendale RUFC", "U15 A", "Friendly", "", "", "", ""]

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.join(",")].join("\r\n") + "\r\n"
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "ovalball-fixture-import-template.csv"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * The ONE CSV upload widget, shared by the Site Admin global import and
 * every club-scoped import -- one CSV contract (Section BC), never a
 * second upload UI. `createBatch`/`redirectTo` are the only per-caller
 * difference (which server action stages the rows, and where the
 * resulting batch review page lives).
 */
export function CsvUploadForm({
  createBatch,
  redirectBase,
}: {
  createBatch: (filename: string, rows: Record<string, string>[]) => Promise<{ ok: true; batchId: string } | { ok: false; error: string }>
  /** A plain string, never a function -- a closure prop passed from a Server Component page can't cross the client boundary ("Functions cannot be passed directly to Client Components" -- found by live verification, not a hypothetical). The batch review path is always `${redirectBase}/${batchId}`. */
  redirectBase: string
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<"idle" | "reading" | "processing">("idle")
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setStage("reading")
    const text = await file.text()
    const { headers, rows } = parseCsv(text)
    if (headers.length === 0 || rows.length === 0) {
      setStage("idle")
      setError("Couldn't read any rows from that file. Check it's a valid CSV with a header row.")
      return
    }
    setRowCount(rows.length)
    setStage("processing")
    const result = await createBatch(file.name, rows)
    if (result.ok) {
      router.push(`${redirectBase}/${result.batchId}`)
    } else {
      setStage("idle")
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="h-10" onClick={downloadTemplate}>
          Download CSV template
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-ink/20 bg-white p-8 text-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Upload fixtures CSV"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        {stage === "idle" && (
          <>
            <p className="text-sm text-ink/60">Upload a CSV file to begin.</p>
            <Button type="button" className="mt-3 h-10" onClick={() => fileInputRef.current?.click()}>
              Choose file&hellip;
            </Button>
          </>
        )}
        {stage === "reading" && <p className="text-sm text-ink/60">Reading file&hellip;</p>}
        {stage === "processing" && <p className="text-sm text-ink/60">Parsing {rowCount ?? "…"} rows, matching clubs and teams, checking for conflicts&hellip;</p>}
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
