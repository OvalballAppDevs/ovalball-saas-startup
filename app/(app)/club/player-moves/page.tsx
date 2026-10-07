import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { Users } from "lucide-react"

import { readDispensationRegister, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { loadStaffPlayers } from "@/lib/players/staff-players"
import { DispensationRegister } from "@/components/dispensations/dispensation-register"

import { ClubSettingsNav } from "../settings/club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../settings/resolve-nav-capabilities"
import { CallUpPanel, type CallUpFixtureOption, type CallUpPlayerOption, type CallUpRow, type CallUpTeamOption } from "./call-up-panel"
import { DispensationRequestPanel } from "./dispensation-panel"

/**
 * RESUME SEASON HANDOVER Sections 23-25: real UI over the existing
 * call-up and dispensation domains. Every action re-authorizes
 * server-side via the RPCs themselves -- this page's own queries only
 * decide what to SHOW, never what a click is allowed to do. Dispensations
 * are the one workflow (20270742000000): asked for here, decided on each
 * record by the club's Safeguarding Officer or a Club Admin.
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

  const navCaps = await resolveClubSettingsNavCapabilities(supabase, activeClub)
  const { canFixtureCallups: canCallUps, canPlayerDispensations: canDispensations } = navCaps
  if (!activeClub || (!canCallUps && !canDispensations)) redirect("/dashboard")

  const { data: club } = await supabase.from("clubs").select("id, club_directory(rugby_code, name)").eq("id", activeClub).maybeSingle()
  if (!club) redirect("/dashboard")
  const todayIso = new Date().toISOString().slice(0, 10)

  const [{ data: teams }, { data: memberships }, { data: fixtureRows }] = await Promise.all([
    supabase.from("teams").select("id, display_name, category, age_group, gender").eq("club_id", activeClub).eq("active", true).order("display_name"),
    supabase
      .from("player_team_memberships")
      .select("player_id, team_id, teams(display_name, category, age_group, gender)")
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
  const memberPlayers = await loadStaffPlayers(supabase, (memberships ?? []).map((m) => m.player_id))
  const playerOptions: CallUpPlayerOption[] = (memberships ?? []).map((m) => ({
    playerId: m.player_id,
    playerName: memberPlayers.get(m.player_id)?.displayName || "Unknown player",
    currentTeamId: m.team_id,
    currentTeamName: m.teams?.display_name ?? "Unknown team",
    category: m.teams?.category ?? "youth",
    ageGroup: m.teams?.age_group ?? null,
    gender: m.teams?.gender ?? null,
  }))

  const [{ data: callUpRows }, dispensations] = await Promise.all([
    canCallUps
      ? supabase
          .from("fixture_player_call_up")
          .select(
            "id, status, eligibility_rule_reference, source_team_id, player_id, source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text)"
          )
          .or(`source_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"}),target_team_id.in.(${(teams ?? []).map((t) => t.id).join(",") || "00000000-0000-0000-0000-000000000000"})`)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    canDispensations
      ? readDispensationRegister(supabase as unknown as Parameters<typeof readDispensationRegister>[0], activeClub).catch(() => [] as DispensationRecord[])
      : Promise.resolve([] as DispensationRecord[]),
  ])

  const clubTeamIds = new Set((teams ?? []).map((t) => t.id))
  const movementPlayers = await loadStaffPlayers(supabase, (callUpRows ?? []).map((r) => r.player_id))
  const callUps: CallUpRow[] = (callUpRows ?? []).map((r) => ({
    id: r.id,
    playerName: movementPlayers.get(r.player_id)?.displayName || "Unknown player",
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



  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Users className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Player Moves</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Borrow a player for a single fixture, or ask for a player to play outside their age grade this season. A dispensation is an exception the
        club&apos;s Safeguarding Officer or a Club Admin decides.
      </p>

      <ClubSettingsNav active="playerMoves" {...navCaps} />

      <div className="mt-8 space-y-6">
        {canCallUps && <CallUpPanel teams={teamOptions} fixtures={fixtureOptions} players={playerOptions} rows={callUps} />}
        {canDispensations && (
          <section aria-labelledby="player-moves-dispensations" className="rounded-lg border border-ink/10 bg-white p-6">
            <h2 id="player-moves-dispensations" className="font-display text-lg text-ink">
              Dispensations
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              A child outside a team&apos;s age grade can only be placed there with an approved dispensation, for that team and season.
            </p>
            <DispensationRequestPanel teams={teamOptions} players={playerOptions} />
            <div className="mt-6 border-t border-ink/10 pt-4">
              <DispensationRegister records={dispensations} emptyText="No dispensations yet." />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
