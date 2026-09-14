/**
 * THE ONE DRAFT ROW, AND THE RULES FOR READING ONE.
 *
 * Deliberately free of `server-only`: the grid in the browser and the
 * matching engine on the server must agree about what "14/08/27" means,
 * and the only way to guarantee that is for both to call the same
 * function. A second copy of these rules living in the client is how a
 * cell comes to show one date and create another.
 *
 * Typing into the planner, pasting a block out of Excel, uploading a CSV
 * and expanding a Fixture Day all produce THIS shape and nothing else --
 * four ways in, one row model, one validation model, one creation
 * pipeline.
 */

import { parseFixtureType } from "./fixture-type"
import { normaliseHeader } from "./header-vocabulary"

export interface PlannerDraftRow {
  /** Stable only for the life of the browser session -- never a fixture id. */
  key: string
  date: string
  kickoff: string
  meet: string
  homeAway: string
  ourTeam: string
  oppositionClub: string
  oppositionTeam: string
  competition: string
  venue: string
  pitch: string
  notes: string
  /** Friendly, League, Cup or Other. Last, so a paste laid out for the older columns still lands where it did. */
  fixtureType: string
}

/** The editable fields, in the order the grid shows them. */
export const PLANNER_FIELDS = [
  "date",
  "kickoff",
  "meet",
  "homeAway",
  "ourTeam",
  "oppositionClub",
  "oppositionTeam",
  "competition",
  "venue",
  "pitch",
  "notes",
  "fixtureType",
] as const

export type PlannerField = (typeof PLANNER_FIELDS)[number]

export type CellState = "empty" | "valid" | "suggested" | "review" | "error"

export type PlannerRowStatus = "blank" | "ready" | "review" | "conflict" | "invalid"

export interface PlannerRowResult {
  key: string
  status: PlannerRowStatus
  errors: string[]
  cells: Partial<Record<PlannerField, CellState>>
  resolvedOurTeamId: string | null
  resolvedOppositionTeamId: string | null
  resolvedOppositionDirectoryId: string | null
  resolvedCompetitionEditionId: string | null
  resolvedVenueId: string | null
  resolvedPitchId: string | null
  conflictingFixtureId: string | null
  /** True when the opponent is a real Ovalball team, so creating asks rather than books. */
  willSendRequest: boolean
}

let nextKey = 0

export function blankRow(): PlannerDraftRow {
  nextKey += 1
  return {
    key: `r${nextKey}`,
    date: "",
    kickoff: "",
    meet: "",
    homeAway: "",
    ourTeam: "",
    oppositionClub: "",
    oppositionTeam: "",
    competition: "",
    venue: "",
    pitch: "",
    notes: "",
    fixtureType: "",
  }
}

export function blankRows(count: number): PlannerDraftRow[] {
  return Array.from({ length: count }, blankRow)
}

/** A row nobody has typed in yet is not an error; it is simply not a fixture. */
export function isBlankRow(row: PlannerDraftRow): boolean {
  return PLANNER_FIELDS.every((f) => !row[f])
}

/**
 * Normalises the shorthand a spreadsheet actually contains.
 *
 * "H", "home" and "HOME" all mean the same thing to a person and must
 * mean the same thing here. Anything else is refused rather than guessed,
 * so the cell can say it does not understand -- publishing an away match
 * at the club's own ground sends every parent to the wrong postcode.
 */
export function normaliseHomeAway(raw: string): "Home" | "Away" | null {
  const v = raw.trim().toLowerCase()
  if (v === "h" || v === "home") return "Home"
  if (v === "a" || v === "away") return "Away"
  return null
}

/**
 * UK spreadsheet dates, canonicalised -- or refused.
 *
 * 14/08/2027 and 2027-08-14 are both ordinary in a club's spreadsheet, so
 * both are read. 08/14/2027 is not a UK date and is NOT quietly read as
 * one: a month over 12 refuses rather than swapping the parts, because
 * silently moving a fixture by several months is worse than asking.
 */
export function normaliseDate(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isRealDate(v) ? v : null

  const parts = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (!parts) return null
  const day = Number(parts[1])
  const month = Number(parts[2])
  const year = parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3])
  if (month < 1 || month > 12) return null
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return isRealDate(iso) ? iso : null
}

