import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { groupKeyFor, DIRECTORY_GROUPS, type DirectoryGroupKey } from "@/lib/teams/directory-taxonomy"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

import { listLiveAnnouncements, type ClubAnnouncement } from "./announcements"
import { getLeadArticle, listPublishedArticles, type ArticleCard } from "./articles"
import type { PublicClub } from "./club"
import {
  competitionResultForClub,
  fixtureResult,
  mergeResults,
  selectUpcoming,
  venueRole,
  type ClubResult,
  type ClubUpcomingMatch,
  type CompetitionParticipantRow,
  type CompetitionRef,
} from "./matches"

/**
 * THE CLUB HOMEPAGE, IN ONE SERVER PASS.
 *
 * One round of parallel reads, one round of dependent reads, no per-team or
 * per-fixture queries. Every list is bounded to what the page shows.
 *
 * Data boundaries, stated once:
 *   fixtures      public_club_fixtures only (confirmed, future, public columns)
 *   results       competition_matches under their own public RLS; club
 *                 fixture results only for a signed-in viewer, and only the
 *                 rows that viewer's fixture policy already returns
 *   news/notices  club_articles / club_announcements under RLS, PUBLISHED only
 *   teams         active teams, canonical display names
 * Never selected: notes, meet times, venue or pitch detail, participants,
 * contacts beyond those the club marked public, who wrote any content.
 */


export interface ClubTeamGroup {
  key: DirectoryGroupKey
  title: string
  teams: { id: string; name: string; nextMatch: ClubUpcomingMatch | null }[]
}

export interface ClubHome {
  lead: ArticleCard | null
  latest: ArticleCard[]
  teamNews: ArticleCard[]
  totalArticles: number
  announcements: ClubAnnouncement[]
  upcoming: ClubUpcomingMatch[]
  results: ClubResult[]
  /** True when some results shown come from the viewer's own access, not the public record. */
  resultsIncludeMemberView: boolean
  teamGroups: ClubTeamGroup[]
  teamCount: number
  contacts: { role: string; name: string; phone: string | null; email: string | null }[]
  viewer: { signedIn: boolean; canManageNews: boolean }
}

