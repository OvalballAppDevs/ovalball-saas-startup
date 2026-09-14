"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"

import { StepBar, type StepBarStep } from "@/components/fixtures/step-bar"
import { Button } from "@/components/ui/button"
import { IMPORT_ROW_LIMIT, IMPORT_TARGETS, guessMapping, looksLikeHeader, mappedRows, mappingProblems, tableFromText } from "@/lib/fixtures/import-mapping"
import type { PlannerDraftRow, PlannerField, PlannerRowResult } from "@/lib/fixtures/planner-model"
import { readXlsx } from "@/lib/fixtures/xlsx-reader"
import { cn } from "@/lib/utils"

import { stageImportRows, validateImportRows } from "./actions"

type Step = "source" | "map" | "preview" | "validate"

const STATUS_WORD: Record<PlannerRowResult["status"], string> = {
  blank: "",
  ready: "Ready",
  review: "Needs a look",
  conflict: "Clash",
  invalid: "Not readable",
}
const STATUS_MARK: Record<PlannerRowResult["status"], string> = {
  blank: "",
  ready: "text-forest-800",
  review: "text-amber-700",
  conflict: "text-sky-700",
  invalid: "text-destructive-text",
}
const STATUS_GLYPH: Record<PlannerRowResult["status"], string> = { blank: "", ready: "●", review: "▲", conflict: "◆", invalid: "■" }

const PREVIEW_COLUMNS = IMPORT_TARGETS.map((t) => t.field)

