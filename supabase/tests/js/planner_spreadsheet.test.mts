import { test } from "node:test"
import assert from "node:assert/strict"

import { PLANNER_FIELDS, blankRows, parseClipboardGrid, type PlannerDraftRow } from "@/lib/fixtures/planner-model"
import {
  cellSelection,
  clearRange,
  deleteRows,
  fillDown,
  fillRange,
  fillRight,
  fillTarget,
  moveSelection,
  pasteBlock,
  pushUndo,
  rangeOf,
  rangeToTsv,
  rowsContiguous,
  rowsToTsv,
  selectRows,
  UNDO_LIMIT,
} from "@/lib/fixtures/planner-grid"
import { buildLookupIndex, exactEntry, rememberRecent, searchLookup } from "@/lib/fixtures/planner-lookup"

/**
 * MASS FIXTURE PLANNER -- the spreadsheet rules a fixture secretary relies on.
 *
 * These are the behaviours that must hold regardless of how the grid is drawn:
 * a fill repeats a pattern, a paste keeps its shape, a clear keeps the rows, a
 * delete keeps the blank pool, and a lookup only ever offers what the server
 * supplied.
 */

const col = (field: (typeof PLANNER_FIELDS)[number]) => PLANNER_FIELDS.indexOf(field)
const OPP = col("oppositionClub")
const TEAM = col("ourTeam")
const DATE = col("date")

function grid(n = 10): PlannerDraftRow[] {
  return blankRows(n)
}

test("a two-cell Opposition pattern dragged four rows further repeats in order", () => {
  let rows = grid()
  rows[0].oppositionClub = "Hinckley"
  rows[1].oppositionClub = "Nuneaton"
  const source = { top: 0, bottom: 1, left: OPP, right: OPP }
  const target = fillTarget(source, { row: 5, col: OPP })
  assert.deepEqual(target, { top: 0, bottom: 5, left: OPP, right: OPP })
  rows = fillRange(rows, source, target!)
  assert.deepEqual(
    rows.slice(0, 6).map((r) => r.oppositionClub),
    ["Hinckley", "Nuneaton", "Hinckley", "Nuneaton", "Hinckley", "Nuneaton"],
  )
})

test("a fill repeats dates exactly -- the planner does no date arithmetic", () => {
  let rows = grid()
  rows[0].date = "14/09/2027"
  rows = fillRange(rows, { top: 0, bottom: 0, left: DATE, right: DATE }, { top: 0, bottom: 3, left: DATE, right: DATE })
  assert.deepEqual(rows.slice(0, 4).map((r) => r.date), ["14/09/2027", "14/09/2027", "14/09/2027", "14/09/2027"])
})

test("a fill goes one way: the axis the pointer left furthest along", () => {
  const source = { top: 2, bottom: 2, left: 3, right: 3 }
  assert.deepEqual(fillTarget(source, { row: 6, col: 4 }), { top: 2, bottom: 6, left: 3, right: 3 })
  assert.deepEqual(fillTarget(source, { row: 3, col: 7 }), { top: 2, bottom: 2, left: 3, right: 7 })
  assert.deepEqual(fillTarget(source, { row: 0, col: 3 }), { top: 0, bottom: 2, left: 3, right: 3 })
  assert.equal(fillTarget(source, { row: 2, col: 3 }), null)
})

test("an upward fill keeps the pattern aligned to its source", () => {
  let rows = grid()
  rows[4].ourTeam = "Under 7 Mixed"
  rows[5].ourTeam = "Under 8 Mixed"
  rows = fillRange(rows, { top: 4, bottom: 5, left: TEAM, right: TEAM }, { top: 2, bottom: 5, left: TEAM, right: TEAM })
  assert.deepEqual(rows.slice(2, 6).map((r) => r.ourTeam), ["Under 7 Mixed", "Under 8 Mixed", "Under 7 Mixed", "Under 8 Mixed"])
})

