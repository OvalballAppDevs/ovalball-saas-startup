/**
 * IMPORT FIXTURES: WHAT A FILE'S COLUMNS MEAN.
 *
 * Importing is a different job from planning. The Season Planner is a grid a
 * person types a season into; an import is a file somebody else made -- a
 * league's export, last season's spreadsheet -- whose columns have to be
 * understood before a single row is checked. So the import says what it
 * thinks each column is, lets the person correct that, and only then turns
 * rows into the same draft rows the planner uses. One row model, one
 * validation, one staging and publishing pipeline; two front doors.
 *
 * Pure and browser-safe: the wizard maps in the browser, the server validates.
 */

import { parseClipboardGrid, plannerFieldForHeader, blankRow, isBlankRow, type PlannerDraftRow, type PlannerField } from "./planner-model"

export interface ImportTarget {
  field: PlannerField
  label: string
  required: boolean
}

export const IMPORT_TARGETS: ImportTarget[] = [
  { field: "date", label: "Date", required: true },
  { field: "kickoff", label: "Kick Off", required: false },
  { field: "meet", label: "Meet", required: false },
  { field: "homeAway", label: "H/A", required: false },
  { field: "ourTeam", label: "Our Team", required: true },
  { field: "oppositionClub", label: "Opposition Club", required: true },
  { field: "oppositionTeam", label: "Opposition Team", required: false },
  { field: "fixtureType", label: "Type", required: false },
  { field: "competition", label: "Competition", required: false },
  { field: "venue", label: "Venue", required: false },
  { field: "pitch", label: "Pitch", required: false },
  { field: "notes", label: "Notes", required: false },
]

export const IMPORT_ROW_LIMIT = 500

/** Rows and cells from pasted or uploaded text: tab-separated when it has tabs, CSV otherwise. */
export function tableFromText(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ""
  const rows = firstLine.includes("\t") ? parseClipboardGrid(text) : parseCsvGrid(text)
  return trimTable(rows)
}

function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const s = text.replace(/\r\n?/g, "\n")
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === "") quoted = true
    else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** Drops empty rows at the ends and a byte-order mark, and makes every row as wide as the widest. */
export function trimTable(rows: string[][]): string[][] {
  const out = rows.map((r) => r.map((c) => c.replace(/^﻿/, "")))
  while (out.length > 0 && out[out.length - 1].every((c) => !c.trim())) out.pop()
  while (out.length > 0 && out[0].every((c) => !c.trim())) out.shift()
  const width = Math.max(0, ...out.map((r) => r.length))
  return out.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()))
}

/**
 * Whether the first row is headings. It is when any cell names a column
 * Ovalball knows; a first row of fixtures reads as dates and team names, and
 * none of those is a heading.
 */
export function looksLikeHeader(first: string[]): boolean {
  return first.some((c) => plannerFieldForHeader(c) !== null)
}

/** A first guess at each column's meaning. Each field is claimed once, by the first column that means it. */
export function guessMapping(headers: string[]): (PlannerField | null)[] {
  const taken = new Set<PlannerField>()
  return headers.map((h) => {
    const f = plannerFieldForHeader(h)
    if (!f || taken.has(f)) return null
    taken.add(f)
    return f
  })
}

export interface MappingProblem {
  kind: "missing" | "duplicate"
  field: PlannerField
  message: string
}

export function mappingProblems(mapping: (PlannerField | null)[]): MappingProblem[] {
  const problems: MappingProblem[] = []
  const counts = new Map<PlannerField, number>()
  for (const f of mapping) if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
  for (const t of IMPORT_TARGETS) {
    const n = counts.get(t.field) ?? 0
    if (t.required && n === 0) problems.push({ kind: "missing", field: t.field, message: `Choose which column is ${t.label}.` })
    if (n > 1) problems.push({ kind: "duplicate", field: t.field, message: `${t.label} is chosen for ${n} columns. Choose it for one.` })
  }
  return problems
}

/** The file's rows as draft rows, through the chosen mapping. Unmapped columns are left out, blank rows dropped. */
export function mappedRows(body: string[][], mapping: (PlannerField | null)[]): PlannerDraftRow[] {
  const rows: PlannerDraftRow[] = []
  for (const cells of body) {
    const row = blankRow()
    mapping.forEach((field, i) => {
      if (field && !row[field]) row[field] = (cells[i] ?? "").trim()
    })
    if (!isBlankRow(row)) rows.push(row)
  }
  return rows
}
