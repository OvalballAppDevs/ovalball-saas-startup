"use client"

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ArrowDown } from "lucide-react"

import {
  exactEntry,
  buildLookupIndex,
  type LookupEntry,
} from "@/lib/fixtures/planner-lookup"
import {
  COLUMN_COUNT,
  cellSelection,
  clearRange,
  clearRows,
  deleteRows,
  fillDown,
  fillRange,
  fillRight,
  fillTarget,
  inRange,
  isSingleCell,
  moveSelection,
  pasteBlock,
  rangeHasContent,
  rangeHeight,
  rangeOf,
  rangeToTsv,
  rangeValues,
  rangeWidth,
  rowsContiguous,
  rowsCovered,
  rowsHaveContent,
  rowsRange,
  rowsToTsv,
  selectRows,
  type CellPos,
  type CellRange,
  type GridSelection,
} from "@/lib/fixtures/planner-grid"
import {
  PLANNER_FIELDS,
  parseClipboardGrid,
  type CellState,
  type PlannerDraftRow,
  type PlannerField,
  type PlannerRowResult,
} from "@/lib/fixtures/planner-model"

import { LookupCell, PlainCell, SUGGESTED_NOTE_ID } from "./planner-cells"
import {
  LOOKUP_BY_FIELD,
  type LookupAnswer,
  type LookupKind,
} from "./use-planner-lookups"

/**
 * THE GRID, AS A SPREADSHEET.
 *
 * A fixture secretary's muscle memory is Excel's: click a cell, drag a range,
 * Shift+arrow to widen it, drag the corner to fill, Ctrl+C and Ctrl+V between
 * this and the sheet the season came from, right-click for the rest. This
 * component is that, and nothing about it is a form.
 *
 * TWO MODES, AS IN EVERY SPREADSHEET. Selection mode: arrows move, Delete
 * clears, typing starts an edit. Edit mode: the cell is a text box, and Enter,
 * Tab or Escape leave it. The active cell's <input> holds real focus in both,
 * so the browser's own clipboard, IME and screen-reader support keep working.
 *
 * NOTHING HERE DECIDES WHAT A VALUE MEANS. Fill, paste, clear and delete are
 * arithmetic over draft rows (lib/fixtures/planner-grid.ts); every resulting
 * row is still checked on the server by the one canonical engine before it
 * becomes a fixture, however the text got there.
 */

export interface Column {
  field: PlannerField
  label: string
  width: string
  hint?: string
}

/** The creation grid carries what data entry needs -- Meet and Pitch included. */
export const COLUMNS: Column[] = [
  { field: "date", label: "Date", width: "w-[7.5rem]", hint: "14/08/27" },
  { field: "kickoff", label: "Kick Off", width: "w-[5.5rem]", hint: "11:00" },
  { field: "meet", label: "Meet", width: "w-[5.5rem]", hint: "10:15" },
  { field: "homeAway", label: "H/A", width: "w-[5rem]", hint: "H" },
  { field: "ourTeam", label: "Our Team", width: "w-52" },
  { field: "oppositionClub", label: "Opposition Club", width: "w-56" },
  { field: "oppositionTeam", label: "Opposition Team", width: "w-44" },
  { field: "competition", label: "Competition", width: "w-44" },
  { field: "venue", label: "Venue", width: "w-48" },
  { field: "pitch", label: "Pitch", width: "w-36" },
  { field: "notes", label: "Notes", width: "w-44" },
  { field: "fixtureType", label: "Type", width: "w-28", hint: "Friendly" },
]

const STATUS_RAIL: Record<PlannerRowResult["status"], string> = {
  blank: "bg-transparent",
  ready: "bg-pitch-600",
  review: "bg-amber-500",
  conflict: "bg-sky-500",
  invalid: "bg-destructive",
}

export const STATUS_WORD: Record<PlannerRowResult["status"], string> = {
  blank: "",
  ready: "Ready",
  review: "Needs a look",
  conflict: "Clash",
  invalid: "Not readable",
}

const LIST_ROOM = 272

type EditSource = "type" | "f2" | "click"

interface EditState {
  row: number
  col: number
  original: string
  source: EditSource
}

interface OpenList {
  row: number
  col: number
  /** False until the person types: an opened list shows everything, a typed one filters. */
  queryActive: boolean
  highlight: number
  dropUp: boolean
}

interface MenuState {
  x: number
  y: number
}

type Drag =
  | {
      kind: "cells"
      start: CellPos
      moved: boolean
      pointerType: string
      shift: boolean
      col: number
    }
  | { kind: "rows"; from: number; pointerType: string }
  | { kind: "fill"; source: CellRange; target: CellRange | null }

export interface GridBulkOptions {
  /** Re-check every row against canonical records once applied -- what a paste has always done. */
  check?: boolean
  notice?: string
}

export interface PlannerGridProps {
  rows: PlannerDraftRow[]
  results: Record<string, PlannerRowResult>
  minimumRows: number
  answer: (
    kind: LookupKind,
    row: PlannerDraftRow,
    query: string
  ) => LookupAnswer
  remember: (kind: LookupKind, label: string) => void
  pitchCompatible: (row: PlannerDraftRow) => boolean
  undoLabel: string | null
  onCellChange: (rowIndex: number, field: PlannerField, value: string) => void
  onBulk: (
    label: string,
    next: PlannerDraftRow[],
    options?: GridBulkOptions
  ) => void
  onUndo: () => void
  onNotice: (message: string) => void
  onFillColumn: (field: PlannerField) => void
  /** Cells holding a suggestion nobody has typed over, by row key: "oppositionTeam,venue". */
  suggestions?: Record<string, string>
}

function cellKey(row: number, col: number) {
  return `${row}:${col}`
}

function isMac() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  )
}

