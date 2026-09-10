import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { KitConfig } from "@/components/club/rugby-kit"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { dedupeMirrorPairs } from "@/lib/fixtures/mirror-pair"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import type { Database } from "@/types/database.types"

import type { AgendaScope } from "./scope"
import type { DateWindow } from "./window"

/**
 * READING THE AGENDA.
 *
 * One loader, four scopes, and a query shaped by the scope the server already
 * resolved -- never by anything in the request. A filter narrows what comes
 * back from here; nothing in a URL can reach the `.in()` clauses below.
 *
 * BOUNDED BY CONSTRUCTION. Every read is bounded twice: by the resolved date
 * window (always finite -- see window.ts), and by a hard row cap. A Site Admin
 * asking for a year is a big question and it is answered with a big-but-finite
 * query, never by pulling the platform's history into the browser and
 * filtering it in React. Where the cap bites, the page says so rather than
 * quietly truncating.
 *
 * IDENTITY IS INHERITED, NOT REINVENTED. The Match Centre is the richest
 * expression of a fixture; this carries the same facts at agenda density --
 * crest, kit, opposition, home/away, venue, status -- resolved through the
 * same canonical helpers (resolveClubLogoUrl, loadTeamIdentitiesForSeason,
 * club_kits). There is no second opposition catalogue and no parsing of
 * display strings: opposition identity comes from the fixture's own
 * opponent_team_id or opponent_directory_id.
 */

/** The most rows any single agenda read will return, whatever the scope. */
export const AGENDA_ROW_CAP = 400

export interface AgendaSide {
  /** Canonical club directory id -- the identity the opposition filter groups on. Null for an unset opposition. */
  directoryId: string | null
  clubName: string
  teamName: string | null
  crestUrl: string | null
  kit: KitConfig | null
}

export interface AgendaItem {
  key: string
  kind: "fixture" | "training"
  /** The canonical fixture_id or training_session_id. Never synthesised. */
  eventId: string
  date: string
  time: string | null
  meetTime: string | null
  /** Our side, read from the viewer's own team's point of view. */
  us: AgendaSide
  /** The opposition. Null for training, which has none and must never be given a fake one. */
  them: AgendaSide | null
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  venue: string | null
  pitch: string | null
  status: string | null
  /** Canonical result, where one exists. Never inferred, never fabricated. */
  result: { ourScore: number; theirScore: number } | null
  /** Which player this row belongs to in a family scope; null for staff/club/platform scopes. */
  playerId: string | null
  childFirstName: string | null
  childAvatarUrl: string | null
  attendance: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
  teamId: string
  clubId: string | null
  /** The Match Centre for a fixture. Training has no Match Centre and must never be forced through one. */
  href: string | null
}

export interface AgendaReadResult {
  items: AgendaItem[]
  /** True when the row cap was reached -- the page says so rather than pretending this is everything. */
  truncated: boolean
}

type Client = SupabaseClient<Database>

const FIXTURE_FIELDS =
  "id, owning_team_id, opponent_team_id, opponent_directory_id, season_id, mirror_fixture_id, kickoff_date, kickoff_time, meet_time, home_away, status, raw_opposition_text, venue_address, venue_id, pitch_id, home_score, away_score"

/**
 * Which teams' rugby this scope covers.
 *
 * Resolved from the SCOPE, so the ids that reach a query are always ones the
 * session proved. Platform scope returns null, meaning "no team filter" --
 * the only scope that gets one, and only for a Full Site Admin.
 */
async function teamIdsForScope(supabase: Client, scope: AgendaScope): Promise<string[] | null> {
  if (scope.kind === "family") return Array.from(new Set(scope.children.map((c) => c.teamId)))
  if (scope.kind === "teams") return scope.teamIds
  if (scope.kind === "club") {
    const { data } = await supabase.from("teams").select("id").eq("club_id", scope.clubId)
    return (data ?? []).map((t) => t.id)
  }
  if (scope.kind === "platform") return null
  return []
}

