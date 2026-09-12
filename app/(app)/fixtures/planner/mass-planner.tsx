"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  Eraser,
  Plus,
  Send,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react"

import { parseCsv } from "@/lib/fixtures/parse-csv"
import {
  PLANNER_FIELDS,
  applyGridPaste,
  blankRow,
  blankRows,
  fixtureDayRows,
  isBlankRow,
  isGridPaste,
  parseClipboardGrid,
  rowsFromRecords,
  summariseResults,
  type CellState,
  type PlannerDraftRow,
  type PlannerField,
  type PlannerRowResult,
} from "@/lib/fixtures/planner-model"

import { createPlannerFixtures, validatePlanner, type PlannerCreateOutcome } from "./actions"
import { listOppositionTeams, listPitches, searchOppositionClubs, searchVenues } from "./lookup-actions"
import { LookupCell, PlainCell, type LookupOption } from "./planner-cells"

/**
 * THE MASS FIXTURE PLANNER.
 *
 * A fixture secretary already has the season. It is in a spreadsheet, and
 * the fastest thing they can do with it is select it and press Ctrl+C. So
 * this surface IS a spreadsheet: the grid owns the page, the rows are
 * numbered, the cells have borders, and the only chrome is one line of
 * toolbar. Anything that is not the grid is a step back towards the
 * spreadsheet they came from.
 *
 * It is deliberately NOT a spreadsheet where that matters. Every
 * structured column resolves against canonical records -- our teams, the
 * Club Directory, real competition editions, real venues and pitches --
 * so what leaves here is a fixture rather than a row of text resembling
 * one.
 */

const STARTING_ROWS = 25

type LookupKind = "team" | "oppositionClub" | "oppositionTeam" | "competition" | "venue" | "pitch" | null

interface Column {
  field: PlannerField
  label: string
  width: string
  hint?: string
  lookup: LookupKind
}

/** The creation grid carries what data entry needs -- Meet and Pitch included. */
const COLUMNS: Column[] = [
  { field: "date", label: "Date", width: "w-[7.5rem]", hint: "14/08/27", lookup: null },
  { field: "kickoff", label: "Kick Off", width: "w-[5.5rem]", hint: "11:00", lookup: null },
  { field: "meet", label: "Meet", width: "w-[5.5rem]", hint: "10:15", lookup: null },
  { field: "homeAway", label: "H/A", width: "w-[5rem]", hint: "H", lookup: null },
  { field: "ourTeam", label: "Our Team", width: "w-52", lookup: "team" },
  { field: "oppositionClub", label: "Opposition Club", width: "w-56", lookup: "oppositionClub" },
  { field: "oppositionTeam", label: "Opposition Team", width: "w-44", lookup: "oppositionTeam" },
  { field: "competition", label: "Competition", width: "w-44", lookup: "competition" },
  { field: "venue", label: "Venue", width: "w-48", lookup: "venue" },
  { field: "pitch", label: "Pitch", width: "w-36", lookup: "pitch" },
  { field: "notes", label: "Notes", width: "w-44", lookup: null },
]

const STATUS_RAIL: Record<PlannerRowResult["status"], string> = {
  blank: "bg-transparent",
  ready: "bg-pitch-600",
  review: "bg-amber-500",
  conflict: "bg-sky-500",
  invalid: "bg-destructive",
}

const STATUS_WORD: Record<PlannerRowResult["status"], string> = {
  blank: "",
  ready: "Ready",
  review: "Needs a look",
  conflict: "Clash",
  invalid: "Not readable",
}

/**
 * The template is generated FROM the grid's own columns.
 *
 * A template file that drifts from the columns it is a template for is
 * worse than no template: somebody fills in eleven headings, uploads, and
 * discovers two of them were never read. Generating it here means the
 * download and the grid cannot disagree, and the example row shows the
 * shorthand the parser genuinely accepts.
 */
