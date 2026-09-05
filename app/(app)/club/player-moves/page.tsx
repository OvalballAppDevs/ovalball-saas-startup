import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { Users } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../settings/club-settings-nav"
import { CallUpPanel, type CallUpFixtureOption, type CallUpPlayerOption, type CallUpRow, type CallUpTeamOption } from "./call-up-panel"
import { DispensationPanel, type DispensationRow } from "./dispensation-panel"

/**
 * RESUME SEASON HANDOVER Sections 23-25: real UI over the existing
 * call-up and dispensation domains. Every action re-authorizes
 * server-side via the RPCs themselves (has_capability + the specific
 * source-team/club checks each stage requires) -- this page's own
 * queries only decide what to SHOW, never what a click is allowed to do.
 */
export default async function PlayerMovesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)

  const [canCallUps, canDispensations, canEditProfile, canVenues, canRollover] = activeClub
    ? await Promise.all([
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId: activeClub }),
        hasCapability(supabase, "manage_player_dispensations", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.edit_profile", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId: activeClub }),
      ])
    : [false, false, false, false, false]
  if (!activeClub || (!canCallUps && !canDispensations)) redirect("/dashboard")

  const { data: club } = await supabase.from("clubs").select("id, club_directory(rugby_code, name)").eq("id", activeClub).maybeSingle()
  if (!club) redirect("/dashboard")
  const rugbyCode = (club.club_directory?.rugby_code ?? "union") as "union" | "league"
  const todayIso = new Date().toISOString().slice(0, 10)

  const [{ data: teams }, { data: memberships }, { data: fixtureRows }, { data: currentSeason }] = await Promise.all([
    supabase.from("teams").select("id, display_name, category, age_group, gender").eq("club_id", activeClub).eq("active", true).order("display_name"),
    supabase
      .from("player_team_memberships")
      .select("player_id, team_id, players(first_name, surname), teams(display_name, category, age_group, gender)")
      .eq("status", "active")
      .is("ended_at", null)
      .in("team_id", (await supabase.from("teams").select("id").eq("club_id", activeClub)).data?.map((t) => t.id) ?? []),
    supabase
      .from("fixtures")
      .select("id, owning_team_id, kickoff_date, raw_opposition_text")
      .in("owning_team_id", (await supabase.from("teams").select("id").eq("club_id", activeClub)).data?.map((t) => t.id) ?? [])
      .gte("kickoff_date", todayIso)
      .neq("status", "Cancelled")
      .order("kickoff_date"),
    supabase
      .from("seasons")
      .select("id, name")
      .eq("rugby_code", rugbyCode)
      .eq("is_regression_fixture", false)
      .lte("starts_on", todayIso)
      .gte("ends_on", todayIso)
      .limit(1)
      .maybeSingle(),
  ])

  const teamOptions: CallUpTeamOption[] = (teams ?? []).map((t) => ({
    id: t.id,
    displayName: t.display_name,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
  }))
  const fixtureOptions: CallUpFixtureOption[] = (fixtureRows ?? []).map((f) => ({
    id: f.id,
    owningTeamId: f.owning_team_id,
    kickoffDate: f.kickoff_date,
    opponentLabel: f.raw_opposition_text,
  }))
  const playerOptions: CallUpPlayerOption[] = (memberships ?? []).map((m) => ({
    playerId: m.player_id,
    playerName: m.players ? `${m.players.first_name} ${m.players.surname}` : "Unknown player",
    currentTeamId: m.team_id,
    currentTeamName: m.teams?.display_name ?? "Unknown team",
    category: m.teams?.category ?? "youth",
    ageGroup: m.teams?.age_group ?? null,
    gender: m.teams?.gender ?? null,
  }))

  const [{ data: callUpRows }, { data: dispensationRows }] = await Promise.all([
    canCallUps
      ? supabase
          .from("fixture_player_call_up")
          .select(
            "id, status, eligibility_rule_reference, source_team_id, players(first_name, surname), source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text)"
          )
          .or(`source_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"}),target_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"})`)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    canDispensations
      ? supabase
          .from("player_team_dispensation")
          .select(
            "id, status, eligibility_rule_reference, governing_body_reference, source_team_id, players(first_name, surname), source_team:source_team_id(display_name), target_team:target_team_id(display_name), seasons(name)"
          )
          .or(`source_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"}),target_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"})`)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ])

  const clubTeamIds = new Set((teams ?? []).map((t) => t.id))
  const callUps: CallUpRow[] = (callUpRows ?? []).map((r) => ({
    id: r.id,
    playerName: r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown player",
    sourceTeamId: r.source_team_id,
    sourceTeamName: r.source_team?.display_name ?? "Unknown team",
    targetTeamName: r.target_team?.display_name ?? "Unknown team",
    fixtureLabel: r.fixtures
      ? `${new Date(r.fixtures.kickoff_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} vs ${r.fixtures.raw_opposition_text}`
      : "Unknown fixture",
    eligibilityRuleReference: r.eligibility_rule_reference,
    status: r.status as CallUpRow["status"],
    canDecide: clubTeamIds.has(r.source_team_id),
  }))

  const dispensations: DispensationRow[] = (dispensationRows ?? []).map((r) => ({
    id: r.id,
    playerName: r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown player",
    sourceTeamId: r.source_team_id,
    sourceTeamName: r.source_team?.display_name ?? "Unknown team",
    targetTeamName: r.target_team?.display_name ?? "Unknown team",
    seasonName: r.seasons?.name ?? "Unknown season",
    eligibilityRuleReference: r.eligibility_rule_reference,
    governingBodyReference: r.governing_body_reference,
    status: r.status as DispensationRow["status"],
    canDecideSourceTeam: clubTeamIds.has(r.source_team_id),
    canDecideClub: true, // decide_player_dispensation itself enforces is_club_admin for the club/governing_body stages -- this only controls whether the button renders.
  }))

  const canTeamsForNav = canEditProfile || canVenues

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Users className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Player moves</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Borrow a player for a single fixture, or move one onto a different team for the season -- both need the source team&apos;s consent first.
      </p>

      <ClubSettingsNav active="playerMoves" canProfile={canEditProfile} canTeams={canTeamsForNav} canVenues={canVenues} canRollover={canRollover} canPlayerMoves />

      <div className="mt-8 space-y-6">
        {canCallUps && <CallUpPanel teams={teamOptions} fixtures={fixtureOptions} players={playerOptions} rows={callUps} />}
        {canDispensations && (
          <DispensationPanel seasonId={currentSeason?.id ?? null} seasonName={currentSeason?.name ?? null} teams={teamOptions} players={playerOptions} rows={dispensations} />
        )}
      </div>
    </div>
  )
}