export async function loadAgenda(
  supabase: Client,
  scope: AgendaScope,
  window: DateWindow,
  options: { includeTraining: boolean }
): Promise<AgendaReadResult> {
  if (scope.kind === "none") return { items: [], truncated: false }

  const teamIds = await teamIdsForScope(supabase, scope)
  if (teamIds !== null && teamIds.length === 0) return { items: [], truncated: false }

  // ---- FIXTURES -----------------------------------------------------------
  let fixtureQuery = supabase
    .from("fixtures")
    .select(FIXTURE_FIELDS)
    .gte("kickoff_date", window.startIso)
    .lte("kickoff_date", window.endIso)
    .is("archived_at", null)
    .order("kickoff_date", { ascending: window.order === "asc" })
    .limit(AGENDA_ROW_CAP)

  if (teamIds !== null) {
    // BOTH sides. A club's own fixtures include every one it responded to
    // rather than created, and matching only the owning side silently drops
    // half of them -- the same reasoning the Calendar's query records.
    fixtureQuery = fixtureQuery.or(`owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})`)
  }

  // ---- SCHEDULING GROUPS --------------------------------------------------
  // A training session belongs to EITHER a team or a scheduling group -- the
  // table's own check constraint says exactly one of the two. A group is how
  // Mini-Rugby runs one session for several component teams, and its
  // participants are the members of those teams: scheduling_group_members is
  // the canonical join, and it is the same one get_training_register,
  // get_my_players_for_training_session and respond_to_training_attendance all
  // read. Nothing is invented here; the group is simply resolved to the teams
  // it already contains.
  const { data: groupMemberRows } = options.includeTraining
    ? teamIds !== null
      ? await supabase.from("scheduling_group_members").select("group_id, team_id").in("team_id", teamIds)
      : await supabase.from("scheduling_group_members").select("group_id, team_id")
    : { data: [] as { group_id: string; team_id: string }[] }
  /** Which of THIS VIEWER'S teams sit inside each group they can see. */
  const scopeTeamsByGroup = new Map<string, string[]>()
  for (const m of groupMemberRows ?? []) {
    const list = scopeTeamsByGroup.get(m.group_id)
    if (list) list.push(m.team_id)
    else scopeTeamsByGroup.set(m.group_id, [m.team_id])
  }
  const scopeGroupIds = Array.from(scopeTeamsByGroup.keys())

  // ---- TRAINING -----------------------------------------------------------
  // Training keeps its own canonical identity. It is never turned into a
  // fixture and never given an opposition.
  const trainingQuery = options.includeTraining
    ? (() => {
        let q = supabase
          .from("training_sessions")
          .select("id, team_id, scheduling_group_id, club_id, session_date, start_time, venue_id, pitch_id, teams(display_name), scheduling_groups(display_tag), club_pitches(display_name)")
          .gte("session_date", window.startIso)
          .lte("session_date", window.endIso)
          .is("cancelled_at", null)
          .order("session_date", { ascending: window.order === "asc" })
          .limit(AGENDA_ROW_CAP)
        if (teamIds !== null) {
          // Team sessions OR the group sessions whose membership includes one
          // of this viewer's teams. Scoped in the QUERY, like every other read
          // on this page -- a group id the viewer has no team in never reaches
          // the browser to be filtered out of.
          const clauses = [`team_id.in.(${teamIds.join(",")})`]
          if (scopeGroupIds.length > 0) clauses.push(`scheduling_group_id.in.(${scopeGroupIds.join(",")})`)
          q = q.or(clauses.join(","))
        }
        return q
      })()
    : Promise.resolve({ data: [] as never[] })

  const [{ data: fixtures }, { data: training }] = await Promise.all([fixtureQuery, trainingQuery])

  const fixtureRows = fixtures ?? []
  const trainingRows = training ?? []

  // ONE REAL MATCH, TWO ROWS -- see lib/fixtures/mirror-pair.ts for what a
  // mirror pair is and why this scope needs the set-aware rule rather than the
  // database's bare is_primary_mirror. The Agenda scopes by the viewer's own
  // teams, so it routinely holds one half of a pair without the other; the
  // strict lower-id rule would delete the viewer's own fixture whenever their
  // side happened to carry the higher id.
  const primaryFixtures = dedupeMirrorPairs(fixtureRows)

  // ---- IDENTITY: teams, clubs, crests, kits -------------------------------
  const involvedTeamIds = Array.from(
    new Set(
      [
        ...primaryFixtures.flatMap((f) => [f.owning_team_id, f.opponent_team_id]),
        ...trainingRows.map((t) => t.team_id),
      ].filter((x): x is string => Boolean(x))
    )
  )

  const { data: teamRows } = involvedTeamIds.length
    ? await supabase
        .from("teams")
        .select("id, display_name, club_id, clubs(id, directory_id, logo_storage_path, club_directory(id, name, logo_storage_path))")
        .in("id", involvedTeamIds)
    : { data: [] }
  const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]))

  const clubIds = Array.from(new Set((teamRows ?? []).map((t) => t.club_id).filter((x): x is string => Boolean(x))))
  const { data: kitRows } = clubIds.length
    ? await supabase
        .from("club_kits")
        .select("club_id, pattern, primary_colour, secondary_colour, accent_colour")
        .in("club_id", clubIds)
        .eq("variant", "primary")
    : { data: [] }
  const kitByClub = new Map(
    (kitRows ?? []).map((k) => [
      k.club_id,
      { pattern: k.pattern as KitConfig["pattern"], primaryColour: k.primary_colour, secondaryColour: k.secondary_colour, accentColour: k.accent_colour } as KitConfig,
    ])
  )

  // Unclaimed opposition: a directory row, never a fabricated club.
  const directoryIds = Array.from(new Set(primaryFixtures.map((f) => f.opponent_directory_id).filter((x): x is string => Boolean(x))))
  const { data: directoryRows } = directoryIds.length
    ? await supabase.from("club_directory").select("id, name, logo_storage_path").in("id", directoryIds)
    : { data: [] }
  const directoryById = new Map((directoryRows ?? []).map((d) => [d.id, d]))

  // Each side named as it stood in the FIXTURE'S OWN SEASON, so looking back
  // shows the age grade a child actually played, not what that cohort has
  // since become.
  const identities = await loadTeamIdentitiesForSeason(
    supabase,
    primaryFixtures.flatMap((f) =>
      f.season_id
        ? [
            { teamId: f.owning_team_id, seasonId: f.season_id as string },
            ...(f.opponent_team_id ? [{ teamId: f.opponent_team_id, seasonId: f.season_id as string }] : []),
          ]
        : []
    )
  )

  const venueIds = Array.from(
    new Set([...primaryFixtures.map((f) => f.venue_id), ...trainingRows.map((t) => t.venue_id)].filter((x): x is string => Boolean(x)))
  )
  const { data: venueRows } = venueIds.length ? await supabase.from("venues").select("id, name").in("id", venueIds) : { data: [] }
  const venueById = new Map((venueRows ?? []).map((v) => [v.id, v.name]))

  const pitchIds = Array.from(new Set(primaryFixtures.map((f) => f.pitch_id).filter((x): x is string => Boolean(x))))
  const { data: pitchRows } = pitchIds.length ? await supabase.from("club_pitches").select("id, display_name").in("id", pitchIds) : { data: [] }
  const pitchById = new Map((pitchRows ?? []).map((p) => [p.id, p.display_name]))

  function sideFor(teamId: string | null, seasonId: string | null): AgendaSide | null {
    if (!teamId) return null
    const team = teamById.get(teamId)
    const club = team?.clubs
    const directory = club?.club_directory
    const seasonName = seasonId ? identities.get(teamIdentityKey(teamId, seasonId))?.displayName : null
    return {
      directoryId: club?.directory_id ?? directory?.id ?? null,
      clubName: directory?.name ?? "Club",
      teamName: seasonName ?? team?.display_name ?? null,
      crestUrl: club
        ? resolveClubLogoUrl(supabase, {
            logo_storage_path: club.logo_storage_path,
            club_directory: directory ? { logo_storage_path: directory.logo_storage_path } : null,
          })
        : null,
      kit: team?.club_id ? (kitByClub.get(team.club_id) ?? null) : null,
    }
  }

  // ---- ATTENDANCE (family scope only) -------------------------------------
  // Only a person answering for somebody needs this, and only their own
  // linked players' rows are ever read.
  const playerIds = scope.kind === "family" ? Array.from(new Set(scope.children.map((c) => c.playerId))) : []
  const { data: attendanceRows } =
    playerIds.length > 0
      ? await supabase.from("player_fixture_attendance").select("fixture_id, training_session_id, player_id, status").in("player_id", playerIds)
      : { data: [] }
  const responseFor = (playerId: string, kind: "fixture" | "training", id: string) =>
    ((attendanceRows ?? []).find(
      (a) => a.player_id === playerId && (kind === "fixture" ? a.fixture_id === id : a.training_session_id === id)
    )?.status as AgendaItem["attendance"]) ?? null

  const items: AgendaItem[] = []

  /**
   * One fixture, read from OUR side.
   *
   * Home/away comes from canonical fixture semantics and is flipped when the
   * viewer's team is the opponent -- never inferred from venue text, which is
   * the mistake that makes an away fixture read as home the moment a club
   * hosts at a neutral ground.
   */
  function pushFixture(f: (typeof primaryFixtures)[number], ourTeamId: string, family: { playerId: string; firstName: string; avatarUrl: string | null } | null) {
    const isOwning = f.owning_team_id === ourTeamId
    const theirTeamId = isOwning ? f.opponent_team_id : f.owning_team_id
    const us = sideFor(ourTeamId, f.season_id)
    if (!us) return

    let them = sideFor(theirTeamId, f.season_id)
    if (!them) {
      const dir = f.opponent_directory_id ? directoryById.get(f.opponent_directory_id) : null
      them = dir
        ? {
            directoryId: dir.id,
            clubName: dir.name,
            teamName: null,
            crestUrl: resolveClubLogoUrl(supabase, { logo_storage_path: null, club_directory: { logo_storage_path: dir.logo_storage_path } }),
            kit: null,
          }
        : {
            directoryId: null,
            clubName: f.raw_opposition_text ?? "Opposition to be confirmed",
            teamName: null,
            crestUrl: null,
            kit: null,
          }
    }

    const homeAway = (isOwning
      ? f.home_away
      : f.home_away === "Home"
        ? "Away"
        : f.home_away === "Away"
          ? "Home"
          : f.home_away) as AgendaItem["homeAway"]

    // A result is shown only where BOTH canonical scores exist. A half-filled
    // scoreline is not a result, and inventing the missing half would be
    // fabricating one.
    const hasResult = typeof f.home_score === "number" && typeof f.away_score === "number"
    const ourIsHome = homeAway === "Home"
    const result = hasResult
      ? { ourScore: ourIsHome ? f.home_score! : f.away_score!, theirScore: ourIsHome ? f.away_score! : f.home_score! }
      : null

    items.push({
      key: `fixture:${f.id}:${family?.playerId ?? ourTeamId}`,
      kind: "fixture",
      eventId: f.id,
      date: f.kickoff_date,
      time: f.kickoff_time ? String(f.kickoff_time).slice(0, 5) : null,
      meetTime: f.meet_time ? String(f.meet_time).slice(0, 5) : null,
      us,
      them,
      homeAway,
      venue: (f.venue_id ? venueById.get(f.venue_id) : null) ?? f.venue_address ?? null,
      pitch: f.pitch_id ? (pitchById.get(f.pitch_id) ?? null) : null,
      status: f.status,
      result,
      playerId: family?.playerId ?? null,
      childFirstName: family?.firstName ?? null,
      childAvatarUrl: family?.avatarUrl ?? null,
      attendance: family ? responseFor(family.playerId, "fixture", f.id) : null,
      teamId: ourTeamId,
      clubId: teamById.get(ourTeamId)?.club_id ?? null,
      href: `/fixtures/${f.id}`,
    })
  }

  function pushTraining(
    t: (typeof trainingRows)[number],
    family: { playerId: string; firstName: string; avatarUrl: string | null } | null,
    viewerTeamId: string | null
  ) {
    // A training session belongs to EITHER a team or a scheduling group.
    //
    // The group case was previously skipped -- honestly, and recorded as a gap,
    // because listing it once per component team without knowing who was
    // actually invited would have been worse than omitting it. Training Centre
    // is where that gap was owed, and this is it: the group resolves through
    // scheduling_group_members to the teams it contains, which is the same
    // participation model the canonical training RPCs already use.
    //
    // `viewerTeamId` is the caller's own team inside the group -- the child's
    // team for a guardian, a scoped team for staff. It is used to draw the
    // crest and to key the row. It is NOT the session's identity: the session
    // is t.id, once, however many teams train in it.
    const teamId = t.team_id ?? viewerTeamId
    if (!teamId) return
    const us = sideFor(teamId, null)
    // A group session is named by the group, because "Mini-Rugby Saturday" is
    // what it is. Only the crest and scope come from the viewer's own team.
    const groupTag = t.scheduling_groups?.display_tag ?? null
    items.push({
      key: `training:${t.id}:${family?.playerId ?? teamId}`,
      kind: "training",
      eventId: t.id,
      date: t.session_date,
      time: t.start_time ? String(t.start_time).slice(0, 5) : null,
      meetTime: null,
      us: us
        ? { ...us, teamName: groupTag ?? us.teamName }
        : { directoryId: null, clubName: "Club", teamName: groupTag ?? t.teams?.display_name ?? null, crestUrl: null, kit: null },
      // Training has no opposition, and is never given a fake one.
      them: null,
      homeAway: null,
      venue: (t.venue_id ? venueById.get(t.venue_id) : null) ?? t.club_pitches?.display_name ?? null,
      pitch: t.club_pitches?.display_name ?? null,
      status: null,
      result: null,
      playerId: family?.playerId ?? null,
      childFirstName: family?.firstName ?? null,
      childAvatarUrl: family?.avatarUrl ?? null,
      attendance: family ? responseFor(family.playerId, "training", t.id) : null,
      teamId,
      clubId: t.club_id ?? null,
      // THE CANONICAL TRAINING CENTRE, addressed by the session's own id.
      // Never by team, date, venue or the recurrence that generated it -- this
      // is the same id the Scheduler materialised and the same one the page
      // reads, so the three cannot describe different sessions.
      href: `/training/${t.id}`,
    })
  }

  if (scope.kind === "family") {
    for (const child of scope.children) {
      for (const f of primaryFixtures) {
        if (f.owning_team_id !== child.teamId && f.opponent_team_id !== child.teamId) continue
        pushFixture(f, child.teamId, { playerId: child.playerId, firstName: child.firstName, avatarUrl: null })
      }
      for (const t of trainingRows) {
        // Their own team's session, or a group session their team is in.
        const inGroup =
          t.scheduling_group_id !== null && (scopeTeamsByGroup.get(t.scheduling_group_id)?.includes(child.teamId) ?? false)
        if (t.team_id !== child.teamId && !inGroup) continue
        pushTraining(t, { playerId: child.playerId, firstName: child.firstName, avatarUrl: null }, child.teamId)
      }
    }
  } else {
    const scopeTeams = new Set(teamIds ?? [])
    for (const f of primaryFixtures) {
      // Whichever side is in scope is "us". For platform scope there is no
      // team filter, so the owning side is used -- the fixture's own author.
      const ourTeamId =
        teamIds === null
          ? f.owning_team_id
          : scopeTeams.has(f.owning_team_id)
            ? f.owning_team_id
            : f.opponent_team_id && scopeTeams.has(f.opponent_team_id)
              ? f.opponent_team_id
              : null
      if (!ourTeamId) continue
      pushFixture(f, ourTeamId, null)
    }
    for (const t of trainingRows) {
      // ONE ROW PER SESSION, not one per component team. A group session is a
      // single occurrence with a single id; listing a club admin's Mini-Rugby
      // Saturday four times because four teams are in it would be describing
      // one session as four.
      const viewerTeamId =
        t.team_id ??
        (t.scheduling_group_id ? (scopeTeamsByGroup.get(t.scheduling_group_id)?.[0] ?? null) : null)
      pushTraining(t, null, viewerTeamId)
    }
  }

  // One stable chronological order, secondary-sorted on time then team so two
  // fixtures at the same minute do not swap places between renders.
  items.sort((a, b) => {
    if (a.date !== b.date) return window.order === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    const at = a.time ?? "99:99"
    const bt = b.time ?? "99:99"
    if (at !== bt) return at.localeCompare(bt)
    return a.key.localeCompare(b.key)
  })

  return {
    items,
    // Measured on what the DATABASE returned, not on what survived -- if the
    // query came back full there may be more beyond it, whatever dedupe and
    // scoping then removed. Recorded here rather than derived from items.length,
    // which counts one row per child in a family scope and would report a
    // truncation that never happened.
    truncated: fixtureRows.length >= AGENDA_ROW_CAP || trainingRows.length >= AGENDA_ROW_CAP,
  }
}
