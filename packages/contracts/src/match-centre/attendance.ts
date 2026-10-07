import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * A MATCH'S ATTENDANCE, AS THE SERVER LETS THIS VIEWER SEE IT (`get_match_centre_attendance`, 20270727).
 *
 * Per side: NAMES for that side's own staff, NUMBERS for the other side's staff and for the side's own
 * families, NOTHING for anybody else. The opposition never receives a name -- not hidden here, never
 * sent. The catering headcount is derived from the same answers and is an operational number for staff.
 */

export type AttendanceAnswer = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"

export interface SideAttendanceCounts {
  squad: number
  attending: number
  cannotAttend: number
  unsure: number
  awaiting: number
}

export interface SideAttendance {
  side: "home" | "away"
  onOvalball: boolean
  relationship: "STAFF" | "FAMILY" | null
  visibility: "NAMES" | "COUNTS" | "NONE"
  counts: SideAttendanceCounts | null
  players: { playerId: string; firstName: string; displayName: string | null; status: AttendanceAnswer | null }[] | null
}

export interface CateringSummary {
  required: boolean
  /** Staff only. */
  total?: number
  parts?: { side: "home" | "away"; attending: number }[]
  sidesNotCounted?: ("home" | "away")[]
  basis?: string
}

export interface MatchCentreAttendance {
  fixtureId: string
  viewerSide: "home" | "away" | null
  open: boolean
  opensOn: string
  openDays: number
  openedEarlyAt: string | null
  canOpen: boolean
  sides: SideAttendance[]
  catering: CateringSummary
}

export async function readMatchCentreAttendance(supabase: Client, fixtureId: string): Promise<MatchCentreAttendance> {
  const { data, error } = await supabase.rpc("get_match_centre_attendance", { p_fixture_id: fixtureId })
  if (error) throw error
  return data as unknown as MatchCentreAttendance
}

/** Staff opening their side's attendance before the default window; the families are asked at once. */
export async function openFixtureAttendance(supabase: Client, fixtureId: string): Promise<{ opened: number; invited: number }> {
  const { data, error } = await supabase.rpc("open_fixture_attendance", { p_fixture_id: fixtureId })
  if (error) throw error
  return data as unknown as { opened: number; invited: number }
}

/** The headcount, said so it can be checked: "18 attending (Home 10, Away 8)". Null when there is none to say. */
export function cateringLine(c: CateringSummary, names: { home: string; away: string }): string | null {
  if (!c.required || c.total === undefined) return null
  const parts = (c.parts ?? []).map((p) => `${p.side === "home" ? names.home : names.away} ${p.attending}`)
  return parts.length > 1 ? `${c.total} attending players (${parts.join(", ")})` : `${c.total} attending ${c.total === 1 ? "player" : "players"}`
}

/** "Attendance opens Sunday 11 October", from the server's own date. */
export function attendanceOpensLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  )
  return `Attendance opens ${label}`
}

/**
 * THE ATTENDANCE MOMENT'S SENTENCE -- the owner's words, with the real names.
 *
 * Attending: "Ava is attending against Preston Grasshoppers RFC."
 * Can't attend: "Ava isn't going to be there against Preston Grasshoppers RFC."
 * Unsure: "Things can happen! Be sure to update the poll."
 */
export function attendanceMomentCopy(input: {
  status: AttendanceAnswer
  /** Null when the person is answering for themselves. */
  firstName: string | null
  opponent: string | null
  /**
   * AN EVENT RATHER THAN A MATCH: there is nobody to be "against", so the line under the title names the
   * occasion and its day ("Christmas Party on Saturday 12 December") -- the titles and the Unsure words are
   * the owner's, unchanged. Derived for the Event Centre in the integration audit, not the owner's wording.
   */
  occasion?: { name: string; date?: string | null } | null
}): { title: string; body: string } {
  const who = input.firstName ?? "You"
  const against = input.opponent ? ` against ${input.opponent}` : ""
  const occasionLine = input.occasion ? `${input.occasion.name}${input.occasion.date ? ` on ${longDay(input.occasion.date)}` : ""}.` : null
  switch (input.status) {
    case "ATTENDING":
      return {
        title: input.firstName ? `${input.firstName} is attending!` : "You're attending!",
        body: occasionLine ?? `${input.firstName ? `${input.firstName} is` : "You're"} attending${against}.`,
      }
    case "CANNOT_ATTEND":
      return {
        title: input.firstName ? `${input.firstName} can't make it` : "You can't make it",
        body: occasionLine ?? `${input.firstName ? `${input.firstName} isn't` : "You're not"} going to be there${against}.`,
      }
    case "UNSURE":
      return { title: "Things can happen!", body: `Be sure to update the poll${who === "You" ? "" : ` for ${who}`}.` }
  }
}

/** "Saturday 12 December", from an ISO date, read as the calendar day it names. */
function longDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}