export function PlannerGrid(props: PlannerGridProps) {
  const { rows, results, minimumRows } = props
  const [rawSel, setSel] = useState<GridSelection>(() => cellSelection(0, 0))
  const [rawSelectedRows, setSelectedRows] = useState<number[]>([])
  const [editing, setEditing] = useState<EditState | null>(null)
  const [open, setOpen] = useState<OpenList | null>(null)
  const [fillPreview, setFillPreview] = useState<CellRange | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [announcement, setAnnouncement] = useState("")

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef(new Map<string, HTMLInputElement>())
  const clipboard = useRef<{ text: string; block: string[][] } | null>(null)
  const lastRowClicked = useRef<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const pendingFocus = useRef(false)
  const listBase = useId()

  // Rows can shrink under the selection (Delete Selected Rows, Undo). The
  // selection that is drawn and acted on is always kept inside the grid.
  const lastRow = rows.length - 1
  const sel = useMemo(
    () =>
      rawSel.anchor.row > lastRow || rawSel.focus.row > lastRow
        ? cellSelection(
            Math.max(0, Math.min(rawSel.anchor.row, lastRow)),
            rawSel.anchor.col
          )
        : rawSel,
    [rawSel, lastRow]
  )
  const selectedRows = useMemo(
    () =>
      rawSelectedRows.some((r) => r > lastRow)
        ? rawSelectedRows.filter((r) => r <= lastRow)
        : rawSelectedRows,
    [rawSelectedRows, lastRow]
  )

  // The latest state, for handlers that must stay stable so memoised rows do
  // not all re-render on every keystroke.
  const S = useRef({
    props,
    sel,
    selectedRows,
    editing,
    open,
    fillPreview,
    menu,
  })
  useLayoutEffect(() => {
    S.current = { props, sel, selectedRows, editing, open, fillPreview, menu }
  })

  // Selection writes update the latest-state ref synchronously as well as
  // React state: focusing a cell fires onFocus before React has re-rendered,
  // and onFocus must see the selection that caused the focus, not the one
  // before it.
  const setSelection = useCallback((next: GridSelection) => {
    S.current.sel = next
    setSel(next)
  }, [])
  const setRowSelection = useCallback((next: number[]) => {
    S.current.selectedRows = next
    setSelectedRows(next)
  }, [])

  const range = useMemo(() => rangeOf(sel), [sel])
  const rowMode = selectedRows.length > 0

  // ------------------------------------------------------------------------
  // Focus follows the active cell -- after the render that mounted it.
  // ------------------------------------------------------------------------
  const focusCell = useCallback((row: number, col: number) => {
    const el = cellRefs.current.get(cellKey(row, col))
    if (!el) {
      pendingFocus.current = true
      return
    }
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [])

  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    focusCell(sel.anchor.row, sel.anchor.col)
  })

  // Selection is announced, briefly, for anyone who cannot see the outline.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (rowMode) {
        setAnnouncement(
          selectedRows.length === 1
            ? `Row ${selectedRows[0] + 1} selected`
            : `${selectedRows.length} rows selected`
        )
      } else if (!isSingleCell(range)) {
        setAnnouncement(
          `${rangeHeight(range) * rangeWidth(range)} cells selected, rows ${range.top + 1} to ${range.bottom + 1}`
        )
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [range, rowMode, selectedRows])

  // ------------------------------------------------------------------------
  // What an operation acts on: selected row numbers, or the cell range.
  // ------------------------------------------------------------------------
  const targetRows = useCallback((): number[] => {
    const { selectedRows: sr, sel: s } = S.current
    return sr.length > 0 ? sr : rowsCovered(rangeOf(s))
  }, [])

  const targetRange = useCallback((): CellRange => {
    const { selectedRows: sr, sel: s } = S.current
    if (sr.length > 0) return rowsRange(sr) ?? rangeOf(s)
    return rangeOf(s)
  }, [])

  const select = useCallback(
    (next: GridSelection, options: { keepRows?: boolean } = {}) => {
      setSelection(next)
      if (!options.keepRows) setRowSelection([])
      focusCell(next.anchor.row, next.anchor.col)
    },
    [focusCell, setRowSelection, setSelection]
  )

  // ------------------------------------------------------------------------
  // Editing
  // ------------------------------------------------------------------------
  const listDirection = useCallback((row: number, col: number) => {
    const el = cellRefs.current.get(cellKey(row, col))
    const box = scrollRef.current?.getBoundingClientRect()
    if (!el || !box) return false
    const r = el.getBoundingClientRect()
    return box.bottom - r.bottom < LIST_ROOM && r.top - box.top > LIST_ROOM
  }, [])

  const openList = useCallback(
    (row: number, col: number, queryActive: boolean) => {
      const field = PLANNER_FIELDS[col]
      const kind = LOOKUP_BY_FIELD[field]
      if (!kind) return
      const { props: p } = S.current
      const current = p.rows[row]?.[field] ?? ""
      let highlight = 0
      if (!queryActive && current) {
        const found = p
          .answer(kind, p.rows[row], "")
          .options.findIndex((o) => o.label === current)
        if (found > 0) highlight = found
      }
      setOpen({
        row,
        col,
        queryActive,
        highlight,
        dropUp: listDirection(row, col),
      })
    },
    [listDirection]
  )

  const startEdit = useCallback(
    (source: EditSource) => {
      const { sel: s, props: p, editing: e } = S.current
      const { row, col } = s.anchor
      const field = PLANNER_FIELDS[col]
      if (e && e.row === row && e.col === col) return
      setRowSelection([])
      setSelection(cellSelection(row, col))
      const edit = { row, col, original: p.rows[row]?.[field] ?? "", source }
      S.current.editing = edit
      setEditing(edit)
      const el = cellRefs.current.get(cellKey(row, col))
      if (el) {
        if (source === "f2")
          el.setSelectionRange(el.value.length, el.value.length)
        else el.select()
      }
      if (LOOKUP_BY_FIELD[field] && source !== "type") openList(row, col, false)
      if (LOOKUP_BY_FIELD[field] && source === "type")
        setOpen({
          row,
          col,
          queryActive: true,
          highlight: 0,
          dropUp: listDirection(row, col),
        })
    },
    [openList, listDirection, setRowSelection, setSelection]
  )

  /**
   * Leaving a cell. The one rule applied here rather than on every keystroke:
   * a pitch that is not at the venue just chosen is cleared, and the person is
   * told. Typing "Tow" on the way to "Towneley Park" must not clear anything.
   */
  const commitEdit = useCallback(
    (edit?: EditState, committed?: PlannerDraftRow) => {
      const { props: p } = S.current
      const e = edit ?? S.current.editing
      S.current.editing = null
      S.current.open = null
      setEditing(null)
      setOpen(null)
      if (!e) return
      const field = PLANNER_FIELDS[e.col]
      const row = committed ?? p.rows[e.row]
      if (
        field === "venue" &&
        row &&
        row.venue !== e.original &&
        !p.pitchCompatible(row)
      ) {
        p.onCellChange(e.row, "pitch", "")
        p.onNotice(
          `Row ${e.row + 1}: ${row.pitch} is not at ${row.venue || "that venue"}, so the pitch was cleared.`
        )
      }
    },
    []
  )

  const cancelEdit = useCallback(() => {
    const { editing: e, props: p } = S.current
    setEditing(null)
    setOpen(null)
    if (!e) return
    p.onCellChange(e.row, PLANNER_FIELDS[e.col], e.original)
    const el = cellRefs.current.get(cellKey(e.row, e.col))
    if (el) window.requestAnimationFrame(() => el.setSelectionRange(0, 0))
  }, [])

  const move = useCallback(
    (dRow: number, dCol: number, extend = false) => {
      const { sel: s, props: p } = S.current
      select(moveSelection(s, dRow, dCol, p.rows.length, extend))
    },
    [select]
  )

  /** Tab walks the row and wraps to the next; at the very edge it lets focus leave the grid. */
  const tab = useCallback(
    (backwards: boolean): boolean => {
      const { sel: s, props: p } = S.current
      const { row, col } = s.anchor
      if (!backwards) {
        if (col < COLUMN_COUNT - 1)
          return (select(cellSelection(row, col + 1)), true)
        if (row < p.rows.length - 1)
          return (select(cellSelection(row + 1, 0)), true)
        return false
      }
      if (col > 0) return (select(cellSelection(row, col - 1)), true)
      if (row > 0)
        return (select(cellSelection(row - 1, COLUMN_COUNT - 1)), true)
      return false
    },
    [select]
  )

  const choose = useCallback(
    (option: LookupEntry, advance: "right" | "left" | "stay") => {
      const { open: o, props: p, editing: e } = S.current
      if (!o) return
      const field = PLANNER_FIELDS[o.col]
      const kind = LOOKUP_BY_FIELD[field]
      p.onCellChange(o.row, field, option.label)
      if (kind) p.remember(kind, option.label)
      // The row as it is AFTER this choice -- state has not re-rendered yet --
      // so the venue/pitch rule judges the venue just chosen.
      commitEdit(
        e ?? {
          row: o.row,
          col: o.col,
          original: p.rows[o.row]?.[field] ?? "",
          source: "click",
        },
        { ...p.rows[o.row], [field]: option.label }
      )
      if (advance === "stay") focusCell(o.row, o.col)
      else
        select(
          cellSelection(
            o.row,
            Math.max(
              0,
              Math.min(COLUMN_COUNT - 1, o.col + (advance === "right" ? 1 : -1))
            )
          )
        )
    },
    [commitEdit, focusCell, select]
  )

  // ------------------------------------------------------------------------
  // Bulk operations -- each one a single undoable step.
  // ------------------------------------------------------------------------
  const copySelection = useCallback((): { text: string; count: number } => {
    const { selectedRows: sr, props: p } = S.current
    if (sr.length > 0) {
      const text = rowsToTsv(p.rows, sr)
      clipboard.current = { text, block: parseClipboardGrid(text) }
      return { text, count: sr.length * COLUMN_COUNT }
    }
    const r = targetRange()
    const text = rangeToTsv(p.rows, r)
    clipboard.current = { text, block: rangeValues(p.rows, r) }
    return { text, count: rangeHeight(r) * rangeWidth(r) }
  }, [targetRange])

  const pasteText = useCallback(
    (text: string, at?: CellRange) => {
      const { props: p, selectedRows: sr } = S.current
      const block = parseClipboardGrid(text)
      if (block.length === 0) return
      // Non-contiguous rows have no shape to tile into; the block goes in from the first.
      const target =
        at ??
        (sr.length > 0 && !rowsContiguous(sr)
          ? { top: Math.min(...sr), bottom: Math.min(...sr), left: 0, right: 0 }
          : targetRange())
      const { rows: next, written } = pasteBlock(p.rows, target, block)
      p.onBulk("Paste", next, { check: true })
      setRowSelection([])
      setSelection({
        anchor: { row: written.top, col: written.left },
        focus: { row: written.bottom, col: written.right },
      })
      pendingFocus.current = true
      setAnnouncement(
        `Pasted ${rangeHeight(written) * rangeWidth(written)} cells`
      )
    },
    [targetRange, setRowSelection, setSelection]
  )

  const clearSelection = useCallback(() => {
    const { props: p, selectedRows: sr } = S.current
    if (sr.length > 0) {
      if (!rowsHaveContent(p.rows, sr)) return
      p.onBulk("Clear", clearRows(p.rows, sr))
      setAnnouncement(`Cleared ${sr.length} row${sr.length === 1 ? "" : "s"}`)
      return
    }
    const r = rangeOf(S.current.sel)
    if (!rangeHasContent(p.rows, r)) return
    p.onBulk("Clear", clearRange(p.rows, r))
    setAnnouncement(`Cleared ${rangeHeight(r) * rangeWidth(r)} cells`)
  }, [])

  const deleteSelectedRows = useCallback(() => {
    const { props: p } = S.current
    const indexes = targetRows()
    p.onBulk("Delete Rows", deleteRows(p.rows, indexes, p.minimumRows))
    const top = Math.min(...indexes)
    setRowSelection([])
    setSelection(cellSelection(Math.min(top, p.rows.length - 1), 0))
    pendingFocus.current = true
    setAnnouncement(
      `Deleted ${indexes.length} row${indexes.length === 1 ? "" : "s"}`
    )
  }, [targetRows, setRowSelection, setSelection])

  const doFill = useCallback(
    (direction: "down" | "right") => {
      const { props: p } = S.current
      const r = targetRange()
      const outcome =
        direction === "down" ? fillDown(p.rows, r) : fillRight(p.rows, r)
      if (!outcome.changed) return
      p.onBulk("Fill", outcome.rows)
      setAnnouncement(direction === "down" ? "Filled down" : "Filled right")
    },
    [targetRange]
  )

  const writeSystemClipboard = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {
      // The grid's own clipboard still holds it, so Paste in this planner works
      // even where the browser refuses the system clipboard.
    })
  }, [])

  const pasteFromMenu = useCallback(async () => {
    const { props: p } = S.current
    try {
      const text = await navigator.clipboard.readText()
      if (text) return pasteText(text)
    } catch {
      // Reading the clipboard needs permission; the grid's own copy does not.
    }
    if (clipboard.current) return pasteText(clipboard.current.text)
    p.onNotice(
      `Your browser did not let the planner read the clipboard. Press ${isMac() ? "⌘V" : "Ctrl+V"} to paste instead.`
    )
  }, [pasteText])

  // ------------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------------
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (!target.dataset.cell) return
      const st = S.current
      const p = st.props
      if (e.nativeEvent.isComposing) return

      // The cell a key lands on is the active one, even if focus got there
      // by a route the grid did not see.
      const row = Number(target.dataset.row)
      const col = Number(target.dataset.col)
      if (row !== st.sel.anchor.row || col !== st.sel.anchor.col)
        setSelection(cellSelection(row, col))
      const field = PLANNER_FIELDS[col]
      const kind = LOOKUP_BY_FIELD[field]
      const mod = e.metaKey || e.ctrlKey

      // 1. AN OPEN LIST gets first refusal on navigation keys.
      if (st.open && kind) {
        const query = st.open.queryActive ? p.rows[row][field] : ""
        const options = p.answer(kind, p.rows[row], query).options
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          const delta = e.key === "ArrowDown" ? 1 : -1
          setOpen({
            ...st.open,
            highlight: Math.max(
              0,
              Math.min(options.length - 1, st.open.highlight + delta)
            ),
          })
          return
        }
        if (e.key === "Enter" && options[st.open.highlight]) {
          e.preventDefault()
          choose(options[st.open.highlight], "right")
          return
        }
        if (e.key === "Tab") {
          e.preventDefault()
          const typed = p.rows[row][field]
          const exact = exactEntry(buildLookupIndex(options), typed)
          const pick =
            exact ??
            (st.open.queryActive && typed ? options[st.open.highlight] : null)
          if (pick) choose(pick, e.shiftKey ? "left" : "right")
          else {
            commitEdit()
            tab(e.shiftKey)
          }
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setOpen(null)
          return
        }
      }

      // 2. EDIT MODE: the cell is a text box until Enter, Tab or Escape.
      if (st.editing) {
        if (e.key === "Enter") {
          e.preventDefault()
          commitEdit()
          move(e.shiftKey ? -1 : 1, 0)
        } else if (e.key === "Tab") {
          e.preventDefault()
          commitEdit()
          tab(e.shiftKey)
        } else if (e.key === "Escape") {
          e.preventDefault()
          cancelEdit()
        } else if (e.key === "ArrowDown" && e.altKey && kind) {
          e.preventDefault()
          openList(row, col, false)
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault()
          commitEdit()
          move(e.key === "ArrowDown" ? 1 : -1, 0)
        } else if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          st.editing.source === "type"
        ) {
          // Typed straight into a selected cell: arrows keep moving, as in Excel.
          e.preventDefault()
          commitEdit()
          move(0, e.key === "ArrowRight" ? 1 : -1)
        }
        return
      }

      // 3. SELECTION MODE.
      const arrows: Record<string, [number, number]> = {
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
      }
      if (e.altKey && e.key === "ArrowDown" && kind) {
        e.preventDefault()
        openList(row, col, false)
        return
      }
      if (arrows[e.key]) {
        e.preventDefault()
        const [dr, dc] = arrows[e.key]
        if (mod) {
          // Ctrl/Cmd+arrow jumps to the edge of the grid.
          const edgeRow = dr > 0 ? p.rows.length - 1 : dr < 0 ? 0 : null
          const edgeCol = dc > 0 ? COLUMN_COUNT - 1 : dc < 0 ? 0 : null
          const from = e.shiftKey ? st.sel.focus : st.sel.anchor
          const to = { row: edgeRow ?? from.row, col: edgeCol ?? from.col }
          select(
            e.shiftKey
              ? { anchor: st.sel.anchor, focus: to }
              : cellSelection(to.row, to.col)
          )
          return
        }
        move(dr, dc, e.shiftKey)
        return
      }
      if (e.key === "Tab") {
        if (tab(e.shiftKey)) e.preventDefault()
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        move(e.shiftKey ? -1 : 1, 0)
        return
      }
      if (e.key === "F2") {
        e.preventDefault()
        startEdit("f2")
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        clearSelection()
        return
      }
      if (e.key === "Escape") {
        if (st.selectedRows.length > 0 || !isSingleCell(rangeOf(st.sel))) {
          e.preventDefault()
          select(cellSelection(st.sel.anchor.row, st.sel.anchor.col))
        }
        return
      }
      if (
        (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) &&
        scrollRef.current
      ) {
        e.preventDefault()
        const r = target.getBoundingClientRect()
        setMenu({ x: r.left + 12, y: r.bottom })
        return
      }
      if (e.key === " " && e.shiftKey) {
        e.preventDefault()
        const covered = rowsCovered(rangeOf(st.sel))
        setRowSelection(covered)
        lastRowClicked.current = covered[0]
        return
      }
      if (mod && (e.key === "a" || e.key === "A")) {
        e.preventDefault()
        setRowSelection([])
        setSelection({
          anchor: { row: 0, col: 0 },
          focus: { row: p.rows.length - 1, col: COLUMN_COUNT - 1 },
        })
        return
      }
      if (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        if (p.undoLabel) {
          e.preventDefault()
          p.onUndo()
        }
        return
      }
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        doFill("down")
        return
      }
      // A printable key starts an edit that REPLACES the cell, as in Excel.
      if (!mod && !e.altKey && e.key.length === 1) {
        startEdit("type")
      }
    },
    [
      choose,
      commitEdit,
      cancelEdit,
      move,
      tab,
      startEdit,
      openList,
      select,
      clearSelection,
      doFill,
      setRowSelection,
      setSelection,
    ]
  )

  // ------------------------------------------------------------------------
  // Clipboard events -- the only way to reach the system clipboard without a
  // permission prompt, and the route Excel and Sheets data arrives by.
  // ------------------------------------------------------------------------
  const onCopy = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>, cut = false) => {
      const target = e.target as HTMLInputElement
      if (!target.dataset?.cell) return
      // Text selected inside a cell being edited copies as text, natively.
      if (S.current.editing && target.selectionStart !== target.selectionEnd)
        return
      e.preventDefault()
      const { text, count } = copySelection()
      e.clipboardData.setData("text/plain", text)
      if (cut) {
        clearSelection()
        setAnnouncement(`Cut ${count} cells`)
      } else {
        setAnnouncement(`Copied ${count} cells`)
      }
    },
    [copySelection, clearSelection]
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLInputElement
      if (!target.dataset?.cell) return
      const text = e.clipboardData.getData("text/plain")
      if (!text) return
      const st = S.current
      const block = parseClipboardGrid(text)
      const oneValue = block.length === 1 && block[0].length === 1
      // A single value pasted while typing is ordinary text entry.
      if (st.editing && oneValue) return
      e.preventDefault()
      if (st.editing) {
        setEditing(null)
        setOpen(null)
      }
      // Paste lands where the event landed, even if focus arrived there by a
      // route the selection has not caught up with yet.
      const row = Number(target.dataset.row)
      const col = Number(target.dataset.col)
      const onActive = row === st.sel.anchor.row && col === st.sel.anchor.col
      pasteText(
        text,
        onActive ? undefined : { top: row, bottom: row, left: col, right: col }
      )
    },
    [pasteText]
  )

  // ------------------------------------------------------------------------
  // Pointer: select, drag a range, drag the fill handle, row numbers.
  // ------------------------------------------------------------------------
  const posFromPoint = useCallback(
    (x: number, y: number): { row: number; col: number | null } | null => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-grid-row]")
      if (!el) return null
      const row = Number(el.dataset.gridRow)
      const col =
        el.dataset.gridCol !== undefined ? Number(el.dataset.gridCol) : null
      return { row, col }
    },
    []
  )

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current
      if (!d) return
      const box = scrollRef.current?.getBoundingClientRect()
      if (box && scrollRef.current) {
        if (e.clientY > box.bottom - 28) scrollRef.current.scrollTop += 18
        else if (e.clientY < box.top + 40) scrollRef.current.scrollTop -= 18
      }
      const pos = posFromPoint(e.clientX, e.clientY)
      if (!pos) return
      if (d.kind === "cells") {
        // A finger moving across the grid is scrolling it, not selecting.
        if (d.pointerType === "touch") return
        const col = pos.col ?? d.col
        if (pos.row === d.start.row && col === d.start.col) return
        d.moved = true
        setSelection({ anchor: d.start, focus: { row: pos.row, col } })
      } else if (d.kind === "rows") {
        const lo = Math.min(d.from, pos.row)
        const hi = Math.max(d.from, pos.row)
        setRowSelection(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i))
        setSelection({
          anchor: { row: d.from, col: 0 },
          focus: { row: pos.row, col: COLUMN_COUNT - 1 },
        })
      } else if (d.kind === "fill") {
        // Kept on the drag itself as well as in state: a quick drag can be
        // released before React has rendered the preview.
        d.target = fillTarget(d.source, {
          row: pos.row,
          col: pos.col ?? d.source.right,
        })
        setFillPreview(d.target)
      }
    }
    function onUp() {
      const d = drag.current
      drag.current = null
      if (!d) return
      const st = S.current
      if (d.kind === "fill") {
        const preview = d.target
        setFillPreview(null)
        if (!preview) return
        const next = fillRange(st.props.rows, d.source, preview)
        st.props.onBulk("Fill", next)
        setRowSelection([])
        setSelection({
          anchor: { row: preview.top, col: preview.left },
          focus: { row: preview.bottom, col: preview.right },
        })
        pendingFocus.current = true
        setAnnouncement(
          `Filled ${rangeHeight(preview) * rangeWidth(preview) - rangeHeight(d.source) * rangeWidth(d.source)} cells`
        )
        return
      }
      if (d.kind === "cells" && !d.moved && !d.shift) {
        const kind = LOOKUP_BY_FIELD[PLANNER_FIELDS[d.start.col]]
        // A click on a structured cell shows its answers straight away, the way
        // a data-validation dropdown does. On touch, any tap edits: there is no
        // keyboard to start typing with otherwise.
        if (d.pointerType === "touch") startEdit("click")
        else if (kind) openList(d.start.row, d.start.col, false)
      }
    }
    // A cancelled pointer (the browser took over to scroll) is not a click.
    function onCancel() {
      drag.current = null
      setFillPreview(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
    }
  }, [posFromPoint, startEdit, openList, setRowSelection, setSelection])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement
      if (e.button === 2) {
        // A right-click must not move focus: focusing the clicked input would
        // collapse the selection before the context menu could act on it.
        const edit = S.current.editing
        const td = el.closest<HTMLElement>("[data-grid-col]")
        const onEditingCell =
          edit &&
          td &&
          Number(td.dataset.gridRow) === edit.row &&
          Number(td.dataset.gridCol) === edit.col
        if (!onEditingCell && !el.closest('[role="listbox"]'))
          e.preventDefault()
        return
      }
      if (e.button !== 0) return
      if (el.closest('[role="listbox"]') || el.closest("[data-grid-menu]"))
        return
      setMenu(null)
      const st = S.current

      if (el.closest("[data-fill-handle]")) {
        e.preventDefault()
        if (st.editing) commitEdit()
        drag.current = { kind: "fill", source: targetRange(), target: null }
        return
      }

      const head = el.closest<HTMLElement>("[data-row-head]")
      if (head) {
        e.preventDefault()
        if (st.editing) commitEdit()
        const clicked = Number(head.dataset.gridRow)
        const touch = e.pointerType === "touch"
        // Touch has no modifier keys, so each tap on a row number toggles it.
        const mode = e.shiftKey
          ? "extend"
          : e.metaKey || e.ctrlKey || (touch && st.selectedRows.length > 0)
            ? "toggle"
            : "replace"
        const next = selectRows(
          st.selectedRows,
          lastRowClicked.current,
          clicked,
          mode
        )
        if (next.length === 0) {
          select(cellSelection(clicked, 0))
          return
        }
        setRowSelection(next)
        const from =
          mode === "extend" ? (lastRowClicked.current ?? clicked) : clicked
        setSelection({
          anchor: { row: from, col: 0 },
          focus: { row: clicked, col: COLUMN_COUNT - 1 },
        })
        if (mode !== "extend") lastRowClicked.current = clicked
        focusCell(clicked, 0)
        if (mode === "replace" && !touch)
          drag.current = {
            kind: "rows",
            from: clicked,
            pointerType: e.pointerType,
          }
        return
      }

      const td = el.closest<HTMLElement>("[data-grid-col]")
      if (!td) return
      const row = Number(td.dataset.gridRow)
      const col = Number(td.dataset.gridCol)
      if (st.editing && st.editing.row === row && st.editing.col === col) return // caret placement, natively
      e.preventDefault()
      if (st.editing) commitEdit()
      setOpen(null)
      if (e.shiftKey) {
        select({ anchor: st.sel.anchor, focus: { row, col } })
      } else {
        select(cellSelection(row, col))
      }
      drag.current = {
        kind: "cells",
        start: e.shiftKey ? st.sel.anchor : { row, col },
        moved: false,
        pointerType: e.pointerType,
        shift: e.shiftKey,
        col,
      }
    },
    [commitEdit, focusCell, select, targetRange, setRowSelection, setSelection]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-grid-col]"
      )
      if (!td) return
      setSelection(
        cellSelection(Number(td.dataset.gridRow), Number(td.dataset.gridCol))
      )
      startEdit("f2")
    },
    [startEdit, setSelection]
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement
      const st = S.current
      // Inside a cell being typed into, the browser's own text menu is the useful one.
      if (st.editing && (el as HTMLInputElement).dataset?.cell) return
      e.preventDefault()
      const head = el.closest<HTMLElement>("[data-row-head]")
      const td = el.closest<HTMLElement>("[data-grid-col]")
      if (head) {
        const row = Number(head.dataset.gridRow)
        if (!st.selectedRows.includes(row)) {
          setRowSelection([row])
          lastRowClicked.current = row
          setSelection({
            anchor: { row, col: 0 },
            focus: { row, col: COLUMN_COUNT - 1 },
          })
          focusCell(row, 0)
        }
      } else if (td) {
        const row = Number(td.dataset.gridRow)
        const col = Number(td.dataset.gridCol)
        const inside =
          st.selectedRows.length > 0
            ? st.selectedRows.includes(row)
            : inRange(rangeOf(st.sel), row, col)
        // Right-clicking outside the selection selects what was clicked, as a spreadsheet does.
        if (!inside) select(cellSelection(row, col))
      }
      setOpen(null)
      setMenu({ x: e.clientX, y: e.clientY })
    },
    [focusCell, select, setRowSelection, setSelection]
  )

  const onFocus = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (!target.dataset.cell) return
      const row = Number(target.dataset.row)
      const col = Number(target.dataset.col)
      const st = S.current
      if (st.editing && (st.editing.row !== row || st.editing.col !== col)) {
        setEditing(null)
        setOpen(null)
      }
      if (st.sel.anchor.row === row && st.sel.anchor.col === col) return
      if (st.selectedRows.length > 0 && st.selectedRows.includes(row)) return
      setRowSelection([])
      setSelection(cellSelection(row, col))
    },
    [setRowSelection, setSelection]
  )

  const onBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as HTMLElement | null
    if (
      next &&
      (scrollRef.current?.contains(next) || next.closest("[data-grid-menu]"))
    )
      return
    // Leaving the grid entirely ends an edit where it stands.
    if (S.current.editing) {
      setEditing(null)
      setOpen(null)
    }
  }, [])

  // ------------------------------------------------------------------------
  // Handlers handed to memoised rows, stable for the life of the grid.
  // ------------------------------------------------------------------------
  const api = useMemo(
    () => ({
      change(row: number, col: number, value: string) {
        const st = S.current
        const field = PLANNER_FIELDS[col]
        st.props.onCellChange(row, field, value)
        const kind = LOOKUP_BY_FIELD[field]
        if (!st.editing || st.editing.row !== row || st.editing.col !== col) {
          setEditing({
            row,
            col,
            original: st.props.rows[row]?.[field] ?? "",
            source: "type",
          })
        }
        if (kind) {
          setOpen((o) =>
            o && o.row === row && o.col === col
              ? { ...o, queryActive: true, highlight: 0 }
              : {
                  row,
                  col,
                  queryActive: true,
                  highlight: 0,
                  dropUp: listDirection(row, col),
                }
          )
        }
      },
      highlight(index: number) {
        setOpen((o) => (o ? { ...o, highlight: index } : o))
      },
      choose(option: LookupEntry) {
        choose(option, "stay")
      },
      ref(row: number, col: number, el: HTMLInputElement | null) {
        const key = cellKey(row, col)
        if (el) cellRefs.current.set(key, el)
        else if (cellRefs.current.get(key)?.isConnected === false)
          cellRefs.current.delete(key)
      },
    }),
    [choose, listDirection]
  )

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  const selectedRowSet = useMemo(() => new Set(selectedRows), [selectedRows])
  const menuTargetRows = rowMode ? selectedRows : rowsCovered(range)
  const menuRange = rowMode ? (rowsRange(selectedRows) ?? range) : range
  const handleRange =
    rowMode && !rowsContiguous(selectedRows) ? null : menuRange
  const showHandle = !editing && handleRange !== null

  return (
    <>
      <div className="relative hidden md:block">
        {/* FLOATING, NOT IN FLOW. A bar that appeared above the grid pushed
            every row down between one click and the Shift-click that
            followed, so the second click landed on the wrong row. */}
        {rowMode && (
          <div
            role="toolbar"
            aria-label="Selected rows"
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm shadow-lg"
          >
            <span className="mr-2 font-medium text-ink">
              {selectedRows.length} row{selectedRows.length === 1 ? "" : "s"}{" "}
              selected
            </span>
            <BarButton
              onClick={() => {
                const { text } = copySelection()
                writeSystemClipboard(text)
                setAnnouncement(`Copied ${selectedRows.length} rows`)
              }}
            >
              Copy
            </BarButton>
            <BarButton
              disabled={!rowsHaveContent(rows, selectedRows)}
              onClick={clearSelection}
            >
              Clear Contents
            </BarButton>
            <BarButton destructive onClick={deleteSelectedRows}>
              Delete Selected Rows
            </BarButton>
            <BarButton onClick={() => select(cellSelection(sel.anchor.row, 0))}>
              Cancel
            </BarButton>
          </div>
        )}

        {/* THE WORKSPACE.
          `relative` is load-bearing: without a positioned ancestor an
          absolutely-positioned sr-only label escapes this scroll container
          and drags the whole page sideways. */}
        <div
          ref={scrollRef}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          onCut={(e) => onCopy(e, true)}
          onPaste={onPaste}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onFocus={onFocus}
          onBlur={onBlur}
          className="relative hidden max-h-[calc(100dvh-13rem)] min-h-[30rem] overflow-auto rounded-lg border border-ink/20 bg-white select-none md:block"
        >
          <table
            role="grid"
            aria-multiselectable="true"
            aria-rowcount={rows.length + 1}
            aria-describedby={`${listBase}-help`}
            className="w-full border-separate border-spacing-0 text-sm"
          >
            <caption className="sr-only">
              Fixture planner grid, {rows.length} rows.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-20 w-10 border-r border-b border-ink/20 bg-chalk px-1 py-1.5 text-right text-xs font-medium text-ink-subtle"
                >
                  <span className="sr-only">Row number</span>#
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.field}
                    scope="col"
                    className={`group/head sticky top-0 z-10 border-r border-b border-ink/20 bg-chalk px-1.5 py-1.5 text-left text-xs font-medium whitespace-nowrap text-ink ${c.width}`}
                  >
                    <span className="flex items-center justify-between gap-1">
                      {c.label}
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => props.onFillColumn(c.field)}
                        title={`Fill ${c.label} down`}
                        className="rounded p-0.5 text-ink-subtle opacity-0 outline-none group-hover/head:opacity-100 hover:bg-ink/[0.08] hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        <ArrowDown className="size-3" aria-hidden="true" />
                        <span className="sr-only">
                          Fill {c.label} down the column
                        </span>
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const inRows =
                  rowIndex >= menuRange.top && rowIndex <= menuRange.bottom
                const rowSelected = rowMode
                  ? selectedRowSet.has(rowIndex)
                  : false
                const isOpenRow = open?.row === rowIndex
                const fillRow =
                  fillPreview &&
                  rowIndex >= fillPreview.top &&
                  rowIndex <= fillPreview.bottom
                    ? fillPreview
                    : null
                return (
                  <GridRow
                    key={row.key}
                    row={row}
                    rowIndex={rowIndex}
                    result={results[row.key]}
                    suggested={props.suggestions?.[row.key] ?? ""}
                    selLeft={
                      rowMode
                        ? rowSelected
                          ? 0
                          : -1
                        : inRows
                          ? menuRange.left
                          : -1
                    }
                    selRight={
                      rowMode
                        ? rowSelected
                          ? COLUMN_COUNT - 1
                          : -1
                        : inRows
                          ? menuRange.right
                          : -1
                    }
                    edgeTop={
                      rowMode
                        ? rowSelected && !selectedRowSet.has(rowIndex - 1)
                        : inRows && rowIndex === menuRange.top
                    }
                    edgeBottom={
                      rowMode
                        ? rowSelected && !selectedRowSet.has(rowIndex + 1)
                        : inRows && rowIndex === menuRange.bottom
                    }
                    rowSelected={rowSelected}
                    activeCol={
                      sel.anchor.row === rowIndex ? sel.anchor.col : -1
                    }
                    editingCol={editing?.row === rowIndex ? editing.col : -1}
                    handleCol={
                      showHandle &&
                      handleRange &&
                      rowIndex === handleRange.bottom
                        ? handleRange.right
                        : -1
                    }
                    fillLeft={fillRow ? fillRow.left : -1}
                    fillRight={fillRow ? fillRow.right : -1}
                    fillTop={fillRow ? rowIndex === fillRow.top : false}
                    fillBottom={fillRow ? rowIndex === fillRow.bottom : false}
                    open={isOpenRow ? open : null}
                    answer={isOpenRow ? props.answer : undefined}
                    listBase={listBase}
                    api={api}
                  />
                )
              })}
            </tbody>
          </table>
          <p id={`${listBase}-help`} className="sr-only">
            Arrow keys move between cells and Shift with an arrow extends the
            selection. Type to replace a cell, or press F2 to edit it. Alt and
            Down Arrow opens a column&rsquo;s options. Copy and paste work with
            Excel and Google Sheets. Delete clears the selection. Shift and F10
            opens the actions menu.
          </p>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <span id={SUGGESTED_NOTE_ID} className="sr-only">
        Suggested by Ovalball. Type to change it.
      </span>

      {menu && (
        <GridMenu
          x={menu.x}
          y={menu.y}
          onClose={(refocus) => {
            setMenu(null)
            if (refocus)
              focusCell(S.current.sel.anchor.row, S.current.sel.anchor.col)
          }}
          items={[
            {
              label: "Copy",
              shortcut: isMac() ? "⌘C" : "Ctrl+C",
              enabled: true,
              run: () => {
                const { text, count } = copySelection()
                writeSystemClipboard(text)
                setAnnouncement(`Copied ${count} cells`)
              },
            },
            {
              label: "Paste",
              shortcut: isMac() ? "⌘V" : "Ctrl+V",
              enabled: true,
              run: () => void pasteFromMenu(),
            },
            {
              label: "Fill Down",
              shortcut: isMac() ? "⌘D" : "Ctrl+D",
              enabled:
                rowsContiguous(menuTargetRows) &&
                (rangeHeight(menuRange) > 1 || menuRange.top > 0),
              run: () => doFill("down"),
            },
            {
              label: "Fill Right",
              enabled: !rowMode && (rangeWidth(range) > 1 || range.left > 0),
              run: () => doFill("right"),
            },
            {
              label: "Clear Contents",
              shortcut: "Delete",
              enabled: rowMode
                ? rowsHaveContent(rows, selectedRows)
                : rangeHasContent(rows, range),
              run: clearSelection,
            },
            {
              label: "Delete Selected Rows",
              detail: `${menuTargetRows.length} row${menuTargetRows.length === 1 ? "" : "s"}`,
              enabled:
                rowsHaveContent(rows, menuTargetRows) ||
                rows.length > minimumRows,
              destructive: true,
              run: deleteSelectedRows,
            },
          ]}
        />
      )}
    </>
  )
}