export async function loadClubHome(supabase: SupabaseClient<Database>, club: PublicClub, todayIso: string): Promise<ClubHome> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // ------------------------------------------------------------------ round 1
  const [
    lead,
    latestPage,
    teamNewsPage,
    announcements,
    { data: teamRows },
    { data: fixtureRows },
    { data: participantRows },
    { data: contactRows },
    canManageNews,
  ] = await Promise.all([
    getLeadArticle(supabase, club),
    // Latest News is the club's own; team stories live in Team News, so a
    // story is never shown twice on one page.
    listPublishedArticles(supabase, club, { limit: 7, scope: "club" }),
    listPublishedArticles(supabase, club, { limit: 12, scope: "teams" }),
    listLiveAnnouncements(supabase, club.id, 6),
    supabase
      .from("teams")
      .select("id, display_name, category, age_group, gender, squad_designation, rugby_code")
      .eq("club_id", club.id)
      .eq("active", true),
    supabase
      .from("public_club_fixtures")
      .select("id, kickoff_date, kickoff_time, home_away, raw_opposition_text, owning_team_id, season_id, team_display_name")
      .eq("club_id", club.id)
      .gte("kickoff_date", todayIso)
      .order("kickoff_date")
      .order("kickoff_time")
      .limit(24),
    supabase
      .from("competition_participants")
      .select("id, edition_id, club_id, team_id, teams(rugby_code, category, age_group, gender, squad_designation), competition_editions(competitions(name, slug))")
      .eq("club_id", club.id)
      .eq("status", "entered"),
    supabase.from("club_contacts").select("role, name, phone, email").eq("club_id", club.id).eq("is_public", true),
    user ? hasCapability(supabase, "club.news.manage", "club", { clubId: club.id }) : Promise.resolve(false),
  ])

  const teams = teamRows ?? []
  const teamIds = teams.map((t) => t.id)

  // Competition names by edition, for results and (signed-in) fixtures alike.
  const competitions = new Map<string, CompetitionRef>()
  const ourParticipants = new Map<string, CompetitionParticipantRow>()
  for (const p of participantRows ?? []) {
    const comp = p.competition_editions?.competitions
    if (comp) competitions.set(p.edition_id, { name: comp.name, slug: comp.slug ?? null })
    ourParticipants.set(p.id, {
      id: p.id,
      editionId: p.edition_id,
      clubId: p.club_id,
      teamId: p.team_id,
      label: p.teams
        ? fullTeamLabel({ category: p.teams.category, ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation, rugbyCode: p.teams.rugby_code })
        : club.name,
    })
  }

  const publicFixtures = (fixtureRows ?? []).filter(
    (f): f is typeof f & { id: string; owning_team_id: string; kickoff_date: string } => Boolean(f.id && f.owning_team_id && f.kickoff_date)
  )

  // ------------------------------------------------------------------ round 2
  const ourIds = [...ourParticipants.keys()]
  const [competitionMatches, viewerFixtures, viewerResults] = await Promise.all([
    ourIds.length
      ? supabase
          .from("competition_matches")
          .select("id, edition_id, home_participant_id, away_participant_id, match_date, status, home_score, away_score")
          .eq("status", "completed")
          .or(`home_participant_id.in.(${ourIds.join(",")}),away_participant_id.in.(${ourIds.join(",")})`)
          .order("match_date", { ascending: false })
          .limit(8)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Which of the public fixtures this viewer may also open in Match Centre,
    // and their competition. RLS decides; an anonymous visitor skips the read.
    user && publicFixtures.length
      ? supabase
          .from("fixtures")
          .select("id, competition_edition_id")
          .in("id", publicFixtures.map((f) => f.id))
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    user && teamIds.length
      ? supabase
          .from("fixtures")
          .select("id, kickoff_date, home_away, raw_opposition_text, owning_team_id, season_id, home_score, away_score, competition_edition_id")
          .in("owning_team_id", teamIds)
          .eq("status", "Completed")
          .in("result_status", ["final", "external_recorded"])
          .is("archived_at", null)
          .not("home_score", "is", null)
          .not("away_score", "is", null)
          .order("kickoff_date", { ascending: false })
          .limit(8)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ])

  // Opponent names for competition results, in one read.
  const opponentIds = [
    ...new Set(
      competitionMatches
        .flatMap((m) => [m.home_participant_id, m.away_participant_id])
        .filter((id): id is string => Boolean(id) && !ourParticipants.has(id as string))
    ),
  ]
  const { data: opponentRows } = opponentIds.length
    ? await supabase
        .from("competition_participants")
        .select("id, edition_id, club_id, team_id, squad_label, club_directory(name), teams(rugby_code, category, age_group, gender, squad_designation)")
        .in("id", opponentIds)
    : { data: [] }
  const participants = new Map(ourParticipants)
  for (const p of opponentRows ?? []) {
    const teamLabel = p.teams
      ? fullTeamLabel({ category: p.teams.category, ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation, rugbyCode: p.teams.rugby_code })
      : p.squad_label
    participants.set(p.id, {
      id: p.id,
      editionId: p.edition_id,
      clubId: p.club_id,
      teamId: p.team_id,
      label: [p.club_directory?.name, teamLabel].filter(Boolean).join(" ") || "Opposition",
    })
  }

  // Season-true team names, in one batch, for every fixture on the page.
  const identities = await loadTeamIdentitiesForSeason(
    supabase,
    [...publicFixtures, ...viewerResults]
      .filter((f) => f.season_id && f.owning_team_id)
      .map((f) => ({ teamId: f.owning_team_id as string, seasonId: f.season_id as string }))
  )
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const labelFor = (teamId: string, seasonId: string | null, fallback: string | null) =>
    (seasonId && identities.get(teamIdentityKey(teamId, seasonId))?.displayName) || teamById.get(teamId)?.display_name || fallback || "Team"

  const viewerFixtureById = new Map(viewerFixtures.map((f) => [f.id, f]))
  const upcomingAll: ClubUpcomingMatch[] = publicFixtures.map((f) => {
    const visible = viewerFixtureById.get(f.id)
    return {
      id: f.id,
      date: f.kickoff_date,
      time: f.kickoff_time ? f.kickoff_time.slice(0, 5) : null,
      teamId: f.owning_team_id,
      teamLabel: labelFor(f.owning_team_id, f.season_id, f.team_display_name),
      opposition: f.raw_opposition_text ?? "Opposition to be confirmed",
      venueRole: venueRole(f.home_away),
      competition: visible?.competition_edition_id ? (competitions.get(visible.competition_edition_id) ?? null) : null,
      matchCentreHref: visible ? `/fixtures/${f.id}` : null,
    }
  })
  const upcoming = selectUpcoming(upcomingAll, todayIso, 12)

  const competitionResults = competitionMatches
    .map((m) =>
      competitionResultForClub(
        {
          id: m.id,
          editionId: m.edition_id,
          homeParticipantId: m.home_participant_id,
          awayParticipantId: m.away_participant_id,
          date: m.match_date,
          status: m.status,
          homeScore: m.home_score,
          awayScore: m.away_score,
        },
        club.id,
        participants,
        competitions
      )
    )
    .filter((r): r is ClubResult => r !== null)

  const fixtureResults = viewerResults
    .filter((f) => f.owning_team_id && f.kickoff_date && f.home_score !== null && f.away_score !== null)
    .map((f) =>
      fixtureResult({
        id: f.id,
        date: f.kickoff_date,
        homeAway: f.home_away,
        opposition: f.raw_opposition_text ?? "Opposition",
        teamId: f.owning_team_id as string,
        teamLabel: labelFor(f.owning_team_id as string, f.season_id, null),
        owningScore: f.home_score as number,
        opponentScore: f.away_score as number,
        editionId: f.competition_edition_id,
        competition: f.competition_edition_id ? (competitions.get(f.competition_edition_id) ?? null) : null,
      })
    )

  const results = mergeResults(competitionResults, fixtureResults, 6)

  // Teams, grouped the way the canonical Team Directory groups them, each
  // with its next public fixture if it has one.
  const nextByTeam = new Map<string, ClubUpcomingMatch>()
  for (const m of upcoming) if (!nextByTeam.has(m.teamId)) nextByTeam.set(m.teamId, m)
  const AGE_ORDER = (age: string | null) => (age ? Number(age.replace(/\D/g, "")) || 99 : 99)
  const grouped = new Map<DirectoryGroupKey, ClubTeamGroup["teams"]>()
  for (const t of [...teams].sort((a, b) => AGE_ORDER(a.age_group) - AGE_ORDER(b.age_group) || a.display_name.localeCompare(b.display_name))) {
    const key = groupKeyFor({ id: t.id, category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, isActive: true, sortOrder: 0 })
    grouped.set(key, [...(grouped.get(key) ?? []), { id: t.id, name: t.display_name, nextMatch: nextByTeam.get(t.id) ?? null }])
  }
  const teamGroups = DIRECTORY_GROUPS.filter((g) => grouped.has(g.key)).map((g) => ({ key: g.key, title: g.title, teams: grouped.get(g.key)! }))

  const leadStory = lead ?? latestPage.articles[0] ?? null
  const latest = latestPage.articles.filter((a) => a.id !== leadStory?.id).slice(0, 6)

  return {
    lead: leadStory,
    latest,
    teamNews: teamNewsPage.articles.filter((a) => a.id !== leadStory?.id),
    totalArticles: latestPage.total + teamNewsPage.total,
    announcements,
    upcoming,
    results,
    resultsIncludeMemberView: fixtureResults.length > 0,
    teamGroups,
    teamCount: teams.length,
    contacts: (contactRows ?? []).map((c) => ({ role: c.role, name: c.name, phone: c.phone, email: c.email })),
    viewer: { signedIn: Boolean(user), canManageNews },
  }
}
