import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ArrowRightLeft } from "lucide-react"

import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { CallUpPanel, type CallUpFixtureOption, type CallUpPlayerOption, type CallUpRow, type CallUpTeamOption } from "../../../club/player-moves/call-up-panel"

/**
 * PLAYER REQUESTS Section 12: a team-facing entry point, separate from
 * Club Settings, scoped to exactly one team -- reachable by a plain
 * team_admin/coach/manager who is NOT a Club Admin, since it checks
 * manage_fixture_callups at TEAM scope rather than requiring the
 * club-wide role /teams/[teamId] itself gates on. Reuses CallUpPanel
 * verbatim (the component is already the real request/decide UI) with
 * its data narrowed to this one team: only this team's own upcoming
 * fixtures, and only call-ups where this team is source or target --
 * never club-wide visibility.
 */
export default async function TeamPlayerRequestsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await getSessionContext(supabase, user)

  const { data: team } = await supabase.from("teams").select("id, club_id, display_name, category, age_group, gender").eq("id", teamId).maybeSingle()
  if (!team) notFound()

  const canRequest = await hasCapability(supabase, "manage_fixture_callups", "team", { clubId: team.club_id, teamId: team.id })
  if (!canRequest) redirect("/teams")

  const todayIso = new Date().toISOString().slice(0, 10)

  const [{ data: memberships }, { data: fixtureRows }] = await Promise.all([
    supabase
      .from("player_team_memberships")
      .select("player_id, team_id, players(first_name, surname), teams(display_name, category, age_group, gender)")
      .eq("status", "active")
      .is("ended_at", null)
      .in("team_id", (await supabase.from("teams").select("id").eq("club_id", team.club_id)).data?.map((t) => t.id) ?? []),
    supabase
      .from("fixtures")
      .select("id, owning_team_id, kickoff_date, raw_opposition_text")
      .eq("owning_team_id", team.id)
      .gte("kickoff_date", todayIso)
      .neq("status", "Cancelled")
      .order("kickoff_date"),
  ])

  const teamOptions: CallUpTeamOption[] = [{ id: team.id, displayName: team.display_name, category: team.category, ageGroup: team.age_group, gender: team.gender }]
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

  const { data: callUpRows } = await supabase
    .from("fixture_player_call_up")
    .select(
      "id, status, eligibility_rule_reference, source_team_id, players(first_name, surname), source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text)"
    )
    .or(`source_team_id.eq.${team.id},target_team_id.eq.${team.id}`)
    .order("created_at", { ascending: false })

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
    canDecide: r.source_team_id === team.id,
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href={`/teams/${team.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        {team.display_name}
      </Link>

      <div className="mt-4 flex items-center gap-2">
        <ArrowRightLeft className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Player requests</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Request a player from another team at this club for a fixture, or decide a request another team has made for one of your own players.
      </p>

      <div className="mt-8">
        <CallUpPanel teams={teamOptions} fixtures={fixtureOptions} players={playerOptions} rows={callUps} />
      </div>
    </div>
  )
}
