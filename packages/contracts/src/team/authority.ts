import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * WHAT MAY I DO WITH THIS TEAM -- ASKED OF THE SERVER, IN ONE ROUND TRIP (CA-M7).
 *
 * `my_capabilities` at TEAM scope runs `internal.capability_decision` for every active key, which is the
 * same resolver every mutation re-runs before it writes. So this is not a second opinion: it is the ONE
 * opinion, asked for the purpose of drawing an interface. Nothing here is authority. A control that is
 * hidden has not been secured and a control that is shown has not been granted; every action below is
 * refused by the database independently, so the worst a wrong answer can do is offer a button that then
 * says no. That is the acceptable direction to be wrong in.
 *
 * ROLE NAMES DO NOT APPEAR. A Coach, a Team Manager and a Volunteer who has been allowed one job all
 * arrive here as a set of keys, decided by the CA-M4 engine: role default, scoped decision, restore.
 *
 * NEVER CACHED ACROSS A CONTEXT. Re-asked on every context change and every time a screen comes back
 * into focus; a cached yes outlives the permission it came from.
 *
 * FOUR THINGS ARE DELIBERATELY ABSENT and no amount of team authority brings them back: the Planner,
 * Import, bulk edit and delete are club-scoped in the capability catalogue itself. This module never
 * asks for them at team scope, and `TEAM_AUTHORITY_KEYS` is pinned by a test so it never can.
 */
export const TEAM_AUTHORITY_KEYS = {
  view: "team.team.view",
  fixtureView: "fixture.fixture.view",
  fixtureCreate: "fixture.fixture.create",
  fixtureEdit: "fixture.fixture.edit",
  fixtureCancel: "fixture.fixture.cancel",
  fixtureArchive: "fixture.fixture.archive",
  requestCreate: "fixture.request.create",
  requestRespond: "fixture.request.respond",
  resultRecord: "fixture.result.record",
  callupRequest: "fixture.callup.request",
  attendanceView: "team.attendance.view",
  rosterView: "team.roster.view",
  rosterManage: "team.roster.manage",
  joinRequestReview: "team.join_request.review",
  joinCodeManage: "team.join_code.manage",
  roleAssignTeam: "people.role.assign_team",
  newsManage: "team.news.manage",
  announceTeam: "messaging.announcement.send_team",
  fixtureCommunicationSend: "fixture.communication.send",
  trainingPlanManage: "training.plan.manage",
  trainingSessionCancel: "training.session.cancel",
  trainingCommunicationSend: "training.communication.send",
  calendarEventManage: "calendar.event.manage",
  subscriptionView: "finance.subscription.view",
  teamManage: "team.team.manage",
  pathwayRequest: "player.pathway.request",
  playerProfileView: "player.profile.view",
} as const

export type TeamAuthorityKey = keyof typeof TEAM_AUTHORITY_KEYS

export type TeamAuthority = Record<TeamAuthorityKey, boolean>

const NONE: TeamAuthority = Object.fromEntries(Object.keys(TEAM_AUTHORITY_KEYS).map((k) => [k, false])) as TeamAuthority

export function noTeamAuthority(): TeamAuthority {
  return { ...NONE }
}

/** One `my_capabilities` read at team scope, mapped onto the keys this product draws with. */
export async function readTeamAuthority(supabase: Client, clubId: string, teamId: string): Promise<TeamAuthority> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "team", p_club_id: clubId, p_team_id: teamId })
  if (error || !data) return noTeamAuthority()
  const allowed = new Set(data.filter((row) => row.allowed === true).map((row) => row.capability_key))
  const result = noTeamAuthority()
  for (const [field, key] of Object.entries(TEAM_AUTHORITY_KEYS) as [TeamAuthorityKey, string][]) result[field] = allowed.has(key)
  return result
}

/** True where any fixture management control is worth drawing at all. */
export function anyFixtureManagement(a: TeamAuthority): boolean {
  return a.fixtureCreate || a.fixtureEdit || a.fixtureCancel || a.requestCreate || a.requestRespond
}

/** True where the Team Settings / Admin destination has at least one section to show. */
export function anyTeamAdministration(a: TeamAuthority): boolean {
  return a.rosterManage || a.joinRequestReview || a.joinCodeManage || a.roleAssignTeam || a.callupRequest || a.newsManage || a.teamManage
}
