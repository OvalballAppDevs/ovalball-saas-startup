import "server-only"
import { dedupeMirrorPairs } from "@/lib/fixtures/mirror-pair"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { SwitchableContext } from "@/lib/app-context/active-context"
import type { SessionContext } from "@/lib/app-context/session-context"

import type { AgendaEvent, AttendanceResponse } from "./agenda-model"
import { dedupeAgendaEvents } from "./agenda-model"

/**
 * Reads the canonical fixtures/training_sessions/player_fixture_attendance
 * rows behind a Guardian's agenda and turns them into the pure model in
 * agenda-model.ts.
 *
 * SCOPE IS DERIVED FROM THE SESSION, NEVER FROM THE REQUEST. The children
 * covered come from ctx.guardianRelationships -- relationships the server
 * already proved -- so a crafted query string can narrow this view but can
 * never widen it to somebody else's child. Every read below is additionally
 * RLS-scoped, so this is defence in depth rather than the boundary itself.
 */

export interface FamilyChild {
  playerId: string
  firstName: string
  surname: string
  fullName: string
  teamId: string
  teamName: string
  clubId: string
  clubName: string
  avatarStoragePath: string | null
}

/**
 * Which children the active context covers.
 *
 *   family -> every child this guardian holds (All Children)
 *   parent -> exactly the one child selected, never their siblings
 *   player -> the signed-in person's own player record
 *
 * The "parent" case filters on playerId AND teamId together: a child on two
 * teams is two contexts, and selecting one must not silently pull in the
 * other's fixtures.
 */
export function resolveFamilyScope(ctx: SessionContext, activeContext: SwitchableContext): FamilyChild[] {
  const fromGuardian = (g: SessionContext["guardianRelationships"][number]): FamilyChild => ({
    playerId: g.playerId,
    firstName: g.playerFirstName,
    surname: g.playerSurname,
    fullName: `${g.playerFirstName} ${g.playerSurname}`.trim(),
    teamId: g.teamId,
    teamName: g.teamDisplayName,
    clubId: g.clubId,
    clubName: g.clubName,
    avatarStoragePath: g.avatarStoragePath,
  })

  if (activeContext.kind === "family") {
    return ctx.guardianRelationships.map(fromGuardian)
  }
  if (activeContext.kind === "parent") {
    return ctx.guardianRelationships
      .filter((g) => g.playerId === activeContext.playerId && g.teamId === activeContext.id)
      .map(fromGuardian)
  }
  if (activeContext.kind === "player") {
    return ctx.linkedPlayerTeams
      .filter((p) => p.teamId === activeContext.id)
      .map((p) => ({
        playerId: p.playerId,
        firstName: ctx.firstName ?? "You",
        surname: "",
        fullName: ctx.firstName ?? "You",
        teamId: p.teamId,
        teamName: p.teamDisplayName,
        clubId: p.clubId,
        clubName: p.clubName,
        avatarStoragePath: p.avatarStoragePath,
      }))
  }
  return []
}

function fixtureTitle(row: { home_away: string | null; raw_opposition_text: string | null; opponentName: string | null; ownTeamName: string }): string {
  const opponent = row.opponentName ?? row.raw_opposition_text ?? "Opposition to be confirmed"
  return row.home_away === "Away" ? `${opponent} v ${row.ownTeamName}` : `${row.ownTeamName} v ${opponent}`
}

/**
 * Every fixture and training session in the window for these children.
 *
 * Fixtures are matched on BOTH owning_team_id and opponent_team_id: a club's
 * own confirmed fixtures include every one where it responded rather than
 * created, and matching only the owning side silently drops half of them --
 * the same reasoning the Calendar's own query records.
 */