test("a fill grows the grid rather than silently stopping at its last row", () => {
  let rows = grid(3)
  rows[0].homeAway = "H"
  rows = fillRange(rows, { top: 0, bottom: 0, left: col("homeAway"), right: col("homeAway") }, { top: 0, bottom: 6, left: col("homeAway"), right: col("homeAway") })
  assert.equal(rows.length, 7)
  assert.equal(rows[6].homeAway, "H")
})

test("Fill Down copies the top row of the selection; one row takes the row above", () => {
  let rows = grid()
  rows[0].venue = "Ovalball UAT Ground"
  rows[0].pitch = "Pitch 1"
  const r = { top: 0, bottom: 3, left: col("venue"), right: col("pitch") }
  rows = fillDown(rows, r).rows
  assert.ok(rows.slice(0, 4).every((x) => x.venue === "Ovalball UAT Ground" && x.pitch === "Pitch 1"))

  rows[5].notes = "Bring bibs"
  rows = fillDown(rows, { top: 6, bottom: 6, left: col("notes"), right: col("notes") }).rows
  assert.equal(rows[6].notes, "Bring bibs")
  assert.equal(fillDown(grid(), { top: 0, bottom: 0, left: 0, right: 0 }).changed, false)
})

test("Fill Right copies the left column across", () => {
  let rows = grid()
  rows[0].kickoff = "11:00"
  rows = fillRight(rows, { top: 0, bottom: 0, left: col("kickoff"), right: col("meet") }).rows
  assert.equal(rows[0].meet, "11:00")
})

test("copy writes tab/newline text Excel and Sheets read, quoting what needs it", () => {
  const rows = grid()
  rows[0].ourTeam = "Under 12 Boys"
  rows[0].oppositionClub = "Aberaeron RFC"
  rows[1].ourTeam = "Under 13 Boys"
  rows[1].oppositionClub = 'The "Quins"\tAway'
  const tsv = rangeToTsv(rows, { top: 0, bottom: 1, left: TEAM, right: OPP })
  assert.equal(tsv, 'Under 12 Boys\tAberaeron RFC\nUnder 13 Boys\t"The ""Quins""\tAway"')
  // And the planner's own clipboard reader gets the same cells back.
  assert.deepEqual(parseClipboardGrid(tsv), [
    ["Under 12 Boys", "Aberaeron RFC"],
    ["Under 13 Boys", 'The "Quins"\tAway'],
  ])
})

test("copying whole rows gives every column in grid order, gaps and all", () => {
  const rows = grid()
  rows[3].ourTeam = "Under 9 Mixed"
  rows[1].ourTeam = "Under 8 Mixed"
  const lines = rowsToTsv(rows, [3, 1]).split("\n")
  assert.equal(lines.length, 2)
  assert.equal(lines[0].split("\t").length, PLANNER_FIELDS.length)
  assert.equal(lines[0].split("\t")[TEAM], "Under 8 Mixed")
})

test("one copied cell pasted into a larger selection fills all of it", () => {
  const { rows, written } = pasteBlock(grid(), { top: 1, bottom: 4, left: OPP, right: OPP }, [["Hinckley RFC"]])
  assert.deepEqual(written, { top: 1, bottom: 4, left: OPP, right: OPP })
  assert.deepEqual(rows.slice(1, 5).map((r) => r.oppositionClub), ["Hinckley RFC", "Hinckley RFC", "Hinckley RFC", "Hinckley RFC"])
  assert.equal(rows[0].oppositionClub, "")
})

test("a block pasted into an exact multiple of its size tiles; otherwise it keeps its geometry", () => {
  const block = [["Hinckley"], ["Nuneaton"]]
  const tiled = pasteBlock(grid(), { top: 0, bottom: 5, left: OPP, right: OPP }, block)
  assert.deepEqual(tiled.rows.slice(0, 6).map((r) => r.oppositionClub), ["Hinckley", "Nuneaton", "Hinckley", "Nuneaton", "Hinckley", "Nuneaton"])

  const kept = pasteBlock(grid(), { top: 0, bottom: 4, left: OPP, right: OPP }, block)
  assert.deepEqual(kept.written, { top: 0, bottom: 1, left: OPP, right: OPP })
  assert.equal(kept.rows[2].oppositionClub, "")
})

