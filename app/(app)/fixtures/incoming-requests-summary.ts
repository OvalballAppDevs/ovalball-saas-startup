import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { RequestRowData } from "./request-row"
import type { TournamentInvitationRowData } from "./fixture-requests-sheet"

/**
 * Section 21-22's popup scope: ACTION REQUIRED only (incoming ordinary
 * requests, including missing-team named-identity ones, plus pending
 * tournament invitations) -- reusing the SAME query shapes /fixtures/
 * page.tsx already established for its own incoming section, not a
 * second implementation. Sent/rejected/non-Ovalball history is
 * deliberately left to the full page (linked from the Sheet), not
 * duplicated here.
 */
export async function getIncomingFixtureRequestsSummary(
  supabase: SupabaseClient<Database>,
  teamIds: string[],
  clubId: string | null,
  isSiteAdmin: boolean,
  isClubAdmin: boolean
): Promise<{ incoming: RequestRowData[]; tournamentInvitations: TournamentInvitationRowData[] }> {
  const incoming: RequestRowData[] = []

  if (teamIds.length > 0) {
    const { data: ordinary } = await supabase
      .from("fixture_requests")
      .select("id, venue_preference, teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)")
      .in("target_team_id", teamIds)
      .eq("status", "sent")
    for (const r of ordinary ?? []) {
      incoming.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        venuePreference: r.venue_preference,
      })
    }
  }

  if (clubId) {
    const { data: namedIdentityRequests } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, target_team_age_group, target_team_gender, target_team_squad_designation, created_by, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups!inner(proposed_date, raw_opponent_text, opponent_club_id)"
      )
      .is("target_team_id", null)
      .not("target_team_age_group", "is", null)
      .eq("fixture_request_groups.opponent_club_id", clubId)
      .eq("status", "sent")

    const creatorIds = [...new Set((namedIdentityRequests ?? []).map((r) => r.created_by))]
    const { data: creatorSiteAdmins } =
      creatorIds.length > 0 ? await supabase.from("site_admins").select("user_id").in("user_id", creatorIds).eq("status", "active") : { data: [] as { user_id: string }[] }
    const siteAdminCreatorIds = new Set((creatorSiteAdmins ?? []).map((a) => a.user_id))

    for (const r of namedIdentityRequests ?? []) {
      const genderLabel = r.target_team_gender === "girls" ? "Girls " : ""
      const identityLabel = `${genderLabel}${r.target_team_age_group}${r.target_team_squad_designation ? ` ${r.target_team_squad_designation}` : ""}`
      const { data: resolved } = await supabase.rpc("check_incoming_request_target", { p_request_id: r.id }).single()
      incoming.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups.proposed_date ?? "",
        venuePreference: r.venue_preference,
        namedTeamIdentity: identityLabel,
        namedTeamResolution: (resolved?.resolution ?? null) as RequestRowData["namedTeamResolution"],
        namedTeamExistingId: resolved?.existing_team_id ?? null,
        namedTeamMessage: resolved?.message ?? null,
        initiatedBySiteAdmin: siteAdminCreatorIds.has(r.created_by),
        canCreateOrReactivateTeam: isClubAdmin || isSiteAdmin,
      })
    }
  }

  // Group-targeted requests (target_team_id still null, a shared
  // mini-rugby calendar named instead) never match the plain
  // target_team_id filter above -- without this, an incoming request
  // against one of my club's shared calendars would silently never
  // appear here, even though it's genuinely action-required. Mirrors
  // app/(app)/fixtures/page.tsx's own identical block.
  if (clubId) {
    const { data: myGroups } = await supabase.from("scheduling_groups").select("id, display_tag").eq("club_id", clubId)
    const myGroupIds = (myGroups ?? []).map((g) => g.id)
    if (myGroupIds.length > 0) {
      const { data: groupRequests } = await supabase
        .from("fixture_requests")
        .select(
          "id, venue_preference, target_scheduling_group_id, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
        )
        .in("target_scheduling_group_id", myGroupIds)
        .eq("status", "sent")

      for (const r of groupRequests ?? []) {
        const groupTag = myGroups?.find((g) => g.id === r.target_scheduling_group_id)?.display_tag ?? null
        const { data: members } = await supabase
          .from("scheduling_group_members")
          .select("teams(id, display_name, age_group)")
          .eq("group_id", r.target_scheduling_group_id!)

        incoming.push({
          id: r.id,
          direction: "incoming",
          teamDisplayName: r.teams?.display_name ?? "Team",
          opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
          proposedDate: r.fixture_request_groups?.proposed_date ?? "",
          venuePreference: r.venue_preference,
          schedulingGroupTag: groupTag,
          schedulingGroupMembers: (members ?? []).flatMap((m) => (m.teams ? [{ id: m.teams.id, name: m.teams.display_name, ageGroup: m.teams.age_group }] : [])),
        })
      }
    }
  }

  incoming.sort((a, b) => a.proposedDate.localeCompare(b.proposedDate))

  const tournamentInvitations: TournamentInvitationRowData[] = []
  if (clubId || teamIds.length > 0) {
    const orClauses = [clubId ? `club_id.eq.${clubId}` : null, teamIds.length > 0 ? `team_id.in.(${teamIds.join(",")})` : null].filter(Boolean).join(",")
    const { data: invites } = await supabase
      .from("tournament_participants")
      .select("id, canonical_team_types(label), tournaments(event_date, clubs(club_directory(name)))")
      .or(orClauses)
      .eq("status", "pending")
    for (const inv of invites ?? []) {
      const { data: resolved } = await supabase.rpc("check_tournament_participant_target", { p_participant_id: inv.id }).single()
      tournamentInvitations.push({
        id: inv.id,
        hostClubName: inv.tournaments?.clubs?.club_directory?.name ?? "Host club",
        teamIdentityLabel: inv.canonical_team_types?.label ?? "Team",
        eventDate: inv.tournaments?.event_date ?? "",
        resolution: (resolved?.resolution ?? null) as TournamentInvitationRowData["resolution"],
      })
    }
  }

  return { incoming, tournamentInvitations }
}