/** 31 September is a typo, not a date, and the grid should say so before the database does. */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** 09:30, 9:30 and 0930 are all a kick-off time. 25:00 is not. */
export function normaliseTime(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const colon = v.match(/^(\d{1,2}):(\d{2})$/)
  const bare = v.match(/^(\d{3,4})$/)
  let h: number
  let m: number
  if (colon) {
    h = Number(colon[1])
    m = Number(colon[2])
  } else if (bare) {
    const padded = bare[1].padStart(4, "0")
    h = Number(padded.slice(0, 2))
    m = Number(padded.slice(2))
  } else {
    return null
  }
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/**
 * Turns one draft row into the raw record the CANONICAL import engine
 * already knows how to match.
 *
 * The club is implied, never typed: a club-scoped planner belongs to one
 * club, and the engine's restrictHomeClubId narrows team resolution to
 * it. Home/Away travels as its own value rather than by swapping the
 * sides, because the engine resolves our team from the home_team column
 * and swapping would send it looking for our own side in the opponent's
 * club.
 *
 * A value the planner could not read is OMITTED rather than passed on.
 * The grid has already said which cell it cannot read; sending the
 * unreadable text onward earns a second, differently worded complaint
 * about the same cell.
 */
export function toRawRecord(row: PlannerDraftRow): Record<string, string> {
  return {
    home_team: row.ourTeam,
    away_club: row.oppositionClub,
    away_team: row.oppositionTeam,
    date: normaliseDate(row.date) ?? "",
    kickoff: normaliseTime(row.kickoff) ?? "",
    meet_time: normaliseTime(row.meet) ?? "",
    home_away: normaliseHomeAway(row.homeAway) ?? "",
    competition: row.competition,
    venue_name: row.venue,
    pitch_name: row.pitch,
    notes: row.notes,
    // The stored classification for a person's word ("league" -> League Fixture). An unrecognised word is the Type cell's error, not the engine's.
    game_type: parseFixtureType(row.fixtureType) ?? "",
  }
}

/**
 * READS WHAT A SPREADSHEET PUTS ON THE CLIPBOARD.
 *
 * Excel, Google Sheets, Numbers and every league site's HTML table all
 * serialise a selected range the same way: cells separated by tabs, rows
 * by newlines. That is the whole format, and it is why no CSV file is
 * needed to get a season into Ovalball.
 *
 * Two details that are not obvious and both come from real files:
 * a trailing newline is an artefact of the copy, not an empty fixture, so
 * trailing blank lines are dropped; and a cell containing a line break
 * arrives wrapped in double quotes, which are unwrapped rather than left
 * in the middle of somebody's venue name.
 */
export function parseClipboardGrid(text: string): string[][] {
  const normalised = text.replace(/\r\n?/g, "\n")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i]
    if (quoted) {
      if (ch === '"') {
        if (normalised[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === "") {
      quoted = true
    } else if (ch === "\t") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }
  row.push(cell)
  rows.push(row)

  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop()
  return rows.map((r) => r.map((c) => c.trim()))
}

/** True when the clipboard holds a block rather than one cell's worth of text. */
export function isGridPaste(text: string): boolean {
  return text.includes("\t") || text.trim().includes("\n")
}

/**
 * Writes a pasted block into the grid at (rowIndex, fieldIndex), growing
 * the grid downward as far as the block needs.
 *
 * The block is clipped at the right-hand edge rather than wrapping: a
 * person who pastes eleven columns into the Venue column meant to paste
 * somewhere else, and wrapping their data onto the next fixture's row
 * would be a mess to unpick. Growth downward is unbounded because a
 * season is long and that is the whole point of the surface.
 */
export function applyGridPaste(
  rows: PlannerDraftRow[],
  rowIndex: number,
  fieldIndex: number,
  block: string[][],
): PlannerDraftRow[] {
  const needed = rowIndex + block.length
  const next = rows.map((r) => ({ ...r }))
  while (next.length < needed) next.push(blankRow())

  block.forEach((cells, r) => {
    const target = next[rowIndex + r]
    cells.forEach((value, c) => {
      const field = PLANNER_FIELDS[fieldIndex + c]
      if (!field) return
      target[field] = value
    })
  })

  return next
}

/**
 * The header vocabulary's canonical names, mapped onto planner fields.
 *
 * This is the whole of "CSV support" in the planner: a file is read into
 * the same rows a paste produces, and from there nothing knows or cares
 * that a file was involved. There is no second parser, no second matching
 * pass and no separate review screen -- which is why an uploaded file and
 * a pasted block cannot disagree about what Ovalball understood.
 */
const FIELD_BY_HEADER: Record<string, PlannerField> = {
  date: "date",
  kickoff: "kickoff",
  meettime: "meet",
  homeaway: "homeAway",
  hometeam: "ourTeam",
  awayclub: "oppositionClub",
  awayteam: "oppositionTeam",
  competition: "competition",
  venuename: "venue",
  pitchname: "pitch",
  notes: "notes",
  type: "fixtureType",
  fixturetype: "fixtureType",
  gametype: "fixtureType",
}

/** The planner column a file's header means, if it means one. */
export function plannerFieldForHeader(header: string): PlannerField | null {
  return FIELD_BY_HEADER[normaliseHeader(header)] ?? null
}

/**
 * Turns parsed file records into draft rows, and says what it ignored.
 *
 * Unrecognised columns are NOT an error -- a league's file carries all
 * sorts of things Ovalball has no home for, and refusing the file over a
 * "Referee" column would be absurd. They are named instead, so nobody
 * believes a column made it in when it did not.
 */
export function rowsFromRecords(records: Record<string, string>[]): {
  rows: PlannerDraftRow[]
  ignoredColumns: string[]
} {
  const ignored = new Set<string>()
  const rows = records.map((record) => {
    const row = blankRow()
    for (const [header, value] of Object.entries(record)) {
      const field = FIELD_BY_HEADER[normaliseHeader(header)]
      if (!field) {
        if (header.trim()) ignored.add(header.trim())
        continue
      }
      // First writer wins, so a file carrying both "Date" and "Fixture
      // Date" keeps the one the person put first rather than the one that
      // happened to be enumerated last.
      if (!row[field]) row[field] = (value ?? "").trim()
    }
    return row
  })
  return { rows: rows.filter((r) => !isBlankRow(r)), ignoredColumns: [...ignored] }
}

/**
 * FIXTURE DAY, WHICH IS NOT A THING -- it is a shape of typing.
 *
 * A club playing one opponent across six age grades on one Saturday is
 * six ordinary fixtures that happen to share a date, a venue and an
 * opponent. Giving that a database table, a wizard or a state machine
 * would create a second kind of fixture that every later feature then has
 * to know about. So Fixture Day simply WRITES THE ROWS, and the moment it
 * has, it is over: the person edits, checks and creates exactly as if
 * they had typed the six rows themselves.
 */
export function fixtureDayRows(input: {
  date: string
  oppositionClub: string
  venue: string
  homeAway: string
  firstKickoff: string
  minutesBetween: number
  teams: string[]
}): PlannerDraftRow[] {
  const base = normaliseTime(input.firstKickoff)
  return input.teams.map((team, index) => {
    const row = blankRow()
    row.date = input.date
    row.oppositionClub = input.oppositionClub
    row.venue = input.venue
    row.homeAway = input.homeAway
    row.ourTeam = team
    // Staggered kick-offs are the normal case -- one pitch cannot host six
    // matches at eleven o'clock -- but a club that wants them all at once
    // says so by setting the gap to zero.
    row.kickoff = base ? addMinutes(base, index * input.minutesBetween) : input.firstKickoff
    return row
  })
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

/** The count a person cares about: how many of these will become fixtures. */
export function summariseResults(results: PlannerRowResult[]) {
  let ready = 0
  let attention = 0
  let requests = 0
  for (const r of results) {
    if (r.status === "blank") continue
    if (r.status === "ready") {
      ready += 1
      if (r.willSendRequest) requests += 1
    } else {
      attention += 1
    }
  }
  return { ready, attention, requests }
}