test("a rectangular paste keeps its shape, grows the grid, and clips at the right edge", () => {
  const block = [
    ["Pitch 1", "note a", "Friendly", "overflow"],
    ["Pitch 2", "note b", "League", "overflow"],
    ["Pitch 3", "note c", "Cup", "overflow"],
  ]
  const { rows, written } = pasteBlock(grid(2), { top: 0, bottom: 0, left: col("pitch"), right: col("pitch") }, block)
  assert.equal(rows.length, 3)
  assert.deepEqual(written, { top: 0, bottom: 2, left: col("pitch"), right: col("fixtureType") })
  assert.deepEqual(rows.map((r) => [r.pitch, r.notes, r.fixtureType]), [["Pitch 1", "note a", "Friendly"], ["Pitch 2", "note b", "League"], ["Pitch 3", "note c", "Cup"]])
})

test("an external spreadsheet paste lands exactly as a copied internal range does", () => {
  const excel = "01/01/2029\t11:00\t10:15\tH\tUnder 12 Boys\tAberaeron Rugby Football Club\r\n02/01/2029\t1400\t13:15\tAway\tUnder 13 Boys\tAbercarn Rugby Football Club\r\n"
  const { rows } = pasteBlock(grid(), { top: 0, bottom: 0, left: 0, right: 0 }, parseClipboardGrid(excel))
  const internal = rangeToTsv(rows, { top: 0, bottom: 1, left: 0, right: OPP })
  assert.equal(internal.replace(/\n/g, "\r\n") + "\r\n", excel)
})

test("Clear Contents empties the cells and keeps every row in place", () => {
  const rows = grid(4)
  rows[1].ourTeam = "Under 12 Boys"
  rows[1].notes = "keep me"
  rows[2].ourTeam = "Under 13 Boys"
  const cleared = clearRange(rows, { top: 1, bottom: 2, left: TEAM, right: OPP })
  assert.equal(cleared.length, 4)
  assert.equal(cleared[1].key, rows[1].key)
  assert.equal(cleared[1].ourTeam, "")
  assert.equal(cleared[2].ourTeam, "")
  assert.equal(cleared[1].notes, "keep me")
})

test("Delete Selected Rows removes the rows and restores the blank pool", () => {
  const rows = grid(25)
  rows.forEach((r, i) => (r.notes = `row ${i + 1}`))
  const after = deleteRows(rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 25)
  assert.equal(after.length, 25)
  assert.equal(after[0].notes, "row 11")
  assert.ok(after.slice(15).every((r) => r.notes === ""))

  const big = grid(40)
  assert.equal(deleteRows(big, [0, 1], 25).length, 38)
})

test("row numbers select like a spreadsheet: click, Shift-click range, Cmd-click toggle", () => {
  assert.deepEqual(selectRows([], null, 4, "replace"), [4])
  assert.deepEqual(selectRows([4], 4, 7, "extend"), [4, 5, 6, 7])
  assert.deepEqual(selectRows([4, 5, 6, 7], 7, 9, "toggle"), [4, 5, 6, 7, 9])
  assert.deepEqual(selectRows([4, 5, 6, 7, 9], 9, 5, "toggle"), [4, 6, 7, 9])
  assert.equal(rowsContiguous([4, 5, 6]), true)
  assert.equal(rowsContiguous([4, 6]), false)
})

test("arrows move and collapse; Shift+arrows extend from the active cell", () => {
  let sel = cellSelection(2, 2)
  sel = moveSelection(sel, 1, 0, 10, true)
  sel = moveSelection(sel, 1, 1, 10, true)
  assert.deepEqual(rangeOf(sel), { top: 2, bottom: 4, left: 2, right: 3 })
  assert.deepEqual(sel.anchor, { row: 2, col: 2 })
  sel = moveSelection(sel, 0, -1, 10, false)
  assert.deepEqual(rangeOf(sel), { top: 2, bottom: 2, left: 1, right: 1 })
  assert.deepEqual(rangeOf(moveSelection(cellSelection(0, 0), -1, -1, 10, false)), { top: 0, bottom: 0, left: 0, right: 0 })
  assert.equal(moveSelection(cellSelection(9, 10), 1, 1, 10, false).anchor.row, 9)
})