function downloadTemplate() {
  const example = ["14/08/2027", "11:00", "10:15", "H", "Under 12 Boys", "Rossendale RUFC", "", "", "", "", ""]
  const csv = [COLUMNS.map((c) => c.label).join(","), example.join(",")].join("\r\n") + "\r\n"
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = "ovalball-fixture-planner-template.csv"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** What a row has resolved to, so dependent lookups can narrow themselves. */
const EMPTY_RESOLUTION: RowResolution = {
  oppositionDirectoryId: null,
  oppositionTenantClubId: null,
  venueId: null,
}

interface RowResolution {
  oppositionDirectoryId: string | null
  oppositionTenantClubId: string | null
  venueId: string | null
}

export function MassFixturePlanner({
  clubId,
  clubName,
  canCreateMany,
  teamOptions,
  venueOptions,
  competitionOptions,
}: {
  clubId: string
  clubName: string
  canCreateMany: boolean
  teamOptions: string[]
  venueOptions: string[]
  competitionOptions: string[]
}) {
  const [rows, setRows] = useState<PlannerDraftRow[]>(() => blankRows(STARTING_ROWS))
  const [results, setResults] = useState<Record<string, PlannerRowResult>>({})
  const [resolutions, setResolutions] = useState<Record<string, RowResolution>>({})
  const [undoRows, setUndoRows] = useState<PlannerDraftRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fixtureDayOpen, setFixtureDayOpen] = useState(false)
  const [outcomes, setOutcomes] = useState<PlannerCreateOutcome[] | null>(null)
  const [checking, startChecking] = useTransition()
  const [creating, startCreating] = useTransition()
  const cellRefs = useRef(new Map<string, HTMLInputElement>())

  const filled = useMemo(() => rows.filter((r) => !isBlankRow(r)), [rows])
  const resultList = useMemo(
    () => rows.map((r) => results[r.key]).filter(Boolean) as PlannerRowResult[],
    [rows, results],
  )
  const tally = useMemo(() => summariseResults(resultList), [resultList])
  const checked = resultList.length > 0
  const massBlocked = !canCreateMany && filled.length > 1

  /**
   * A CHANGED ROW IS AN UNCHECKED ROW. Keeping the old verdict against text
   * somebody has just retyped would show a tick beside a value nothing has
   * looked at -- the most dangerous thing a validation display can do.
   */
  const setCell = useCallback((rowIndex: number, rowKey: string, field: PlannerField, value: string) => {
    setRows((current) => current.map((r, i) => (i === rowIndex ? { ...r, [field]: value } : r)))
    setResults((current) => {
      if (!current[rowKey]) return current
      const next = { ...current }
      delete next[rowKey]
      return next
    })
    setOutcomes(null)
  }, [])

  const check = useCallback((subject: PlannerDraftRow[], scopeClubId: string) => {
    setError(null)
    startChecking(async () => {
      const response = await validatePlanner(subject.filter((r) => !isBlankRow(r)), scopeClubId)
      if (!response.ok) {
        setError(response.error)
        return
      }
      setResults(Object.fromEntries(response.rows.map((r) => [r.key, r])))
      // The server's resolution is authoritative; adopt it so dependent
      // lookups -- their teams, their ground, that ground's pitches --
      // narrow from what actually matched rather than from what was typed.
      setResolutions((current) => {
        const next = { ...current }
        for (const r of response.rows) {
          next[r.key] = {
            oppositionDirectoryId: r.resolvedOppositionDirectoryId,
            oppositionTenantClubId: next[r.key]?.oppositionTenantClubId ?? null,
            venueId: r.resolvedVenueId,
          }
        }
        return next
      })
    })
  }, [])

  /**
   * THE LOAD-BEARING KEYSTROKE.
   *
   * A block from a spreadsheet arrives as tab-separated cells and
   * newline-separated rows. It is written from the cell that has focus, the
   * grid grows to fit it, and the whole thing is matched immediately --
   * somebody who has just pasted a season wants to know what happened to
   * it, not to go and find a button.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) => {
      const text = event.clipboardData.getData("text/plain")
      if (!text || !isGridPaste(text)) return
      event.preventDefault()
      const next = applyGridPaste(rows, rowIndex, fieldIndex, parseClipboardGrid(text))
      setUndoRows(rows)
      setRows(next)
      setResults({})
      setOutcomes(null)
      setNotice(null)
      check(next, clubId)
    },
    [rows, check, clubId],
  )

  /** Arrow keys and Enter move between cells the way a spreadsheet does. */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) => {
    const input = event.currentTarget
    let target: [number, number] | null = null
    if (event.key === "ArrowDown" || event.key === "Enter") target = [rowIndex + 1, fieldIndex]
    else if (event.key === "ArrowUp") target = [rowIndex - 1, fieldIndex]
    else if (event.key === "ArrowLeft" && input.selectionStart === 0) target = [rowIndex, fieldIndex - 1]
    else if (event.key === "ArrowRight" && input.selectionStart === input.value.length) target = [rowIndex, fieldIndex + 1]
    if (!target) return
    const field = PLANNER_FIELDS[target[1]]
    if (!field) return
    const next = cellRefs.current.get(`${target[0]}:${field}`)
    if (!next) return
    event.preventDefault()
    next.focus()
    next.select()
  }, [])

  const loadRows = useCallback(
    (incoming: PlannerDraftRow[], note?: string) => {
      if (incoming.length === 0) return
      setUndoRows(rows)
      const keep = rows.filter((r) => !isBlankRow(r))
      const next = [...keep, ...incoming]
      const padded = next.length >= STARTING_ROWS ? next : [...next, ...blankRows(STARTING_ROWS - next.length)]
      setRows(padded)
      setResults({})
      setOutcomes(null)
      setNotice(note ?? null)
      check(padded, clubId)
    },
    [rows, check, clubId],
  )

  const readFile = useCallback(
    async (file: File) => {
      setError(null)
      setNotice(null)
      const parsed = parseCsv(await file.text())
      if (parsed.rows.length === 0) {
        setError("That file has no fixture rows in it.")
        return
      }
      const { rows: fileRows, ignoredColumns } = rowsFromRecords(parsed.rows)
      if (fileRows.length === 0) {
        setError(`Ovalball couldn't find any fixture columns in that file. It read these headings: ${parsed.headers.join(", ")}.`)
        return
      }
      loadRows(
        fileRows,
        ignoredColumns.length > 0
          ? `${fileRows.length} rows read from ${file.name}. These columns weren't used: ${ignoredColumns.join(", ")}.`
          : `${fileRows.length} rows read from ${file.name}.`,
      )
    },
    [loadRows],
  )

  /** Copies the first value in a column down every started row below it. */
  const fillDown = useCallback((field: PlannerField) => {
    setRows((current) => {
      const source = current.find((r) => r[field])?.[field]
      if (!source) return current
      const lastFilled = current.reduce((acc, r, i) => (isBlankRow(r) ? acc : i), 0)
      return current.map((r, i) => (i <= lastFilled && !r[field] && !isBlankRow(r) ? { ...r, [field]: source } : r))
    })
    setResults({})
    setOutcomes(null)
  }, [])

  const create = useCallback(() => {
    setError(null)
    startCreating(async () => {
      const response = await createPlannerFixtures(filled, clubId)
      if (!response.ok) {
        setError(response.error)
        return
      }
      setOutcomes(response.outcomes)
      // Created rows leave; refused ones stay exactly where they are with
      // their text, so a person corrects two rows rather than finding fifty.
      const failedKeys = new Set(response.outcomes.filter((o) => !o.created).map((o) => o.key))
      setRows((current) => {
        const kept = current.filter((r) => isBlankRow(r) || failedKeys.has(r.key))
        return kept.length >= STARTING_ROWS ? kept : [...kept, ...blankRows(STARTING_ROWS - kept.length)]
      })
      setResults({})
    })
  }, [filled, clubId])

  const attentionRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ index, result: results[row.key] }))
        .filter((r) => r.result && r.result.status !== "ready" && r.result.status !== "blank"),
    [rows, results],
  )

  const focusRow = useCallback((index: number) => {
    const input = cellRefs.current.get(`${index}:date`)
    input?.focus()
    input?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [])

  return (
    <div className="flex flex-col gap-2">
      {/* ONE LINE OF CHROME. The grid is the product; a hero, an intro
          paragraph and a card of instructions above it would all be screen
          the season is not using. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/fixtures/management"
            className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="sr-only">Back to the Fixture Control Centre</span>
          </Link>
          <h1 className="truncate font-display text-2xl text-ink">Mass Fixture Planner</h1>
          <p className="hidden truncate text-sm text-ink-muted lg:block">{clubName}</p>
        </div>

        <PlannerToolbar
          checked={checked}
          checking={checking}
          creating={creating}
          tally={tally}
          filledCount={filled.length}
          canUndo={Boolean(undoRows)}
          blocked={massBlocked}
          onCheck={() => check(rows, clubId)}
          onUndo={() => {
            if (!undoRows) return
            setRows(undoRows)
            setUndoRows(null)
            setResults({})
            setOutcomes(null)
          }}
          onCreate={create}
          onAddRows={() => setRows((current) => [...current, ...blankRows(10)])}
          onClearBlank={() => setRows((current) => [...current.filter((r) => !isBlankRow(r)), ...blankRows(10)])}
          onFixtureDay={() => setFixtureDayOpen((v) => !v)}
          fixtureDayOpen={fixtureDayOpen}
          onFile={readFile}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {notice && (
        <p aria-live="polite" className="rounded-lg bg-forest-800/[0.06] px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      {!canCreateMany && (
        <p
          role={massBlocked ? "alert" : undefined}
          className={`rounded-lg px-3 py-2 text-sm ${massBlocked ? "bg-amber-500/10 text-ink" : "bg-ink/[0.04] text-ink-muted"}`}
        >
          {massBlocked
            ? `You have ${filled.length} fixtures here, but you can only create one at a time. `
            : "You can create one fixture at a time here. "}
          Adding several at once needs the Import Fixtures permission, which a club administrator can allow under Club
          Admin &rarr; Permissions.
        </p>
      )}

      {outcomes && <CreationReport outcomes={outcomes} />}
      {fixtureDayOpen && (
        <FixtureDayPanel
          teamOptions={teamOptions}
          venueOptions={venueOptions}
          onGenerate={(generated) => {
            loadRows(generated, `${generated.length} rows added for that fixture day. Edit anything before creating.`)
            setFixtureDayOpen(false)
          }}
          onCancel={() => setFixtureDayOpen(false)}
        />
      )}
      {attentionRows.length > 0 && <ValidationSummary items={attentionRows} onGo={focusRow} />}

      {/* THE WORKSPACE.
          `relative` is load-bearing: without a positioned ancestor an
          absolutely-positioned sr-only label escapes this scroll container
          and drags the whole page sideways. */}
      <div className="relative hidden max-h-[calc(100dvh-13rem)] min-h-[30rem] overflow-auto rounded-lg border border-ink/20 bg-white md:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Fixture planner grid, {rows.length} rows. Paste a block copied from a spreadsheet into any cell to fill
            several rows and columns at once. Structured columns offer canonical options as you type.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-20 w-10 border-r border-b border-ink/20 bg-chalk px-1 py-1.5 text-right text-xs font-medium text-ink-subtle"
              >
                <span className="sr-only">Row number</span>#
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.field}
                  scope="col"
                  className={`group/head sticky top-0 z-10 border-r border-b border-ink/20 bg-chalk px-1.5 py-1.5 text-left text-xs font-medium whitespace-nowrap text-ink ${col.width}`}
                >
                  <span className="flex items-center justify-between gap-1">
                    {col.label}
                    <button
                      type="button"
                      onClick={() => fillDown(col.field)}
                      title={`Fill ${col.label} down`}
                      className="rounded p-0.5 text-ink-subtle opacity-0 outline-none group-hover/head:opacity-100 hover:bg-ink/[0.08] hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <ArrowDown className="size-3" aria-hidden="true" />
                      <span className="sr-only">Fill {col.label} down the column</span>
                    </button>
                  </span>
                </th>
              ))}
              <th scope="col" className="sticky top-0 z-10 w-8 border-b border-ink/20 bg-chalk px-0 py-1.5">
                <span className="sr-only">Remove row</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const result = results[row.key]
              const status = result?.status ?? "blank"
              return (
                <tr key={row.key} className="group">
                  <td className="relative border-r border-b border-ink/12 bg-chalk/50 px-1 text-right align-middle text-xs tabular-nums text-ink-subtle">
                    <span className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_RAIL[status]}`} aria-hidden="true" />
                    {rowIndex + 1}
                    {status !== "blank" && <span className="sr-only"> — {STATUS_WORD[status]}</span>}
                  </td>
                  {COLUMNS.map((col, fieldIndex) => (
                    <td key={col.field} className={`border-r border-b border-ink/12 p-0 ${col.width}`}>
                      <PlannerGridCell
                        column={col}
                        rowIndex={rowIndex}
                        row={row}
                        clubId={clubId}
                        state={result?.cells?.[col.field] ?? "empty"}
                        teamOptions={teamOptions}
                        competitionOptions={competitionOptions}
                        resolution={resolutions[row.key]}
                        onChange={(value) => setCell(rowIndex, row.key, col.field, value)}
                        onResolve={(patch) =>
                          setResolutions((current) => ({
                            ...current,
                            [row.key]: {
                              ...EMPTY_RESOLUTION,
                              ...current[row.key],
                              ...patch,
                            },
                          }))
                        }
                        onPaste={(e) => handlePaste(e, rowIndex, fieldIndex)}
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, fieldIndex)}
                        inputRef={(el) => {
                          const key = `${rowIndex}:${col.field}`
                          if (el) cellRefs.current.set(key, el)
                          else cellRefs.current.delete(key)
                        }}
                      />
                    </td>
                  ))}
                  <td className="border-b border-ink/12 p-0 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) => (current.length <= 1 ? [blankRow()] : current.filter((_, i) => i !== rowIndex)))
                      }
                      className="rounded p-1 text-ink-subtle/0 outline-none group-hover:text-ink-subtle hover:!text-destructive-text focus-visible:text-ink-subtle focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Remove row {rowIndex + 1}</span>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <MobilePlanner
        rows={rows}
        results={results}
        onChange={setCell}
        onRemove={(index) => setRows((c) => (c.length <= 1 ? [blankRow()] : c.filter((_, i) => i !== index)))}
      />

      <datalist id="planner-teams">
        {teamOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="planner-venues">
        {venueOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="planner-competitions">
        {competitionOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  )
}

/**
 * One cell, routed to the right editor for its column.
 *
 * The lookups fetch on demand and are debounced here rather than in the
 * cell, because a cell should not have to know that some of its options
 * come from the server and some are already in the browser.
 */
function PlannerGridCell({
  column,
  rowIndex,
  row,
  clubId,
  state,
  teamOptions,
  competitionOptions,
  resolution,
  onChange,
  onResolve,
  onPaste,
  onKeyDown,
  inputRef,
}: {
  column: Column
  rowIndex: number
  row: PlannerDraftRow
  clubId: string
  state: CellState
  teamOptions: string[]
  competitionOptions: string[]
  resolution?: RowResolution
  onChange: (value: string) => void
  onResolve: (patch: Partial<RowResolution>) => void
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const [options, setOptions] = useState<LookupOption[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const value = row[column.field]

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const runQuery = useCallback(
    (query: string) => {
      if (timer.current) clearTimeout(timer.current)

      // Local lists answer instantly; there is nothing to wait for.
      if (column.lookup === "team" || column.lookup === "competition") {
        const source = column.lookup === "team" ? teamOptions : competitionOptions
        const q = query.trim().toLowerCase()
        setOptions(source.filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 40).map((o) => ({ id: o, label: o })))
        return
      }

      // Loading goes true HERE, not inside the debounce. Otherwise the
      // cell spends the debounce window telling somebody who is still
      // typing that there is no match, then starts looking -- a flash of
      // "no match" is worse than a moment of "searching".
      setLoading(true)
      timer.current = setTimeout(async () => {
        try {
          if (column.lookup === "oppositionClub") {
            const clubs = await searchOppositionClubs(query, clubId)
            setOptions(
              clubs.map((c) => ({
                id: c.id,
                label: c.name,
                hint: c.kind === "ovalball" ? "On Ovalball" : "Club Directory",
              })),
            )
          } else if (column.lookup === "oppositionTeam") {
            setOptions(
              resolution?.oppositionTenantClubId ? await listOppositionTeams(resolution.oppositionTenantClubId, clubId) : [],
            )
          } else if (column.lookup === "venue") {
            setOptions(await searchVenues(query, row.homeAway, resolution?.oppositionDirectoryId ?? null, clubId))
          } else if (column.lookup === "pitch") {
            setOptions(await listPitches(resolution?.venueId ?? null, clubId))
          }
        } finally {
          setLoading(false)
        }
      }, 180)
    },
    [column.lookup, teamOptions, competitionOptions, clubId, resolution, row.homeAway],
  )

  const label = `${column.label}, row ${rowIndex + 1}`

  if (!column.lookup) {
    return (
      <PlainCell
        value={value}
        onChange={onChange}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        inputRef={inputRef}
        label={label}
        placeholder={rowIndex === 0 ? column.hint : undefined}
        state={state}
      />
    )
  }

  return (
    <LookupCell
      value={value}
      onChange={onChange}
      onCommit={(option) => {
        // Remembering WHICH record was chosen is what lets the next cell
        // narrow itself -- their teams, their ground, that ground's pitches.
        if (column.lookup === "oppositionClub") {
          onResolve({
            oppositionDirectoryId: option.id,
            oppositionTenantClubId: option.hint === "On Ovalball" ? option.id : null,
          })
        } else if (column.lookup === "venue") {
          onResolve({ venueId: option.id })
        }
      }}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      inputRef={inputRef}
      label={label}
      placeholder={rowIndex === 0 ? column.hint : undefined}
      state={state}
      options={options}
      loading={loading}
      onQuery={runQuery}
      emptyHint={
        column.lookup === "oppositionTeam"
          ? "Pick an Ovalball opposition club first, or leave this blank for an external opponent."
          : column.lookup === "pitch"
            ? "Pick a venue first to see its pitches."
            : column.lookup === "oppositionClub"
              ? "Keep typing — opponents come from Ovalball clubs and the Club Directory."
              : undefined
      }
    />
  )
}

/**
 * The toolbar: what state the season is in, and the one action that ends
 * the job. Compact on purpose -- every millimetre here is a row of the
 * grid somebody cannot see.
 */
function PlannerToolbar({
  checked,
  checking,
  creating,
  tally,
  filledCount,
  canUndo,
  blocked,
  onCheck,
  onUndo,
  onCreate,
  onAddRows,
  onClearBlank,
  onFixtureDay,
  fixtureDayOpen,
  onFile,
}: {
  checked: boolean
  checking: boolean
  creating: boolean
  tally: { ready: number; attention: number; requests: number }
  filledCount: number
  canUndo: boolean
  blocked: boolean
  onCheck: () => void
  onUndo: () => void
  onCreate: () => void
  onAddRows: () => void
  onClearBlank: () => void
  onFixtureDay: () => void
  fixtureDayOpen: boolean
  onFile: (file: File) => void
}) {
  const ghost =
    "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <p aria-live="polite" className="mr-1 flex flex-wrap items-center gap-x-2.5 text-sm">
        {!checked || checking ? (
          <span className="text-ink-muted">
            {checking
              ? `Matching ${filledCount} row${filledCount === 1 ? "" : "s"}…`
              : filledCount === 0
                ? "Paste or type to begin."
                : `${filledCount} row${filledCount === 1 ? "" : "s"} not checked yet.`}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 font-medium text-forest-800">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {tally.ready} ready
            </span>
            {tally.attention > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-900">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {tally.attention} need attention
              </span>
            )}
            {tally.requests > 0 && (
              <span className="inline-flex items-center gap-1 text-ink-muted">
                <Send className="size-3.5" aria-hidden="true" />
                {tally.requests} sent as requests
              </span>
            )}
          </>
        )}
      </p>

      <button type="button" onClick={onFixtureDay} aria-expanded={fixtureDayOpen} className={ghost}>
        <CalendarDays className="size-4" aria-hidden="true" />
        Fixture Day
      </button>
      <label className={`${ghost} cursor-pointer`}>
        <Upload className="size-4" aria-hidden="true" />
        Upload CSV
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ""
          }}
        />
      </label>
      <button type="button" onClick={downloadTemplate} className={ghost}>
        <Download className="size-4" aria-hidden="true" />
        Template
      </button>
      <button type="button" onClick={onAddRows} className={ghost}>
        <Plus className="size-4" aria-hidden="true" />
        Add Rows
      </button>
      <button type="button" onClick={onClearBlank} className={ghost}>
        <Eraser className="size-4" aria-hidden="true" />
        Clear Blank Rows
      </button>
      {canUndo && (
        <button type="button" onClick={onUndo} className={ghost}>
          <Undo2 className="size-4" aria-hidden="true" />
          Undo Paste
        </button>
      )}

      <span className="ml-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCheck}
          disabled={checking || filledCount === 0}
          className="inline-flex min-h-9 items-center rounded-md border border-ink/20 px-3 text-sm font-medium text-ink outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check Rows"}
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating || blocked || !checked || tally.ready === 0}
          className="inline-flex min-h-9 items-center rounded-md bg-forest-800 px-3.5 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {creating ? "Creating…" : tally.ready > 0 ? `Create ${tally.ready} Fixture${tally.ready === 1 ? "" : "s"}` : "Create Fixtures"}
        </button>
      </span>
    </div>
  )
}

/**
 * FIXTURE DAY.
 *
 * One opponent, one Saturday, several age grades -- the most common thing
 * a mini-and-junior secretary does all season, and six near-identical rows
 * to type. It is NOT a wizard and it creates nothing: it writes rows into
 * the grid and closes, and everything after that is the ordinary planner,
 * because a fixture arranged this way is an ordinary fixture.
 */
function FixtureDayPanel({
  teamOptions,
  venueOptions,
  onGenerate,
  onCancel,
}: {
  teamOptions: string[]
  venueOptions: string[]
  onGenerate: (rows: PlannerDraftRow[]) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState("")
  const [opposition, setOpposition] = useState("")
  const [venue, setVenue] = useState(venueOptions[0] ?? "")
  const [homeAway, setHomeAway] = useState("Home")
  const [firstKickoff, setFirstKickoff] = useState("10:00")
  const [gap, setGap] = useState("45")
  const [teams, setTeams] = useState<string[]>([])
  const field =
    "min-h-9 rounded-md border border-ink/20 px-2 text-sm font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"

  return (
    <section aria-label="Fixture Day" className="rounded-lg border border-ink/15 bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Opposition Club
          <input
            value={opposition}
            onChange={(e) => setOpposition(e.target.value)}
            placeholder="Their club's full name"
            className={`${field} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Home or Away
          <select value={homeAway} onChange={(e) => setHomeAway(e.target.value)} className={`${field} bg-white`}>
            <option>Home</option>
            <option>Away</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Venue
          <input value={venue} onChange={(e) => setVenue(e.target.value)} list="planner-venues" className={`${field} w-44`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          First Kick Off
          <input type="time" value={firstKickoff} onChange={(e) => setFirstKickoff(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Minutes Between
          <input
            type="number"
            min={0}
            step={5}
            value={gap}
            onChange={(e) => setGap(e.target.value)}
            className={`${field} w-24`}
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-ink">Which of your teams are playing?</legend>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {teamOptions.map((team) => {
            const on = teams.includes(team)
            return (
              <button
                key={team}
                type="button"
                aria-pressed={on}
                onClick={() => setTeams((current) => (on ? current.filter((t) => t !== team) : [...current, team]))}
                className={`min-h-8 rounded-full px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                  on ? "bg-forest-800 text-white" : "border border-ink/20 text-ink hover:bg-ink/[0.04]"
                }`}
              >
                {team}
              </button>
            )
          })}
        </div>
        {teamOptions.length === 0 && <p className="mt-1.5 text-sm text-ink-muted">This club has no active teams yet.</p>}
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!(date && opposition && teams.length > 0)}
          onClick={() =>
            onGenerate(
              fixtureDayRows({
                date,
                oppositionClub: opposition,
                venue,
                homeAway,
                firstKickoff,
                minutesBetween: Number(gap) || 0,
                teams,
              }),
            )
          }
          className="inline-flex min-h-9 items-center rounded-md bg-forest-800 px-3.5 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Continue to Planner{teams.length > 0 ? ` (${teams.length} rows)` : ""}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

