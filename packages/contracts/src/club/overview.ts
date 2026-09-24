import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadAgenda, type AgendaItem } from "../agenda/load"
import { loadClubEvents, type ClubEventItem } from "../agenda/events"
import { shiftDays } from "../agenda/window"
import { loadClubAttention } from "../attention/club"
import { sortAttention, type AttentionItem } from "../attention/model"
import { readClubTeams, type ClubTeam } from "./teams"
import { readClubFixtureRequests } from "./requests"

type Client = SupabaseClient<Database>

/**
 * THE CLUB, IN ONE READ (CA-M10): what needs me, what is on today, what is next, how the fixtures stand,
 * which sides need something, and what I may legitimately do from here.
 *
 * ONE AUTHORITY PROBE at club scope -- `my_capabilities('club', clubId)` -- and every read behind it
 * asks only where that probe says yes. Nothing here is a role label: a Club Admin, a Fixture Secretary
 * and a read-only club member all read this projection and see what their capabilities allow. The
 * server refuses regardless; the probe only decides what is offered.
 */
export const CLUB_AUTHORITY_KEYS = {
  fixtureView: "fixture.fixture.view",
  fixtureCreate: "fixture.fixture.create",
  fixtureEdit: "fixture.fixture.edit",
  fixtureCancel: "fixture.fixture.cancel",
  requestCreate: "fixture.request.create",
  requestRespond: "fixture.request.respond",
  resultRecord: "fixture.result.record",
  plannerUse: "fixture.planner.use",
  importRun: "fixture.import.run",
  competitionCreator: "competition.creator.use",
  peopleView: "people.member.view",
  teamManage: "team.team.manage",
  venueView: "venue.venue.view",
  venueManage: "venue.venue.manage",
  pitchAllocationView: "venue.pitch_allocation.view",
  pitchAllocationManage: "venue.pitch_allocation.manage",
  eventView: "calendar.event.view",
  eventManage: "calendar.event.manage",
  newsManage: "club.news.manage",
  profileEdit: "club.profile.edit",
  capabilityManage: "people.capability.manage",
  financeView: "finance.subscription.view",
} as const

export type ClubAuthority = Record<keyof typeof CLUB_AUTHORITY_KEYS, boolean>

export function noClubAuthority(): ClubAuthority {
  return Object.fromEntries(Object.keys(CLUB_AUTHORITY_KEYS).map((k) => [k, false])) as ClubAuthority
}

export async function readClubAuthority(supabase: Client, clubId: string): Promise<ClubAuthority> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return Object.fromEntries(Object.entries(CLUB_AUTHORITY_KEYS).map(([k, key]) => [k, allowed.has(key)])) as ClubAuthority
}

/** Anything that makes the club's fixtures this person's job, beyond reading them. */
export function anyClubFixtureManagement(a: ClubAuthority): boolean {
  return a.fixtureCreate || a.fixtureEdit || a.fixtureCancel || a.requestCreate || a.requestRespond || a.resultRecord
}

/** The desk tools: never native, offered as a deliberate hand-off where held. */
export function anyDeskFixtureTool(a: ClubAuthority): boolean {
  return a.plannerUse || a.importRun || a.competitionCreator
}

export interface ClubTeamSummary {
  team: ClubTeam
  players: number
  staff: number
  nextFixture: AgendaItem | null
}

export interface ClubFixtureSnapshot {
  today: number
  upcoming: number
  /** Upcoming fixtures still missing a kick-off, or a ground for a home match. */
  incomplete: number
  /** Kick-off changes proposed by the other club, and results waiting for our confirmation. */
  awaitingUs: number
  requestsIncoming: number
}

export interface ClubOverview {
  clubId: string
  authority: ClubAuthority
  todayIso: string
  /** Fixtures and training on today, in kick-off order. */
  today: AgendaItem[]
  eventsToday: ClubEventItem[]
  /** The next thing that is on, after today. */
  next: AgendaItem | null
  upcoming: AgendaItem[]
  snapshot: ClubFixtureSnapshot
  teams: ClubTeamSummary[]
  attention: AttentionItem[]
}