test("each bulk operation is one bounded undo entry", () => {
  let stack = pushUndo([], "Paste", grid(1))
  stack = pushUndo(stack, "Fill", grid(1))
  assert.deepEqual(stack.map((e) => e.label), ["Paste", "Fill"])
  for (let i = 0; i < UNDO_LIMIT + 5; i++) stack = pushUndo(stack, `op${i}`, grid(1))
  assert.equal(stack.length, UNDO_LIMIT)
})

// ---------------------------------------------------------------------------
// LOOKUPS
// ---------------------------------------------------------------------------

const TEAMS = buildLookupIndex([
  { id: "u7", label: "Under 7 Mixed", aliases: ["U7"], context: ["U7/U8 Tags"], hint: "U7/U8 Tags" },
  { id: "u8", label: "Under 8 Mixed", aliases: ["U8"], context: ["U7/U8 Tags"], hint: "U7/U8 Tags" },
  { id: "u12", label: "Under 12 Boys", aliases: ["U12"] },
  { id: "g12", label: "Under 12 Girls", aliases: ["Girls U12"] },
])

test("a team is found by its display name, its compact name, or its Mini-Rugby Group", () => {
  assert.deepEqual(searchLookup(TEAMS, "under 12").map((e) => e.id), ["u12", "g12"])
  // U7 itself first; U8 still answers, because it shares the U7/U8 group.
  assert.deepEqual(searchLookup(TEAMS, "u7").map((e) => e.id), ["u7", "u8"])
  assert.deepEqual(searchLookup(TEAMS, "u12").map((e) => e.id), ["u12", "g12"])
  assert.deepEqual(searchLookup(TEAMS, "7/8").map((e) => e.id), ["u7", "u8"])
  assert.deepEqual(searchLookup(TEAMS, "tags").map((e) => e.id), ["u7", "u8"])
  assert.deepEqual(searchLookup(TEAMS, "girls").map((e) => e.id), ["g12"])
})

test("search never invents an option -- an unknown value returns nothing", () => {
  assert.deepEqual(searchLookup(TEAMS, "Under 99 Wizards"), [])
  assert.equal(exactEntry(TEAMS, "Under 99 Wizards"), null)
  assert.equal(exactEntry(TEAMS, "under 8 mixed")?.id, "u8")
})

test("exact and prefix matches outrank substring ones; recent values lead within a rank", () => {
  const clubs = buildLookupIndex([
    { id: "a", label: "Old Hinckleians RFC" },
    { id: "b", label: "Hinckley Rugby Football Club" },
    { id: "c", label: "Nuneaton Rugby Football Club" },
  ])
  assert.deepEqual(searchLookup(clubs, "hinck").map((e) => e.id), ["b", "a"])
  assert.deepEqual(searchLookup(clubs, "nuneaton rfc").map((e) => e.id), ["c"])
  assert.deepEqual(searchLookup(clubs, "", { recent: ["Nuneaton Rugby Football Club"] }).map((e) => e.id), ["c", "a", "b"])
  assert.deepEqual(rememberRecent(["x", "y"], "y"), ["y", "x"])
})

test("filtering the whole Club Directory is instant", () => {
  const big = buildLookupIndex(
    Array.from({ length: 1500 }, (_, i) => ({ id: String(i), label: `Club ${i} Rugby Football Club`, hint: "Club Directory" })),
  )
  const started = performance.now()
  for (const q of ["c", "cl", "clu", "club 1", "club 14", "club 149", "rfc"]) searchLookup(big, q, { limit: 40 })
  const perKeystroke = (performance.now() - started) / 7
  assert.ok(perKeystroke < 16, `${perKeystroke.toFixed(2)}ms per keystroke`)
})