/** Every row that is not ready, named, with the reason and a way to it. */
function ValidationSummary({
  items,
  onGo,
}: {
  items: { index: number; result?: PlannerRowResult }[]
  onGo: (index: number) => void
}) {
  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
      <h2 className="text-sm font-medium text-ink">
        {items.length === 1
          ? "1 row needs attention before it can be created"
          : `${items.length} rows need attention before they can be created`}
      </h2>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.slice(0, 8).map(({ index, result }) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <button
              type="button"
              onClick={() => onGo(index)}
              className="shrink-0 rounded font-medium text-forest-800 underline underline-offset-2 outline-none hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Row {index + 1}
            </button>
            <span className="text-ink-muted">{result?.errors[0] ?? STATUS_WORD[result?.status ?? "blank"]}</span>
          </li>
        ))}
        {items.length > 8 && <li className="text-sm text-ink-subtle">…and {items.length - 8} more.</li>}
      </ul>
    </section>
  )
}

/** What actually happened, per row, including the rows that did not make it. */
function CreationReport({ outcomes }: { outcomes: PlannerCreateOutcome[] }) {
  const created = outcomes.filter((o) => o.created)
  const requested = created.filter((o) => o.requested).length
  const failed = outcomes.filter((o) => !o.created)

  return (
    <section aria-live="polite" className="rounded-lg border border-pitch-600/30 bg-pitch-600/[0.06] px-3 py-2.5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
        <CheckCircle2 className="size-4 text-forest-800" aria-hidden="true" />
        {created.length} fixture{created.length === 1 ? "" : "s"} created
        {requested > 0 && `, ${requested} sent to the opposition as a request`}
      </h2>
      {failed.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-ink-muted">
            {failed.length} row{failed.length === 1 ? " was" : "s were"} not created and{" "}
            {failed.length === 1 ? "is" : "are"} still in the grid below, with what went wrong.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-muted">
            {failed.slice(0, 6).map((o) => (
              <li key={o.key}>{o.error}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">
          Everything went in. They are on the{" "}
          <Link href="/fixtures/management" className="font-medium text-forest-800 underline underline-offset-2">
            Fixture Control Centre
          </Link>{" "}
          and the Calendar now.
        </p>
      )}
    </section>
  )
}

/**
 * THE SAME ROWS, ON A PHONE.
 *
 * An eleven-column grid on a 390px screen is a grid nobody can use, and a
 * horizontally scrolling spreadsheet on a touch screen is worse than none.
 * The mass case genuinely belongs on a desktop -- but a secretary on a
 * touchline adding two fixtures should not be told to go home, so the same
 * rows appear as cards, sharing one state and one creation path.
 */
function MobilePlanner({
  rows,
  results,
  onChange,
  onRemove,
}: {
  rows: PlannerDraftRow[]
  results: Record<string, PlannerRowResult>
  onChange: (rowIndex: number, rowKey: string, field: PlannerField, value: string) => void
  onRemove: (rowIndex: number) => void
}) {
  const firstBlank = rows.findIndex((r) => isBlankRow(r))
  const shown = rows.map((row, index) => ({ row, index })).filter(({ row }, i) => !isBlankRow(row) || i === firstBlank)

  return (
    <div className="flex flex-col gap-2.5 md:hidden">
      {shown.map(({ row, index }) => {
        const result = results[row.key]
        return (
          <article key={row.key} className="rounded-lg border border-ink/15 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium tracking-[0.06em] text-ink-subtle uppercase">Fixture {index + 1}</h3>
              <span className="flex items-center gap-2">
                {result && result.status !== "blank" && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      result.status === "ready" ? "bg-pitch-600/15 text-forest-800" : "bg-amber-500/15 text-amber-900"
                    }`}
                  >
                    {STATUS_WORD[result.status]}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="rounded p-2 text-ink-subtle outline-none hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">Remove fixture {index + 1}</span>
                </button>
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              {COLUMNS.map((col) => (
                <label
                  key={col.field}
                  className={`flex flex-col gap-1 text-xs font-medium text-ink ${
                    col.field === "notes" || col.field === "ourTeam" || col.field === "oppositionClub" ? "col-span-2" : ""
                  }`}
                >
                  {col.label}
                  <input
                    value={row[col.field]}
                    onChange={(e) => onChange(index, row.key, col.field, e.target.value)}
                    placeholder={col.hint}
                    list={
                      col.lookup === "team"
                        ? "planner-teams"
                        : col.lookup === "venue"
                          ? "planner-venues"
                          : col.lookup === "competition"
                            ? "planner-competitions"
                            : undefined
                    }
                    aria-invalid={result?.cells?.[col.field] === "error" || undefined}
                    className={`min-h-11 rounded-lg border px-2.5 text-sm font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      result?.cells?.[col.field] === "error" ? "border-destructive/50 bg-destructive/[0.06]" : "border-ink/20"
                    }`}
                  />
                </label>
              ))}
            </div>

            {result && result.errors.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-1 text-xs text-amber-900">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
    </div>
  )
}
