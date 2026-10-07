import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadScheduleGrounds } from "../agenda/grounds"
import { clubLogoUrlFromPath } from "../club-logo"
import type { ResultsVisibility } from "../tournaments/results"
import { fullTeamLabel } from "../teams/compact-label"
import { compareAgeGroups, type TournamentFormat, type TournamentVisibility } from "./tournaments"

type Client = SupabaseClient<Database>

/**
 * ONE TOURNAMENT, AS ITS ORGANISER SEES IT.
 *
 * The four tabs -- Overview, Teams, Requests, Planning -- are four views of ONE read, not four
 * screens with four loaders. A tournament's field of teams is the same fact whether you are counting
 * it on Overview or editing it on Teams, and loading it twice is how the two come to disagree.
 *
 * THREE KINDS OF SIDE, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   entries       the host's own teams            `tournament_team_entries`
 *   participants  every other club's sides        `tournament_participants`, status 'added'
 *   applications  a club ASKING to come           `tournament_applications`, its own history
 *
 * An organiser adding a club produces a participant, not a request. A club applying to a public
 * tournament produces an application, which becomes a participant only when the organiser accepts.
 * Nothing here turns one into the other, and `added` is never relabelled `accepted`.
 */

export interface TournamentSide {
  /** The participant or entry row, which is what removal acts on. */
  id: string
  teamId: string | null
  /** The canonical derived team name, or an external club's typed side name. */
  label: string
  ageGroup: string
  /** 'ours' for the host's own team, 'added' for a club in Ovalball's canonical directory (claimed or
   * not), 'external' for one that exists only because somebody typed its name. 'added' for one that is
   * not on Ovalball. Never a status the person has to interpret. */
  kind: "ours" | "added" | "external"
}

export interface TournamentClubGroup {
  directoryId: string
  clubName: string
  /** Set only where the club genuinely has an Ovalball account. */
  clubId: string | null
  crestUrl: string | null
  sides: TournamentSide[]
}

export interface TournamentApplicationTeam {
  teamId: string
  name: string
}

export interface TournamentApplication {
  id: string
  clubId: string
  clubName: string
  crestUrl: string | null
  ageGroup: string
  status: "pending" | "accepted" | "rejected" | "withdrawn"
  appliedAt: string
  note: string | null
  teams: TournamentApplicationTeam[]
}

export interface TournamentDetail {
  id: string
  name: string
  hostClubId: string | null
  hostClubName: string
  hostCrestUrl: string | null
  startsOn: string
  endsOn: string | null
  kickoffTime: string | null
  format: TournamentFormat
  swissRounds: number | null
  /** Whether any competition keeps a table -- the server's rule (tournament_keeps_standings), so a
   * Tri-Fixture the organiser never made a competition has no empty Tables tab. */
  keepsStandings: boolean
  /** The tournament's own photograph -- the same two columns the list reads, so the hero and the
   * thumbnail cannot disagree about which picture this tournament has. */
  coverImagePath: string | null
  coverStockKey: string | null
  visibility: TournamentVisibility
  /**
   * HOW RESULTS ARE RUN, and deliberately not the tournament's own visibility. A club may list a
   * festival publicly and still keep its scores inside it -- age-grade rugby has good reasons for
   * that -- so these are two settings rather than one.
   */
  resultsSubmissionEnabled: boolean
  resultsVisibility: ResultsVisibility
  status: string
  notes: string | null
  venueId: string | null
  venueName: string | null
  venueAddress: string | null
  venueCoverImagePath: string | null
  venueCoverStockKey: string | null
  ageGroups: string[]
  /** The host's own sides, and every other club's, per grade. */
  ours: TournamentSide[]
  clubs: TournamentClubGroup[]
  applications: TournamentApplication[]
}

/**
 * THE WHOLE TOURNAMENT IN ONE READ.
 *
 * Embedded selects, so the tabs cannot drift apart. RLS decides what comes back: a club that is not
 * the host sees a public tournament but not its applications, which is exactly right -- the field is
 * public information and who asked to join is the organiser's business.
 */