export async function loadFamilyAgenda(
  supabase: SupabaseClient<Database>,
  children: FamilyChild[],
  window: { startIso: string; endIso: string }
): Promise<AgendaEvent[]> {
  if (children.length === 0) return []

  const teamIds = Array.from(new Set(children.map((c) => c.teamId)))
  const playerIds = Array.from(new Set(children.map((c) => c.playerId)))

  const [{ data: fixtures }, { data: training }] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        "id, owning_team_id, opponent_team_id, season_id, mirror_fixture_id, kickoff_date, kickoff_time, meet_time, home_away, status, raw_opposition_text, venue_address, venue_id, teams!fixtures_owning_team_id_fkey(display_name), opponent:teams!fixtures_opponent_team_id_fkey(display_name)"
      )
      .or(`owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})`)
      .gte("kickoff_date", window.startIso)
      .lte("kickoff_date", window.endIso)
      .is("archived_at", null)
      // A cancelled fixture must stop reading as an upcoming commitment in a
      // Parent/Player view -- the same rule the Calendar already applies.
      .neq("status", "Cancelled")
      .order("kickoff_date", { ascending: true }),
    supabase
      .from("training_sessions")
      .select("id, team_id, session_date, start_time, notes, venue_id, teams(display_name), club_pitches(display_name)")
      .in("team_id", teamIds)
      .is("cancelled_at", null)
      .gte("session_date", window.startIso)
      .lte("session_date", window.endIso)
      .order("session_date", { ascending: true }),
  ])

  const venueIds = Array.from(
    new Set([
      ...(fixtures ?? []).map((f) => f.venue_id),
      ...(training ?? []).map((t) => t.venue_id),
    ].filter((v): v is string => Boolean(v)))
  )
  const { data: venues } = venueIds.length > 0 ? await supabase.from("venues").select("id, name").in("id", venueIds) : { data: [] }
  const venueNameById = new Map((venues ?? []).map((v) => [v.id, v.name]))

  // Attendance is read per player, so RLS returns only rows this session may
  // see. A missing row is a genuine "not answered yet", which is exactly what
  // the outstanding-response card counts.
  const fixtureIds = (fixtures ?? []).map((f) => f.id)

  // One batch lookup of every (team, season) pair these fixtures touch, so
  // each side is labelled for the fixture's own season rather than for what
  // the team is called today.
  const agendaTeamIdentities = await loadTeamIdentitiesForSeason(
    supabase,
    (fixtures ?? []).flatMap((f) =>
      f.season_id
        ? [
            { teamId: f.owning_team_id, seasonId: f.season_id as string },
            ...(f.opponent_team_id ? [{ teamId: f.opponent_team_id, seasonId: f.season_id as string }] : []),
          ]
        : []
    )
  )
  const trainingIds = (training ?? []).map((t) => t.id)
  const { data: attendance } =
    fixtureIds.length + trainingIds.length > 0
      ? await supabase
          .from("player_fixture_attendance")
          .select("fixture_id, training_session_id, player_id, status")
          .in("player_id", playerIds)
      : { data: [] }

  const responseFor = (playerId: string, kind: "fixture" | "training", id: string): AttendanceResponse => {
    const row = (attendance ?? []).find(
      (a) => a.player_id === playerId && (kind === "fixture" ? a.fixture_id === id : a.training_session_id === id)
    )
    return (row?.status as AttendanceResponse) ?? null
  }

  // Mini-Rugby mirror pairs represent ONE physical fixture as two rows. Keep
  // the primary of each pair so a child is never asked to respond twice, and
  // never counted twice by the 14-day card.
  // Same scope shape as the Agenda: a guardian's own children's teams, so one
  // half of a pair may arrive without the other. See lib/fixtures/mirror-pair.ts.
  const primaryFixtures = dedupeMirrorPairs(fixtures ?? [])

  const events: AgendaEvent[] = []

  for (const child of children) {
    for (const f of primaryFixtures) {
      // Only fixtures this child's OWN team is actually in.
      const isOwning = f.owning_team_id === child.teamId
      const isOpponent = f.opponent_team_id === child.teamId
      if (!isOwning && !isOpponent) continue

      // Read the fixture from this child's side, so "home or away" and the
      // title are about their team, not whoever happened to create it.
      // A child's team is named as it stood in the fixture's own season. A
      // parent looking back at last season must see the age grade their child
      // actually played, not the one that cohort has since become.
      const seasonLabel = (teamId: string | null): string | null =>
        (teamId && f.season_id && agendaTeamIdentities.get(teamIdentityKey(teamId, f.season_id))?.displayName) || null
      const ownTeamName = isOwning
        ? (seasonLabel(f.owning_team_id) ?? f.teams?.display_name ?? child.teamName)
        : (seasonLabel(f.opponent_team_id) ?? f.opponent?.display_name ?? child.teamName)
      const opponentName = isOwning
        ? (seasonLabel(f.opponent_team_id) ?? f.opponent?.display_name ?? null)
        : (seasonLabel(f.owning_team_id) ?? f.teams?.display_name ?? null)
      const homeAway = isOwning ? f.home_away : f.home_away === "Home" ? "Away" : f.home_away === "Away" ? "Home" : f.home_away

      events.push({
        key: `fixture:${f.id}:${child.playerId}`,
        kind: "fixture",
        eventId: f.id,
        playerId: child.playerId,
        childName: child.fullName,
        childFirstName: child.firstName,
        teamId: child.teamId,
        teamName: child.teamName,
        clubName: child.clubName,
        date: f.kickoff_date,
        time: f.kickoff_time ? String(f.kickoff_time).slice(0, 5) : null,
        meetTime: f.meet_time ? String(f.meet_time).slice(0, 5) : null,
        title: fixtureTitle({ home_away: homeAway, raw_opposition_text: f.raw_opposition_text, opponentName, ownTeamName }),
        venue: (f.venue_id ? venueNameById.get(f.venue_id) : null) ?? f.venue_address ?? null,
        status: f.status,
        attendance: responseFor(child.playerId, "fixture", f.id),
        href: `/fixtures/${f.id}`,
      })
    }

    for (const t of training ?? []) {
      if (t.team_id !== child.teamId) continue
      events.push({
        key: `training:${t.id}:${child.playerId}`,
        kind: "training",
        eventId: t.id,
        playerId: child.playerId,
        childName: child.fullName,
        childFirstName: child.firstName,
        teamId: child.teamId,
        teamName: child.teamName,
        clubName: child.clubName,
        date: t.session_date,
        time: t.start_time ? String(t.start_time).slice(0, 5) : null,
        title: "Training",
        venue: (t.venue_id ? venueNameById.get(t.venue_id) : null) ?? t.club_pitches?.display_name ?? null,
        status: null,
        attendance: responseFor(child.playerId, "training", t.id),
        // Training has no Match Centre; the agenda row is the destination.
        href: null,
      })
    }
  }

  return dedupeAgendaEvents(events)
}