export function ImportWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("source")
  const [sourceMode, setSourceMode] = useState<"upload" | "paste">("upload")
  const [pasted, setPasted] = useState("")
  const [filename, setFilename] = useState("")
  const [table, setTable] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<(PlannerField | null)[]>([])
  const [results, setResults] = useState<PlannerRowResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [checking, startChecking] = useTransition()
  const [staging, startStaging] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const headers = useMemo(() => (hasHeader ? (table[0] ?? []) : (table[0] ?? []).map((_, i) => `Column ${i + 1}`)), [table, hasHeader])
  const body = useMemo(() => (hasHeader ? table.slice(1) : table), [table, hasHeader])
  const rows = useMemo<PlannerDraftRow[]>(() => (mapping.length ? mappedRows(body, mapping) : []), [body, mapping])
  const problems = useMemo(() => mappingProblems(mapping), [mapping])
  const tooMany = rows.length > IMPORT_ROW_LIMIT

  const resultByKey = useMemo(() => new Map((results ?? []).map((r) => [r.key, r])), [results])
  const tally = useMemo(() => {
    const t = { ready: 0, review: 0, conflict: 0, invalid: 0 }
    for (const r of results ?? []) if (r.status !== "blank") t[r.status]++
    return t
  }, [results])

  function loadTable(next: string[][], name: string) {
    if (next.length === 0) {
      setError("Ovalball couldn't find any rows in that. Check it has a row per fixture.")
      return
    }
    const header = looksLikeHeader(next[0])
    setTable(next)
    setFilename(name)
    setHasHeader(header)
    setMapping(header ? guessMapping(next[0]) : next[0].map(() => null))
    setResults(null)
    setError(null)
    setStep("map")
  }

  async function onFile(file: File) {
    setReading(true)
    setError(null)
    try {
      if (/\.xlsx$/i.test(file.name)) loadTable(await readXlsx(await file.arrayBuffer()), file.name)
      else if (/\.(xls|numbers|ods)$/i.test(file.name)) setError("Save this file as .xlsx or CSV first. Ovalball reads Excel workbooks (.xlsx), CSV and tab-separated text.")
      else loadTable(tableFromText(await file.text()), file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be read.")
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function toggleHeader(next: boolean) {
    setHasHeader(next)
    setMapping(next ? guessMapping(table[0] ?? []) : (table[0] ?? []).map(() => null))
    setResults(null)
  }

  function check() {
    setError(null)
    startChecking(async () => {
      const r = await validateImportRows(rows)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setResults(r.rows)
      setStep("validate")
    })
  }

  function stage() {
    setError(null)
    startStaging(async () => {
      const r = await stageImportRows(filename, rows)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/fixtures/import/${r.batchId}`)
    })
  }

  const reached = { source: true, map: table.length > 0, preview: table.length > 0 && problems.length === 0, validate: results !== null }
  const steps: StepBarStep[] = [
    { key: "source", label: "Upload or Paste", detail: filename || undefined, onSelect: () => setStep("source") },
    { key: "map", label: "Map Columns", detail: table.length ? `${mapping.filter(Boolean).length} of ${headers.length} columns` : undefined, onSelect: reached.map ? () => setStep("map") : undefined },
    { key: "preview", label: "Preview", detail: rows.length ? `${rows.length} rows` : undefined, onSelect: reached.preview ? () => setStep("preview") : undefined },
    {
      key: "validate",
      label: "Validate",
      detail: results ? `${tally.ready} ready${tally.review + tally.invalid + tally.conflict ? `, ${tally.review + tally.invalid + tally.conflict} to look at` : ""}` : undefined,
      onSelect: reached.validate ? () => setStep("validate") : undefined,
    },
    { key: "stage", label: "Stage", done: false },
    { key: "publish", label: "Publish", done: false },
  ]

  return (
    <div className="flex flex-col gap-5">
      <StepBar steps={steps} current={step} label="Import steps" />

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
          {error}
        </p>
      )}

      {step === "source" && (
        <section aria-labelledby="source-title" className="rounded-lg border border-ink/10 bg-white p-5">
          <h2 id="source-title" className="text-base font-semibold text-ink">
            Bring In a File
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            A league export, last season&rsquo;s spreadsheet or a copied table. You choose what each column means next, and nothing is created until the rows have been checked and staged.
          </p>

          <div className="mt-4 inline-flex rounded-md border border-ink/15 p-0.5" role="tablist" aria-label="How to bring in fixtures">
            {(["upload", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={sourceMode === m}
                onClick={() => setSourceMode(m)}
                className={cn(
                  "h-8 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                  sourceMode === m ? "bg-forest-800 font-medium text-white" : "text-ink hover:bg-ink/[0.05]",
                )}
              >
                {m === "upload" ? "Upload File" : "Paste Rows"}
              </button>
            ))}
          </div>

          {sourceMode === "upload" ? (
            <div className="mt-4">
              <label
                htmlFor="import-file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink/20 bg-chalk px-6 py-10 text-center hover:border-forest-800/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) void onFile(f)
                }}
              >
                {reading ? <Loader2 className="size-6 animate-spin text-ink-muted motion-reduce:animate-none" aria-hidden="true" /> : <FileSpreadsheet className="size-6 text-ink-muted" aria-hidden="true" />}
                <span className="text-sm font-medium text-ink">{reading ? "Reading file…" : "Choose a File or Drop It Here"}</span>
                <span className="text-xs text-ink-muted">Excel (.xlsx), CSV or tab-separated text, up to {IMPORT_ROW_LIMIT} rows</span>
              </label>
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept=".xlsx,.csv,.tsv,.txt,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onFile(f)
                }}
              />
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="import-paste" className="text-sm font-medium text-ink">
                Rows from a Spreadsheet
              </label>
              <textarea
                id="import-paste"
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={"Date\tKick Off\tOur Team\tOpposition Club\n14/08/2027\t11:00\tUnder 12 Boys\tFylde RFC"}
                spellCheck={false}
                className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40"
              />
              <Button type="button" className="mt-3 h-9" disabled={!pasted.trim()} onClick={() => loadTable(tableFromText(pasted), "Pasted fixtures")}>
                <Upload className="size-4" aria-hidden="true" />
                Use These Rows
              </Button>
            </div>
          )}
        </section>
      )}

      {step === "map" && (
        <section aria-labelledby="map-title" className="rounded-lg border border-ink/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-5 py-4">
            <div>
              <h2 id="map-title" className="text-base font-semibold text-ink">
                What Each Column Means
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">Ovalball has guessed from the headings. Correct anything it got wrong; columns set to Don&rsquo;t Import are left out.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={hasHeader} onChange={(e) => toggleHeader(e.target.checked)} className="size-4 accent-forest-800" />
              First Row Is Headings
            </label>
          </div>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-ink/8 text-left text-xs text-ink-muted">
                  <th scope="col" className="px-5 py-2 font-medium">
                    Column in File
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    First Values
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Import As
                  </th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => {
                  const samples = body.slice(0, 3).map((r) => r[i]).filter(Boolean)
                  const field = mapping[i]
                  const duplicate = field ? mapping.filter((m) => m === field).length > 1 : false
                  return (
                    <tr key={i} className="border-b border-ink/6 last:border-0">
                      <td className="px-5 py-2 font-medium text-ink">{h || `Column ${i + 1}`}</td>
                      <td className="max-w-72 truncate px-3 py-2 text-ink-muted" title={samples.join(", ")}>
                        {samples.join(", ") || "Empty"}
                      </td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`map-${i}`}>
                          Import {h || `Column ${i + 1}`} As
                        </label>
                        <select
                          id={`map-${i}`}
                          value={field ?? ""}
                          aria-invalid={duplicate || undefined}
                          onChange={(e) => {
                            const next = [...mapping]
                            next[i] = (e.target.value || null) as PlannerField | null
                            setMapping(next)
                            setResults(null)
                          }}
                          className={cn(
                            "h-9 w-56 rounded-md border bg-white px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/40",
                            duplicate ? "border-destructive-text" : field ? "border-forest-800/40" : "border-ink/15 text-ink-muted",
                          )}
                        >
                          <option value="">Don&rsquo;t Import</option>
                          {IMPORT_TARGETS.map((t) => (
                            <option key={t.field} value={t.field}>
                              {t.label}
                              {t.required ? " (required)" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-5 py-3">
            <ul className="text-sm text-destructive-text">
              {problems.map((p) => (
                <li key={`${p.kind}-${p.field}`}>{p.message}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="h-9" onClick={() => setStep("source")}>
                Back
              </Button>
              <Button type="button" className="h-9" disabled={problems.length > 0 || rows.length === 0} onClick={() => setStep("preview")}>
                Preview {rows.length} Rows
              </Button>
            </div>
          </div>
        </section>
      )}

      {(step === "preview" || step === "validate") && (
        <section aria-labelledby="rows-title" className="rounded-lg border border-ink/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-5 py-4">
            <div>
              <h2 id="rows-title" className="text-base font-semibold text-ink">
                {step === "preview" ? "The Rows Ovalball Will Check" : "Checked Against Ovalball"}
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {step === "preview"
                  ? "This is the file as Ovalball has read it. Check the columns line up, then check the rows."
                  : "Staging keeps every row. Rows that need a look can be corrected or excluded on the next screen before anything is published; Ovalball clubs are asked, never booked."}
              </p>
            </div>
            {step === "validate" && results && (
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums" aria-live="polite">
                <span className="text-forest-800">● {tally.ready} ready</span>
                {tally.review > 0 && <span className="text-amber-700">▲ {tally.review} need a look</span>}
                {tally.conflict > 0 && <span className="text-sky-700">◆ {tally.conflict} clash</span>}
                {tally.invalid > 0 && <span className="text-destructive-text">■ {tally.invalid} not readable</span>}
              </p>
            )}
          </div>
          {tooMany && (
            <p role="alert" className="border-b border-ink/8 px-5 py-2 text-sm text-destructive-text">
              This file has {rows.length} rows. An import can hold up to {IMPORT_ROW_LIMIT}; split the file and import it in parts.
            </p>
          )}
          <div className="relative max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-ink/10 text-left text-xs text-ink-muted">
                  <th scope="col" className="w-12 px-3 py-2 font-medium">
                    Row
                  </th>
                  {step === "validate" && (
                    <th scope="col" className="w-64 px-3 py-2 font-medium">
                      Check
                    </th>
                  )}
                  {PREVIEW_COLUMNS.map((f) => (
                    <th key={f} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {IMPORT_TARGETS.find((t) => t.field === f)?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const result = resultByKey.get(row.key)
                  return (
                    <tr key={row.key} className="border-b border-ink/6 align-top last:border-0">
                      <td className="px-3 py-2 text-ink-muted tabular-nums">{i + 1}</td>
                      {step === "validate" && (
                        <td className="px-3 py-2">
                          {result && (
                            <>
                              <span className={cn("font-medium", STATUS_MARK[result.status])}>
                                <span aria-hidden="true">{STATUS_GLYPH[result.status]} </span>
                                {STATUS_WORD[result.status]}
                              </span>
                              {result.willSendRequest && <span className="block text-xs text-ink-muted">Sent to the club to confirm</span>}
                              {result.errors.map((e) => (
                                <span key={e} className="block text-xs text-ink-muted">
                                  {e}
                                </span>
                              ))}
                            </>
                          )}
                        </td>
                      )}
                      {PREVIEW_COLUMNS.map((f) => {
                        const state = result?.cells?.[f]
                        return (
                          <td
                            key={f}
                            className={cn(
                              "max-w-52 truncate px-3 py-2 text-ink",
                              state === "review" && "bg-amber-500/[0.10]",
                              state === "error" && "bg-destructive/[0.09]",
                            )}
                            title={row[f]}
                          >
                            {row[f]}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink/8 px-5 py-3">
            <Button type="button" variant="ghost" className="h-9" onClick={() => setStep("map")} disabled={checking || staging}>
              Back to Mapping
            </Button>
            {step === "preview" ? (
              <Button type="button" className="h-9" disabled={checking || tooMany || rows.length === 0} onClick={check}>
                {checking ? "Checking…" : `Check ${rows.length} Rows`}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" className="h-9" disabled={checking || staging} onClick={check}>
                  {checking ? "Checking…" : "Check Again"}
                </Button>
                <Button type="button" className="h-9" disabled={staging || checking || tooMany} onClick={stage}>
                  {staging ? "Staging…" : `Stage ${rows.length} Rows`}
                </Button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
