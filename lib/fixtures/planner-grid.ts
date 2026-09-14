/**
 * THE PLANNER GRID'S SPREADSHEET BEHAVIOUR, AS PURE FUNCTIONS.
 *
 * Selection, fill, copy, paste, clear and row removal are all arithmetic over
 * the one draft-row model in planner-model.ts. Keeping them here -- free of
 * React, free of the DOM, free of `server-only` -- means the rules a fixture
 * secretary relies on ("dragging Hinckley / Nuneaton down four rows repeats
 * the pair") are provable without a browser, and the component that renders
 * the grid has no arithmetic of its own to drift.
 *
 * NONE OF THIS VALIDATES. A filled, pasted or cleared cell is text, exactly as
 * a typed one is, and it goes through the same server-side canonical matching
 * before anything becomes a fixture. The internal clipboard is not trusted
 * more than Excel's.
 */

import { PLANNER_FIELDS, blankRow, blankRows, isBlankRow, type PlannerDraftRow, type PlannerField } from "./planner-model"

export interface CellPos {
  row: number
  col: number
}

/** A rectangle, inclusive on every edge. */
export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * The selection a spreadsheet has: the ACTIVE cell (anchor, where typing
 * goes) and the opposite corner (focus, where Shift+arrow moves).
 */
export interface GridSelection {
  anchor: CellPos
  focus: CellPos
}

export const COLUMN_COUNT = PLANNER_FIELDS.length

export function cellSelection(row: number, col: number): GridSelection {
  return { anchor: { row, col }, focus: { row, col } }
}

export function rangeOf(sel: GridSelection): CellRange {
  return {
    top: Math.min(sel.anchor.row, sel.focus.row),
    bottom: Math.max(sel.anchor.row, sel.focus.row),
    left: Math.min(sel.anchor.col, sel.focus.col),
    right: Math.max(sel.anchor.col, sel.focus.col),
  }
}

export function rangeHeight(r: CellRange): number {
  return r.bottom - r.top + 1
}

export function rangeWidth(r: CellRange): number {
  return r.right - r.left + 1
}

export function inRange(r: CellRange, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right
}