export async function readTournamentDetail(supabase: Client, tournamentId: string): Promise<TournamentDetail | null> {
  const { data, error } = await supabase
    .from("tournaments")
    .select(
      `id, name, event_date, ends_on, kickoff_time, format, swiss_rounds, visibility, results_submission_enabled, results_visibility, status, notes, venue_id, host_club_id, cover_image_path, cover_stock_key,
       venues(name, address_line_1, town, postcode, cover_image_path, cover_stock_key),
       clubs!tournaments_host_club_id_fkey(id, logo_storage_path, club_directory(name, logo_storage_path)),
       tournament_age_groups(age_group),
       tournament_team_entries(id, team_id, teams(display_name, category, age_group, gender, squad_designation, rugby_code)),
       tournament_participants(id, team_id, age_group, squad_label, status, club_id, club_directory_id,
         club_directory(name, logo_storage_path, clubs(id, logo_storage_path)),
         teams(display_name, category, age_group, gender, squad_designation, rugby_code)),
       tournament_applications(id, club_id, age_group, status, applied_at, note,
         clubs(id, logo_storage_path, club_directory(name, logo_storage_path)),
         tournament_application_teams(team_id, teams(display_name, category, age_group, gender, squad_designation, rugby_code)))`,
    )
    .eq("id", tournamentId)
    .maybeSingle()

  if (error) throw error
  const { data: keeps } = await supabase.rpc("tournament_keeps_standings", { p_tournament_id: tournamentId })
  if (!data) return null

  const row = data as unknown as RawTournament
  const venue = first(row.venues)
  // WHERE IT IS, FOR EVERY CLUB IN IT. A visiting club cannot read the host's venue row, so the embed comes
  // back empty for them and the hero said nothing about where the day is played; the schedule's one ground
  // rule names it for anybody who can see the tournament.
  const listedGround = !venue && row.venue_id ? (await loadScheduleGrounds(supabase, { tournamentIds: [tournamentId] })).get(tournamentId) ?? null : null
  const hostClub = first(row.clubs)
  const hostDir = first(hostClub?.club_directory)

  const ours: TournamentSide[] = (row.tournament_team_entries ?? []).map((e) => {
    const t = first(e.teams)
    return {
      id: e.id,
      teamId: e.team_id,
      label: t ? teamName(t) : "Team",
      ageGroup: t?.age_group ?? "",
      kind: "ours" as const,
    }
  })

  // Other clubs' sides, grouped under the club they belong to and held in the order they were added.
  //
  // THE HOST'S OWN SIDES ARE ALREADY "OURS". tournament_team_entries is a VIEW over these same
  // participant rows (the host club's, with a team), so reading both drew every host side twice -- once
  // as "Our Team", once as "Added" -- and counted a four-team competition as five.
  const oursIds = new Set(ours.map((o) => o.id))
  const byClub = new Map<string, TournamentClubGroup>()
  for (const p of (row.tournament_participants ?? []).filter((x) => !oursIds.has(x.id))) {
    const dir = first(p.club_directory)
    const dirClub = first(dir?.clubs)
    const t = first(p.teams)
    const group = byClub.get(p.club_directory_id) ?? {
      directoryId: p.club_directory_id,
      clubName: dir?.name ?? "Club",
      clubId: dirClub?.id ?? p.club_id ?? null,
      crestUrl: clubLogoUrlFromPath(supabase, dirClub?.logo_storage_path ?? dir?.logo_storage_path ?? null),
      sides: [],
    }
    group.sides.push({
      id: p.id,
      teamId: p.team_id,
      // A REAL TEAM IS ITS CANONICAL NAME. A side without one is its COMPETITION plus its alias --
      // "U12 Spears" -- because the alias alone ("Spears") does not say which competition the side is
      // in, and the grade alone does not tell two of a club's sides apart. A side with no alias is
      // simply its competition, "U12", which is exactly what it is.
      label: t ? teamName(t) : p.squad_label ? `${p.age_group} ${p.squad_label}` : p.age_group,
      ageGroup: p.age_group,
      // EXTERNAL MEANS "OVALBALL HAS NEVER HEARD OF THIS CLUB", and the server is the one that knows:
      // `external_recorded` is set only when the club exists purely because somebody typed its name.
      //
      // IT USED TO BE DERIVED FROM WHETHER THE CLUB HAD AN ACCOUNT, which labelled every unclaimed
      // club "External" -- so Wigan, a real club in Ovalball's own directory with a crest and a town,
      // was shown as though Ovalball did not know it. Whether a club has signed up is a different
      // question from whether we know who it is, and only the second one belongs on this badge.
      kind: p.status === "external_recorded" ? "external" : "added",
    })
    byClub.set(p.club_directory_id, group)
  }

  const applications: TournamentApplication[] = (row.tournament_applications ?? []).map((a) => {
    const club = first(a.clubs)
    const dir = first(club?.club_directory)
    return {
      id: a.id,
      clubId: a.club_id,
      clubName: dir?.name ?? "Club",
      crestUrl: clubLogoUrlFromPath(supabase, club?.logo_storage_path ?? dir?.logo_storage_path ?? null),
      ageGroup: a.age_group,
      status: a.status,
      appliedAt: a.applied_at,
      note: a.note,
      teams: (a.tournament_application_teams ?? []).map((t) => ({
        teamId: t.team_id,
        name: first(t.teams) ? teamName(first(t.teams)!) : "Team",
      })),
    }
  })

  return {
    id: row.id,
    name: row.name,
    hostClubId: row.host_club_id,
    keepsStandings: keeps === true,
    hostClubName: hostDir?.name ?? "",
    hostCrestUrl: clubLogoUrlFromPath(supabase, hostClub?.logo_storage_path ?? hostDir?.logo_storage_path ?? null),
    startsOn: row.event_date,
    endsOn: row.ends_on,
    // Postgres hands back a `time` as "09:00:00"; a kick-off is said as "09:00". Trimmed once here so
    // every screen that shows it does not have to remember.
    kickoffTime: row.kickoff_time ? row.kickoff_time.slice(0, 5) : null,
    format: (row.format ?? "round_robin") as TournamentFormat,
    swissRounds: row.swiss_rounds ?? null,
    coverImagePath: row.cover_image_path ?? null,
    coverStockKey: row.cover_stock_key ?? null,
    visibility: (row.visibility ?? "private") as TournamentVisibility,
    resultsSubmissionEnabled: row.results_submission_enabled ?? true,
    resultsVisibility: (row.results_visibility ?? "participants") as ResultsVisibility,
    status: row.status,
    notes: row.notes,
    venueId: row.venue_id,
    venueName: venue?.name ?? listedGround?.name ?? null,
    venueAddress: [venue?.address_line_1, venue?.town, venue?.postcode].filter(Boolean).join(", ") || null,
    venueCoverImagePath: venue?.cover_image_path ?? null,
    venueCoverStockKey: venue?.cover_stock_key ?? null,
    ageGroups: (row.tournament_age_groups ?? []).map((g) => g.age_group).sort(compareAgeGroups),
    ours,
    clubs: [...byClub.values()],
    applications,
  }
}