export const CLUB_UPCOMING_DAYS = 14
export const CLUB_TEAM_HORIZON_DAYS = 60

export async function loadClubOverview(supabase: Client, clubId: string, clubName: string, todayIso: string): Promise<ClubOverview> {
  const authority = await readClubAuthority(supabase, clubId).catch(() => noClubAuthority())
  const scope = { kind: "club" as const, clubId, clubName }
  const horizon = { startIso: todayIso, endIso: shiftDays(todayIso, CLUB_TEAM_HORIZON_DAYS), label: "the next two months", order: "asc" as const }

  const [agenda, directory, events, attention] = await Promise.all([
    loadAgenda(supabase, scope, horizon, { includeTraining: true }).catch(() => ({ items: [], truncated: false })),
    readClubTeams(supabase, clubId).catch(() => ({ rugbyCode: null, teams: [], groups: [], folded: [] })),
    authority.eventView ? loadClubEvents(supabase, [clubId], { startIso: todayIso, endIso: todayIso }).catch(() => []) : Promise.resolve([]),
    loadClubAttention(supabase, clubId, todayIso).catch(() => []),
  ])

  const on = agenda.items.filter((i) => i.status !== "Cancelled")
  const today = on.filter((i) => i.date === todayIso)
  const later = on.filter((i) => i.date > todayIso)
  const withinFortnight = later.filter((i) => i.date <= shiftDays(todayIso, CLUB_UPCOMING_DAYS))
  const fixturesAhead = withinFortnight.filter((i) => i.kind === "fixture")

  const activeTeams = directory.teams.filter((t) => t.active)
  const teamIds = activeTeams.map((t) => t.id)
  const [players, staff, requests] = await Promise.all([
    teamIds.length ? supabase.from("player_team_memberships").select("team_id").in("team_id", teamIds).eq("status", "active").then((r) => r.data ?? []) : Promise.resolve([]),
    teamIds.length ? supabase.from("team_permissions").select("team_id").in("team_id", teamIds).then((r) => r.data ?? []) : Promise.resolve([]),
    authority.requestRespond && teamIds.length ? readClubFixtureRequests(supabase, activeTeams.map((t) => ({ id: t.id, name: t.displayName }))).catch(() => ({ incoming: [], outgoing: [] })) : Promise.resolve({ incoming: [], outgoing: [] }),
  ])
  const playerCount = new Map<string, number>()
  for (const p of players) if (p.team_id) playerCount.set(p.team_id, (playerCount.get(p.team_id) ?? 0) + 1)
  const staffCount = new Map<string, number>()
  for (const s of staff) if (s.team_id) staffCount.set(s.team_id, (staffCount.get(s.team_id) ?? 0) + 1)

  const teams: ClubTeamSummary[] = activeTeams.map((team) => ({
    team,
    players: playerCount.get(team.id) ?? 0,
    staff: staffCount.get(team.id) ?? 0,
    nextFixture: [...today, ...later].find((i) => i.kind === "fixture" && i.teamId === team.id) ?? null,
  }))

  const incomplete = fixturesAhead.filter((i) => !i.time || (i.homeAway === "Home" && !i.venue)).length
  const awaitingUs = attention.filter((a) => a.sourceType === "kickoff_proposal" || a.sourceType === "result_confirmation").length

  return {
    clubId,
    authority,
    todayIso,
    today,
    eventsToday: events,
    next: later[0] ?? null,
    upcoming: later.slice(0, 5),
    snapshot: {
      today: today.filter((i) => i.kind === "fixture").length,
      upcoming: fixturesAhead.length,
      incomplete: authority.fixtureEdit ? incomplete : 0,
      awaitingUs,
      requestsIncoming: requests.incoming.filter((r) => r.status === "sent").length,
    },
    teams,
    attention: sortAttention(attention),
  }
}