export function isSingleCell(r: CellRange): boolean {
  return r.top === r.bottom && r.left === r.right
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Arrow keys, Tab and Enter. A plain move collapses the selection onto the new
 * active cell; an extending move (Shift) keeps the anchor and moves the focus.
 */
export function moveSelection(
  sel: GridSelection,
  dRow: number,
  dCol: number,
  rowCount: number,
  extend: boolean,
): GridSelection {
  if (extend) {
    return {
      anchor: sel.anchor,
      focus: {
        row: clamp(sel.focus.row + dRow, 0, rowCount - 1),
        col: clamp(sel.focus.col + dCol, 0, COLUMN_COUNT - 1),
      },
    }
  }
  const row = clamp(sel.anchor.row + dRow, 0, rowCount - 1)
  const col = clamp(sel.anchor.col + dCol, 0, COLUMN_COUNT - 1)
  return cellSelection(row, col)
}

/** Every row a set of selected row numbers or a range covers, ascending. */
export function rowsCovered(r: CellRange): number[] {
  return Array.from({ length: rangeHeight(r) }, (_, i) => r.top + i)
}

function fieldAt(col: number): PlannerField | null {
  return PLANNER_FIELDS[col] ?? null
}

/** Grows the grid downward to `needed` rows without touching existing ones. */
export function ensureRows(rows: PlannerDraftRow[], needed: number): PlannerDraftRow[] {
  if (rows.length >= needed) return rows
  return [...rows, ...blankRows(needed - rows.length)]
}

// ---------------------------------------------------------------------------
// COPY
// ---------------------------------------------------------------------------

/**
 * One cell, serialised the way Excel and Google Sheets expect: a value that
 * contains a tab, a newline or a double quote is wrapped in quotes with its
 * own quotes doubled. parseClipboardGrid reads exactly this back.
 */
function tsvCell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A rectangle as tab/newline text. */
export function rangeToTsv(rows: PlannerDraftRow[], r: CellRange): string {
  const lines: string[] = []
  for (let row = r.top; row <= r.bottom; row++) {
    const cells: string[] = []
    for (let col = r.left; col <= r.right; col++) {
      const field = fieldAt(col)
      cells.push(tsvCell(field ? (rows[row]?.[field] ?? "") : ""))
    }
    lines.push(cells.join("\t"))
  }
  return lines.join("\n")
}

/** Whole rows, which need not be contiguous, in grid order. */
export function rowsToTsv(rows: PlannerDraftRow[], rowIndexes: number[]): string {
  return [...rowIndexes]
    .sort((a, b) => a - b)
    .map((i) => PLANNER_FIELDS.map((f) => tsvCell(rows[i]?.[f] ?? "")).join("\t"))
    .join("\n")
}

/** A rectangle as a 2-D array of values, for the internal clipboard. */
export function rangeValues(rows: PlannerDraftRow[], r: CellRange): string[][] {
  const out: string[][] = []
  for (let row = r.top; row <= r.bottom; row++) {
    const line: string[] = []
    for (let col = r.left; col <= r.right; col++) {
      const field = fieldAt(col)
      line.push(field ? (rows[row]?.[field] ?? "") : "")
    }
    out.push(line)
  }
  return out
}

// ---------------------------------------------------------------------------
// PASTE
// ---------------------------------------------------------------------------

export interface PasteOutcome {
  rows: PlannerDraftRow[]
  /** The cells that were written, so the grid can select what just arrived. */
  written: CellRange
}

/**
 * Pastes a block into a selection, by spreadsheet convention:
 *
 *  - ONE value into a larger selection fills every selected cell.
 *  - A block whose height and width divide the selection's exactly is TILED
 *    across it (Excel's rule), so a copied pair pasted into six rows repeats.
 *  - Anything else keeps its own geometry and is written from the selection's
 *    top-left, growing the grid downward and clipping at the right-hand edge.
 *    Clipping, not wrapping: eleven columns pasted into Venue meant to be
 *    pasted somewhere else, and wrapping them onto the next fixture would be a
 *    mess to unpick.
 */
export function pasteBlock(rows: PlannerDraftRow[], target: CellRange, block: string[][]): PasteOutcome {
  const bh = block.length
  const bw = Math.max(0, ...block.map((line) => line.length))
  if (bh === 0 || bw === 0) return { rows, written: target }

  const th = rangeHeight(target)
  const tw = rangeWidth(target)
  const tiles = (th > bh || tw > bw) && th % bh === 0 && tw % bw === 0

  const written: CellRange = tiles
    ? target
    : {
        top: target.top,
        left: target.left,
        bottom: target.top + bh - 1,
        right: Math.min(COLUMN_COUNT - 1, target.left + bw - 1),
      }

  const next = ensureRows(rows, written.bottom + 1).map((r, i) =>
    i >= written.top && i <= written.bottom ? { ...r } : r,
  )
  for (let row = written.top; row <= written.bottom; row++) {
    const line = block[(row - written.top) % bh]
    for (let col = written.left; col <= written.right; col++) {
      const field = fieldAt(col)
      if (!field) continue
      next[row][field] = line[(col - written.left) % bw] ?? ""
    }
  }
  return { rows: next, written }
}

// ---------------------------------------------------------------------------
// FILL
// ---------------------------------------------------------------------------

/**
 * Where a fill handle dragged from `source` to `pointer` ends up.
 *
 * A fill goes in one direction: whichever axis the pointer has left the source
 * along furthest. Diagonal fills are not a thing a spreadsheet does, and
 * guessing at one would write cells nobody pointed at.
 */
export function fillTarget(source: CellRange, pointer: CellPos): CellRange | null {
  const below = pointer.row - source.bottom
  const above = source.top - pointer.row
  const right = pointer.col - source.right
  const left = source.left - pointer.col
  const vertical = Math.max(below, above)
  const horizontal = Math.max(right, left)
  if (vertical <= 0 && horizontal <= 0) return null
  if (vertical >= horizontal) {
    return below > 0 ? { ...source, bottom: pointer.row } : { ...source, top: pointer.row }
  }
  return right > 0
    ? { ...source, right: Math.min(COLUMN_COUNT - 1, pointer.col) }
    : { ...source, left: Math.max(0, pointer.col) }
}

/**
 * Repeats the source's PATTERN across the target, which contains it.
 *
 * Hinckley / Nuneaton dragged four rows further reads Hinckley, Nuneaton,
 * Hinckley, Nuneaton -- the cells repeat in order, in either direction.
 * Values are copied exactly: a date is repeated, never incremented. The
 * planner has never done date arithmetic, and a fill that quietly moved a
 * fixture a week would be the worst kind of helpful.
 */
export function fillRange(rows: PlannerDraftRow[], source: CellRange, target: CellRange): PlannerDraftRow[] {
  const sh = rangeHeight(source)
  const sw = rangeWidth(source)
  const values = rangeValues(rows, source)
  const next = ensureRows(rows, target.bottom + 1).map((r, i) =>
    i >= target.top && i <= target.bottom ? { ...r } : r,
  )
  const mod = (n: number, m: number) => ((n % m) + m) % m
  for (let row = target.top; row <= target.bottom; row++) {
    for (let col = target.left; col <= target.right; col++) {
      if (inRange(source, row, col)) continue
      const field = fieldAt(col)
      if (!field) continue
      next[row][field] = values[mod(row - source.top, sh)][mod(col - source.left, sw)]
    }
  }
  return next
}

/**
 * Fill Down, as Ctrl+D does it: the top row of the selection is copied into
 * every row beneath it. A single-row selection takes the row above instead, so
 * the command still means something on one cell.
 */
export function fillDown(rows: PlannerDraftRow[], r: CellRange): { rows: PlannerDraftRow[]; changed: boolean } {
  if (rangeHeight(r) === 1) {
    if (r.top === 0) return { rows, changed: false }
    const source = { ...r, top: r.top - 1, bottom: r.top - 1 }
    return { rows: fillRange(rows, source, { ...r, top: r.top - 1 }), changed: true }
  }
  return { rows: fillRange(rows, { ...r, bottom: r.top }, r), changed: true }
}

/** Fill Right, as Ctrl+R does it: the left column copied across the selection. */
export function fillRight(rows: PlannerDraftRow[], r: CellRange): { rows: PlannerDraftRow[]; changed: boolean } {
  if (rangeWidth(r) === 1) {
    if (r.left === 0) return { rows, changed: false }
    const source = { ...r, left: r.left - 1, right: r.left - 1 }
    return { rows: fillRange(rows, source, { ...r, left: r.left - 1 }), changed: true }
  }
  return { rows: fillRange(rows, { ...r, right: r.left }, r), changed: true }
}

// ---------------------------------------------------------------------------
// CLEAR AND DELETE
// ---------------------------------------------------------------------------

/**
 * Clear Contents: the cells go blank, the rows stay where they are.
 *
 * Every planner field is clearable. A draft row is text until it is created,
 * and an empty required cell is reported by validation, not refused here.
 */
export function clearRange(rows: PlannerDraftRow[], r: CellRange): PlannerDraftRow[] {
  return rows.map((row, i) => {
    if (i < r.top || i > r.bottom) return row
    const next = { ...row }
    for (let col = r.left; col <= r.right; col++) {
      const field = fieldAt(col)
      if (field) next[field] = ""
    }
    return next
  })
}

export function clearRows(rows: PlannerDraftRow[], rowIndexes: Iterable<number>): PlannerDraftRow[] {
  const set = new Set(rowIndexes)
  return rows.map((row, i) => (set.has(i) ? { ...blankRow(), key: row.key } : row))
}

/**
 * Delete Selected Rows: the rows leave and everything below moves up.
 *
 * THE BLANK POOL IS PRESERVED. The grid opens with a working set of empty rows
 * so nobody has to press Add Row before they can type, and deleting ten rows
 * must not leave a grid of fifteen. The removed capacity comes back as blank
 * rows at the bottom. Nothing here touches a created fixture -- a draft row is
 * never a fixture, and removing one deletes nothing persisted.
 */
export function deleteRows(rows: PlannerDraftRow[], rowIndexes: Iterable<number>, minimumRows: number): PlannerDraftRow[] {
  const set = new Set(rowIndexes)
  const kept = rows.filter((_, i) => !set.has(i))
  return kept.length >= minimumRows ? kept : [...kept, ...blankRows(minimumRows - kept.length)]
}

/** True when any cell in the range holds text -- used to enable Clear Contents honestly. */
export function rangeHasContent(rows: PlannerDraftRow[], r: CellRange): boolean {
  for (let row = r.top; row <= r.bottom; row++) {
    for (let col = r.left; col <= r.right; col++) {
      const field = fieldAt(col)
      if (field && rows[row]?.[field]) return true
    }
  }
  return false
}

export function rowsHaveContent(rows: PlannerDraftRow[], rowIndexes: Iterable<number>): boolean {
  for (const i of rowIndexes) if (rows[i] && !isBlankRow(rows[i])) return true
  return false
}

// ---------------------------------------------------------------------------
// ROW-NUMBER SELECTION
// ---------------------------------------------------------------------------

/**
 * Clicking row numbers, as a spreadsheet does: a plain click selects that row,
 * Shift extends contiguously from the last clicked row, Cmd/Ctrl toggles one
 * row in or out.
 */
export function selectRows(
  current: number[],
  lastClicked: number | null,
  clicked: number,
  mode: "replace" | "extend" | "toggle",
): number[] {
  if (mode === "toggle") {
    return current.includes(clicked) ? current.filter((r) => r !== clicked) : [...current, clicked].sort((a, b) => a - b)
  }
  if (mode === "extend" && lastClicked !== null) {
    const lo = Math.min(lastClicked, clicked)
    const hi = Math.max(lastClicked, clicked)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }
  return [clicked]
}

/** The bounding range of selected rows, full width. */
export function rowsRange(rowIndexes: number[]): CellRange | null {
  if (rowIndexes.length === 0) return null
  return { top: Math.min(...rowIndexes), bottom: Math.max(...rowIndexes), left: 0, right: COLUMN_COUNT - 1 }
}

/** True when a set of row indexes has no gaps -- only then is it a rectangle. */
export function rowsContiguous(rowIndexes: number[]): boolean {
  if (rowIndexes.length === 0) return false
  const sorted = [...rowIndexes].sort((a, b) => a - b)
  return sorted[sorted.length - 1] - sorted[0] + 1 === sorted.length
}

// ---------------------------------------------------------------------------
// UNDO
// ---------------------------------------------------------------------------

export interface UndoEntry {
  /** What the person did, named for the Undo control: "Paste", "Fill", "Clear", "Delete Rows". */
  label: string
  rows: PlannerDraftRow[]
}

export const UNDO_LIMIT = 50

/** Pushes the grid as it was BEFORE a bulk operation. Each bulk operation is one entry. */
export function pushUndo(stack: UndoEntry[], label: string, before: PlannerDraftRow[]): UndoEntry[] {
  const next = [...stack, { label, rows: before }]
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next
}