/** Every side in one competition -- ours first, then each visiting club's. The grade is the filter
 * everywhere, because the grade is what a competition IS. */
export function sidesAtGrade(detail: TournamentDetail, ageGroup: string): { ours: TournamentSide[]; clubs: TournamentClubGroup[] } {
  return {
    ours: detail.ours.filter((s) => s.ageGroup === ageGroup),
    clubs: detail.clubs
      .map((c) => ({ ...c, sides: c.sides.filter((s) => s.ageGroup === ageGroup) }))
      .filter((c) => c.sides.length > 0),
  }
}

/** TEAMS, NOT CLUBS: a club bringing three sides is three teams. */
export function teamCountAtGrade(detail: TournamentDetail, ageGroup: string): number {
  const at = sidesAtGrade(detail, ageGroup)
  return at.ours.length + at.clubs.reduce((n, c) => n + c.sides.length, 0)
}

export function totalTeamCount(detail: TournamentDetail): number {
  return detail.ageGroups.reduce((n, g) => n + teamCountAtGrade(detail, g), 0)
}

/** How many applications sit in each state, for the Requests filters. Counted from the same rows the
 * list renders, so a filter can never claim a number the list cannot show. */
export function applicationCounts(detail: TournamentDetail): { all: number; pending: number; accepted: number; rejected: number } {
  const a = detail.applications
  return {
    all: a.length,
    pending: a.filter((x) => x.status === "pending").length,
    accepted: a.filter((x) => x.status === "accepted").length,
    rejected: a.filter((x) => x.status === "rejected").length,
  }
}

// ---------------------------------------------------------------------------------------------------

function teamName(t: RawTeam): string {
  return fullTeamLabel({
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    squadDesignation: t.squad_designation,
    rugbyCode: t.rugby_code,
    alias: null,
  })
}

/** PostgREST returns an embedded one-to-one as an object and a one-to-many as an array, and which one
 * depends on how it read the relationship. Both shapes are handled once, here. */
function first<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined)
}

interface RawTeam {
  display_name: string
  category: string
  age_group: string | null
  gender: string | null
  squad_designation: string | null
  rugby_code: string
}

interface RawTournament {
  id: string
  name: string
  event_date: string
  ends_on: string | null
  kickoff_time: string | null
  format: string | null
  swiss_rounds: number | null
  cover_image_path: string | null
  cover_stock_key: string | null
  visibility: string | null
  results_submission_enabled: boolean | null
  results_visibility: string | null
  status: string
  notes: string | null
  venue_id: string | null
  host_club_id: string | null
  venues: { name: string; address_line_1: string | null; town: string | null; postcode: string | null; cover_image_path: string | null; cover_stock_key: string | null } | null
  clubs: { id: string; logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null
  tournament_age_groups: { age_group: string }[] | null
  tournament_team_entries: { id: string; team_id: string; teams: RawTeam | null }[] | null
  tournament_participants: {
    id: string
    team_id: string | null
    age_group: string
    squad_label: string | null
    status: string
    club_id: string | null
    club_directory_id: string
    club_directory: { name: string; logo_storage_path: string | null; clubs: { id: string; logo_storage_path: string | null } | null } | null
    teams: RawTeam | null
  }[] | null
  tournament_applications: {
    id: string
    club_id: string
    age_group: string
    status: TournamentApplication["status"]
    applied_at: string
    note: string | null
    clubs: { id: string; logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null
    tournament_application_teams: { team_id: string; teams: RawTeam | null }[] | null
  }[] | null
}
