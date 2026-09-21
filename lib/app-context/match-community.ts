import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * CONVERGENCE STEP 11 -- the community layer's server-derived view model.
 *
 * Every flag on it is decided by the database. Nothing here re-derives eligibility from a role
 * name, a badge or anything the browser sent, because the same functions that answer these
 * questions are the ones that refuse the write -- so a page that renders a control the server
 * would reject is a bug in one place rather than a disagreement between two.
 */

export type AwardStatus = "OPEN" | "CLOSED"
export type AwardOutcome = "WINNER" | "TIE" | "NO_VOTES"
export type Electorate = "FAMILY_OR_SELF" | "TEAM_COACHES" | "OPPOSITION_COACHES"

export interface MatchAward {
  awardId: string
  teamId: string
  categoryKey: string
  /** The team's own name for it if it set one, otherwise the canonical name for this side's age. */
  displayName: string
  electorate: Electorate
  status: AwardStatus
  outcome: AwardOutcome | null
  winnerPlayerId: string | null
  winnerName: string | null
  canVote: boolean
  myVotePlayerId: string | null
  canManage: boolean
  /** Staff only, and only once it is closed. Null for everybody else -- see the report on totals. */
  totalVotes: number | null
}

export interface MatchKudosEntry {
  teamId: string
  playerId: string
  playerName: string
  kudosKey: string
  label: string
  givenCount: number
  /** True when this viewer is one of the people who gave it. */
  mine: boolean
}

export interface KudosKind {
  kudosKey: string
  label: string
}

export interface RecognitionSquadMember {
  playerId: string
  displayName: string
}

export interface AdminCategory {
  teamId: string
  categoryKey: string
  displayName: string
  electorate: Electorate
  enabled: boolean
  displayNameOverride: string | null
  awardId: string | null
  awardStatus: AwardStatus | null
  /** False when the category cannot run on this match -- an opposition award with no Ovalball opponent. */
  available: boolean
}

export interface MatchReportLink {
  articleId: string
  title: string
  /** The team whose news the article lives under; the route is the team's, not a second one. */
  teamId: string
}

export interface MatchCommunity {
  awards: MatchAward[]
  kudos: MatchKudosEntry[]
  kudosKinds: KudosKind[]
  /** Names this viewer may choose between, per side. Empty when they may not choose anything. */
  squadByTeam: Record<string, RecognitionSquadMember[]>
  /** Sides this viewer may give recognition to at all. */
  givableTeamIds: string[]
  /** Empty for everybody who does not administer a side -- the server returns them nothing. */
  admin: AdminCategory[]
  /**
   * The write-up, if somebody published one. `club_articles` has carried a MATCH_REPORT category
   * since the Club Digital Home; what it never had was the match. Step 11 gave it one rather than
   * building a second article model, and this is the read that makes the link visible.
   */
  report: MatchReportLink | null
}

const EMPTY: MatchCommunity = { awards: [], kudos: [], kudosKinds: [], squadByTeam: {}, givableTeamIds: [], admin: [], report: null }

export async function getMatchCommunity(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
  teamIds: string[]
): Promise<MatchCommunity> {
  const [{ data: awardRows }, { data: kudosRows }, { data: kindRows }, { data: adminRows }] = await Promise.all([
    supabase.rpc("get_match_community", { p_fixture_id: fixtureId }),
    supabase.rpc("get_match_kudos", { p_fixture_id: fixtureId }),
    supabase.from("match_kudos_kinds").select("kudos_key, label").eq("active", true).order("sort_order"),
    supabase.rpc("get_match_community_admin", { p_fixture_id: fixtureId }),
  ])

  // The article keeps its own visibility and publishing rules; this asks for it and accepts nothing
  // when those rules say no.
  const { data: reportRow } = await supabase
    .from("club_articles")
    .select("id, title, team_id")
    .eq("fixture_id", fixtureId)
    .eq("category", "MATCH_REPORT")
    .eq("status", "PUBLISHED")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const awards: MatchAward[] = (awardRows ?? []).map((a) => ({
    awardId: a.award_id,
    teamId: a.team_id,
    categoryKey: a.category_key,
    displayName: a.display_name,
    electorate: a.electorate as Electorate,
    status: a.status as AwardStatus,
    outcome: (a.outcome as AwardOutcome | null) ?? null,
    winnerPlayerId: a.winner_player_id,
    winnerName: a.winner_name,
    canVote: a.can_vote,
    myVotePlayerId: a.my_vote_player_id,
    canManage: a.can_manage,
    totalVotes: a.total_votes,
  }))

  // THE SQUAD IS ASKED FOR PER SIDE, AND REFUSED PER SIDE. A viewer with no standing on a side gets
  // an error from the reader rather than an empty array, and an error here means "not yours to
  // see", so it is absence rather than a failure -- the page simply offers nothing for that side.
  const squadByTeam: Record<string, RecognitionSquadMember[]> = {}
  const givableTeamIds: string[] = []
  await Promise.all(
    teamIds.map(async (teamId) => {
      const { data, error } = await supabase.rpc("get_match_recognition_squad", {
        p_fixture_id: fixtureId,
        p_team_id: teamId,
      })
      if (error || !data) return
      squadByTeam[teamId] = data.map((r) => ({ playerId: r.player_id, displayName: r.display_name ?? "" }))
      givableTeamIds.push(teamId)
    })
  )

  return {
    ...EMPTY,
    awards,
    kudos: (kudosRows ?? []).map((k) => ({
      teamId: k.team_id,
      playerId: k.player_id,
      playerName: k.player_name ?? "",
      kudosKey: k.kudos_key,
      label: k.label,
      givenCount: k.given_count,
      mine: k.mine,
    })),
    kudosKinds: (kindRows ?? []).map((k) => ({ kudosKey: k.kudos_key, label: k.label })),
    squadByTeam,
    givableTeamIds,
    admin: (adminRows ?? []).map((r) => ({
      teamId: r.team_id,
      categoryKey: r.category_key,
      displayName: r.display_name,
      electorate: r.electorate as Electorate,
      enabled: r.enabled,
      displayNameOverride: r.display_name_override,
      awardId: r.award_id,
      awardStatus: (r.award_status as AwardStatus | null) ?? null,
      available: r.available,
    })),
    // Only a TEAM match report is linked: the canonical article route is the team's news, and a
    // club-level article has no team to route through. Guessing a second route would be inventing one.
    report:
      reportRow && reportRow.team_id
        ? { articleId: reportRow.id, title: reportRow.title, teamId: reportRow.team_id }
        : null,
  }
}