function BarButton({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium outline-none hover:bg-ink/[0.06] focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50 ${
        destructive ? "text-destructive-text" : "text-ink"
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// One row. Memoised: moving the selection re-renders the rows it touches, not
// a hundred rows of inputs.
// ---------------------------------------------------------------------------

interface RowApi {
  change: (row: number, col: number, value: string) => void
  highlight: (index: number) => void
  choose: (option: LookupEntry) => void
  ref: (row: number, col: number, el: HTMLInputElement | null) => void
}

const SELECTION = "var(--color-pitch-600)"
const FILL = "var(--color-pitch-400)"

const GridRow = memo(function GridRow({
  row,
  rowIndex,
  result,
  suggested,
  selLeft,
  selRight,
  edgeTop,
  edgeBottom,
  rowSelected,
  activeCol,
  editingCol,
  handleCol,
  fillLeft,
  fillRight,
  fillTop,
  fillBottom,
  open,
  answer,
  listBase,
  api,
}: {
  row: PlannerDraftRow
  rowIndex: number
  result: PlannerRowResult | undefined
  suggested: string
  selLeft: number
  selRight: number
  edgeTop: boolean
  edgeBottom: boolean
  rowSelected: boolean
  activeCol: number
  editingCol: number
  handleCol: number
  fillLeft: number
  fillRight: number
  fillTop: boolean
  fillBottom: boolean
  open: OpenList | null
  answer?: (
    kind: LookupKind,
    row: PlannerDraftRow,
    query: string
  ) => LookupAnswer
  listBase: string
  api: RowApi
}) {
  const status = result?.status ?? "blank"
  const multi = selLeft !== selRight || edgeTop !== edgeBottom || rowSelected

  return (
    <tr aria-rowindex={rowIndex + 2} aria-selected={rowSelected || undefined}>
      <td
        data-grid-row={rowIndex}
        data-row-head=""
        className={`relative cursor-pointer border-r border-b border-ink/12 px-1 text-right align-middle text-xs tabular-nums select-none ${
          rowSelected
            ? "bg-pitch-600/15 font-medium text-ink"
            : "bg-chalk/50 text-ink-subtle hover:bg-ink/[0.05]"
        }`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_RAIL[status]}`}
          aria-hidden="true"
        />
        {rowIndex + 1}
        {status !== "blank" && (
          <span className="sr-only"> — {STATUS_WORD[status]}</span>
        )}
      </td>
      {COLUMNS.map((c, col) => {
        const selected = selLeft >= 0 && col >= selLeft && col <= selRight
        const active = activeCol === col
        const shadows: string[] = []
        if (selected && (multi || !active)) {
          if (edgeTop) shadows.push(`inset 0 2px 0 0 ${SELECTION}`)
          if (edgeBottom) shadows.push(`inset 0 -2px 0 0 ${SELECTION}`)
          if (col === selLeft) shadows.push(`inset 2px 0 0 0 ${SELECTION}`)
          if (col === selRight) shadows.push(`inset -2px 0 0 0 ${SELECTION}`)
        }
        if (active) shadows.push(`inset 0 0 0 2px ${SELECTION}`)
        if (fillLeft >= 0 && col >= fillLeft && col <= fillRight) {
          if (fillTop) shadows.push(`inset 0 2px 0 0 ${FILL}`)
          if (fillBottom) shadows.push(`inset 0 -2px 0 0 ${FILL}`)
          if (col === fillLeft) shadows.push(`inset 2px 0 0 0 ${FILL}`)
          if (col === fillRight) shadows.push(`inset -2px 0 0 0 ${FILL}`)
        }
        const kind = LOOKUP_BY_FIELD[c.field]
        const state: CellState = result?.cells?.[c.field] ?? "empty"
        const label = `${c.label}, row ${rowIndex + 1}`
        const placeholder = rowIndex === 0 ? c.hint : undefined
        const common = {
          value: row[c.field],
          label,
          placeholder,
          state,
          suggestion: suggested.split(",").includes(c.field),
          active,
          editing: editingCol === col,
          inputRef: (el: HTMLInputElement | null) => {
            if (el) {
              el.dataset.cell = "1"
              el.dataset.row = String(rowIndex)
              el.dataset.col = String(col)
            }
            api.ref(rowIndex, col, el)
          },
          onChange: (value: string) => api.change(rowIndex, col, value),
        }
        const isOpen = Boolean(open && open.col === col && kind && answer)
        const lookup =
          isOpen && kind && answer
            ? answer(kind, row, open!.queryActive ? row[c.field] : "")
            : null

        return (
          <td
            key={c.field}
            data-grid-row={rowIndex}
            data-grid-col={col}
            aria-selected={selected || active}
            style={
              shadows.length > 0 ? { boxShadow: shadows.join(", ") } : undefined
            }
            className={`relative border-r border-b border-ink/12 p-0 ${c.width} ${selected && !active ? "bg-pitch-600/[0.07]" : ""} ${
              isOpen ? "z-30" : ""
            }`}
          >
            {kind ? (
              <LookupCell
                {...common}
                listId={`${listBase}-${rowIndex}-${col}`}
                open={isOpen}
                dropUp={open?.dropUp ?? false}
                alignEnd={col >= COLUMN_COUNT - 3}
                options={lookup?.options ?? []}
                loading={lookup?.loading ?? false}
                emptyHint={lookup?.emptyHint}
                highlight={open?.highlight ?? 0}
                onHighlight={api.highlight}
                onChoose={api.choose}
              />
            ) : (
              <PlainCell {...common} />
            )}
            {handleCol === col && (
              <span
                data-fill-handle=""
                aria-hidden="true"
                title="Drag to fill"
                style={{ touchAction: "none" }}
                className="absolute -right-[5px] -bottom-[5px] z-20 flex size-3 cursor-crosshair items-center justify-center pointer-coarse:size-5"
              >
                <span className="size-2 border border-white bg-pitch-600 pointer-coarse:size-3" />
              </span>
            )}
          </td>
        )
      })}
    </tr>
  )
})

// ---------------------------------------------------------------------------
// The right-click menu. Keyboard-reachable (Shift+F10 or the Menu key), and a
// real menu: arrows move, Enter activates, Escape returns to the grid.
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string
  shortcut?: string
  detail?: string
  enabled: boolean
  destructive?: boolean
  run: () => void
}

function GridMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: (refocus: boolean) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
    buttons.current.find((b) => b && !b.disabled)?.focus()
  }, [x, y])

  useEffect(() => {
    function away(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose(false)
    }
    function scroll() {
      onClose(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("resize", scroll)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("resize", scroll)
    }
  }, [onClose])

  function step(from: number, delta: number) {
    const enabled = items
      .map((it, i) => (it.enabled ? i : -1))
      .filter((i) => i >= 0)
    if (enabled.length === 0) return
    const at = enabled.indexOf(from)
    const next = enabled[(at + delta + enabled.length) % enabled.length]
    buttons.current[next]?.focus()
  }

  return (
    <div
      ref={ref}
      data-grid-menu=""
      role="menu"
      aria-label="Cell actions"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const index = buttons.current.findIndex(
          (b) => b === document.activeElement
        )
        if (e.key === "ArrowDown") {
          e.preventDefault()
          step(index, 1)
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          step(index, -1)
        } else if (e.key === "Home") {
          e.preventDefault()
          step(-1, 1)
        } else if (e.key === "End") {
          e.preventDefault()
          step(items.length, -1)
        } else if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault()
          onClose(true)
        }
      }}
      className="fixed z-50 min-w-56 rounded-lg border border-ink/15 bg-white py-1 text-sm shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            buttons.current[i] = el
          }}
          type="button"
          role="menuitem"
          disabled={!item.enabled}
          tabIndex={-1}
          onClick={() => {
            onClose(true)
            item.run()
          }}
          className={`flex w-full items-baseline justify-between gap-6 px-3 py-1.5 text-left outline-none hover:bg-ink/[0.05] focus-visible:bg-pitch-600/10 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent ${
            item.destructive ? "text-destructive-text" : "text-ink"
          }`}
        >
          <span>{item.label}</span>
          <span className="text-xs text-ink-muted">
            {item.detail ?? item.shortcut}
          </span>
        </button>
      ))}
    </div>
  )
}
