import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { CalendarSync } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../settings/club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../settings/resolve-nav-capabilities"
import { HandoverApply, type AuditEntry } from "./handover-apply"
import { HandoverNeedsAttention, type HandoverBlocker } from "./handover-attention"
import { HandoverNav, resolveHandoverSection } from "./handover-nav"
import { HandoverOverview, type HandoverConsequence } from "./handover-overview"
import { GraduationQueue, type GraduationQueueRow, type GraduationTargetTeamOption } from "./graduation-queue"
import { MiniRugbyNextSeasonReview, type MiniRugbyGroupRow } from "./mini-rugby-next-season"
import { PlayerHandoverProposals, type PlayerProposalRow } from "./player-handover-proposals"
import { RolloverReview, type RolloverBatch, type SeasonOption } from "./rollover-review"

/**
 * The Season Handover board.
 *
 * PREPARE -> DECIDE -> REVIEW -> APPLY. Everything on this page up to the Apply
 * section records decisions; none of it changes a team, a membership or a
 * season identity. apply_season_handover is the single mutation boundary, and
 * it runs server-side in one transaction rather than being sequenced from here.
 *
 * The five sections are routes (?section=...), not tab widgets, so Back,
 * Refresh and a copied link all behave the way a reviewer expects when a
 * handover is worked through over several days by more than one person.
 */
export default async function ClubRolloverPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)
  // Scoped to the ACTIVE context, not "any CLUB_ADMIN membership this session
  // holds" -- see app/(app)/people/page.tsx for the identical, live-confirmed
  // leak this mirrors. Authorization derives from the canonical capability
  // engine (club.season_rollover.manage) rather than a raw role comparison.
  const navCaps = await resolveClubSettingsNavCapabilities(supabase, activeClub)
  const { canRollover: canRunRollover } = navCaps
  if (!canRunRollover || !activeClub) redirect("/dashboard")

  const section = resolveHandoverSection((await searchParams).section)

  const { data: club } = await supabase.from("clubs").select("id, club_directory(rugby_code, name)").eq("id", activeClub).maybeSingle()
  if (!club) redirect("/dashboard")

  const rugbyCode = (club.club_directory?.rugby_code ?? "union") as "union" | "league"
  const todayIso = new Date().toISOString().slice(0, 10)

  const [{ data: seasons }, { data: currentSeasonRows }, { data: rollovers }] = await Promise.all([
    // is_regression_fixture rows (SQL-regression-test scaffolding) are excluded
    // so a Club Admin can never roll a real club onto a synthetic test season.
    supabase
      .from("seasons")
      .select("id, name, starts_on, pre_season_starts_on, season_ref")
      .eq("rugby_code", rugbyCode)
      .eq("is_regression_fixture", false)
      .gte("starts_on", todayIso)
      .order("starts_on"),
    // The same canonical `seasons` table -- just the row containing today, so
    // the empty state can name it explicitly. Never a second season concept.
    supabase.from("seasons").select("id, name").eq("rugby_code", rugbyCode).eq("is_regression_fixture", false).lte("starts_on", todayIso).gte("ends_on", todayIso).limit(1).maybeSingle(),
    supabase
      .from("age_grade_rollovers")
      .select(
        "id, created_at, applied_at, decisions_revision, from_season_id, to_season_id, from_season:from_season_id(name), to_season:to_season_id(name), age_grade_rollover_team_proposals(id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary, decision, decided_age_group, girls_team_created, create_girls_team, fold_reason, applied_at, teams!age_grade_rollover_team_proposals_team_id_fkey(display_name, gender, squad_designation)), age_grade_rollover_group_flags(id, scheduling_group_id, reason, resolved, scheduling_groups(display_tag))"
      )
      .eq("club_id", club.id)
      // Defence in depth: generate_rollover_proposal rejects a mismatched
      // rugby_code server-side, but this page must never display a wrong-code
      // batch even if one somehow exists.
      .eq("rugby_code", rugbyCode)
      .order("created_at", { ascending: false }),
  ])

  const toSeasonOptions: SeasonOption[] = (seasons ?? []).map((s) => ({ id: s.id, name: s.name }))
  const nextSeasonOption = toSeasonOptions[0] ?? null
  const nextSeasonRaw = seasons?.[0] ?? null

  const currentRollover = (rollovers ?? []).find((r) => r.to_season_id === nextSeasonOption?.id) ?? null

  // The handover's lifecycle, its readiness and everything standing in its way
  // all come from the server, computed from live state. A board that decided
  // any of this for itself could tell a club it was ready while Apply refused.
  const [{ data: stateValue }, { data: readinessRows }, { data: blockerRows }, { data: consequenceRows }, { data: auditRows }] = currentRollover
    ? await Promise.all([
        supabase.rpc("handover_state", { p_rollover_id: currentRollover.id }),
        supabase.rpc("rollover_readiness", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_apply_blockers", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_consequences", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_audit", { p_rollover_id: currentRollover.id }),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }, { data: null }]

  const readiness = (readinessRows ?? [])[0] ?? null
  const blockers: HandoverBlocker[] = (blockerRows ?? []).map((b) => ({
    kind: b.kind as HandoverBlocker["kind"],
    subject: b.subject,
    detail: b.detail,
  }))
  const consequences: HandoverConsequence[] = (consequenceRows ?? []).map((c) => ({
    kind: c.kind as HandoverConsequence["kind"],
    fromLabel: c.from_label,
    toLabel: c.to_label,
    note: c.note,
    isApplied: c.is_applied,
  }))
  const audit: AuditEntry[] = (auditRows ?? []).map((a) => ({ at: a.at, event: a.event, actorName: a.actor_name }))
  const handoverState = (stateValue as string | null) ?? "PREPARING"

  const { data: plannedTeamRows } = currentRollover
    ? await supabase
        .from("age_grade_rollover_planned_teams")
        .select("id, squad_designation, origin, applied_at, canonical_team_types(label)")
        .eq("rollover_id", currentRollover.id)
    : { data: null }

  const plannedLabelById = new Map(
    (plannedTeamRows ?? []).map((p) => [
      p.id,
      `${p.canonical_team_types?.label ?? "Team"}${p.squad_designation ? ` ${p.squad_designation}` : ""}`,
    ])
  )

  const [{ data: graduationRows }, { data: activeTeams }] = await Promise.all([
    supabase
      .from("player_graduation_queue")
      .select("id, players(first_name, surname), teams!player_graduation_queue_source_team_id_fkey(display_name)")
      .eq("club_id", club.id)
      .eq("status", "pending_placement")
      .order("created_at"),
    supabase.from("teams").select("id, display_name").eq("club_id", club.id).eq("active", true).order("display_name"),
  ])

  const graduationQueueRows: GraduationQueueRow[] = (graduationRows ?? []).map((r) => ({
    id: r.id,
    playerName: r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown player",
    previousTeamName: r.teams?.display_name ?? "Unknown team",
  }))
  const graduationTargetTeams: GraduationTargetTeamOption[] = (activeTeams ?? []).map((t) => ({ id: t.id, displayName: t.display_name }))

  // Active Mini-Rugby Groups for THIS club's CURRENT season only.
  let miniRugbyGroups: MiniRugbyGroupRow[] = []
  if (currentSeasonRows && section === "teams") {
    const { data: groupRows } = await supabase
      .from("scheduling_groups")
      .select("id, display_tag, alias, scheduling_group_members(team_id, teams(display_name))")
      .eq("club_id", club.id)
      .eq("season_id", currentSeasonRows.id)
      .eq("active", true)

    const groups = groupRows ?? []
    const identityPairs = nextSeasonOption
      ? groups.flatMap((g) => g.scheduling_group_members.map((m) => ({ teamId: m.team_id, seasonId: nextSeasonOption.id })))
      : []
    const nextSeasonIdentities = await loadTeamIdentitiesForSeason(supabase, identityPairs)

    const { data: nextSeasonGroupRows } = nextSeasonOption
      ? await supabase
          .from("scheduling_groups")
          .select("display_tag, scheduling_group_members(team_id)")
          .eq("club_id", club.id)
          .eq("season_id", nextSeasonOption.id)
      : { data: null }
    const alreadyProgressedTeamIds = new Set((nextSeasonGroupRows ?? []).flatMap((g) => g.scheduling_group_members.map((m) => m.team_id)))
    const alreadyCreatedTagByGroup = new Map(
      (nextSeasonGroupRows ?? [])
        .filter((g) => g.scheduling_group_members.length > 0)
        .flatMap((g) => g.scheduling_group_members.map((m) => [m.team_id, g.display_tag] as const))
    )

    miniRugbyGroups = groups.map((g) => ({
      id: g.id,
      displayTag: g.display_tag,
      alias: g.alias,
      teams: g.scheduling_group_members.map((m) => ({
        teamId: m.team_id,
        displayName: m.teams?.display_name ?? "Unknown team",
        projectedAgeGroup: nextSeasonIdentities.get(`${m.team_id}:${nextSeasonOption?.id}`)?.ageGroup ?? null,
      })),
      alreadyCreatedTag: g.scheduling_group_members.some((m) => alreadyProgressedTeamIds.has(m.team_id))
        ? (alreadyCreatedTagByGroup.get(g.scheduling_group_members[0]?.team_id) ?? "a next-season group")
        : null,
    }))
  }

  // A past batch's own proposals recorded what each team's identity WAS at that
  // batch's from_season -- a team re-aged in a LATER handover must not
  // retroactively relabel an older batch's history.
  const rolloverIdentityPairs = (rollovers ?? []).flatMap((r) =>
    r.from_season_id ? r.age_grade_rollover_team_proposals.map((p) => ({ teamId: p.team_id, seasonId: r.from_season_id as string })) : []
  )
  const rolloverTeamIdentities = await loadTeamIdentitiesForSeason(supabase, rolloverIdentityPairs)

  /* ------------------------------------------------------------------
   * Player handover proposals for the handover currently in progress.
   *
   * Note what is NOT selected: no date of birth. The server reads one to
   * resolve an age grade and this receives the resolved decision, which is
   * everything the board needs to show.
   * ---------------------------------------------------------------- */
  const { data: playerProposalRows } = currentRollover
    ? await supabase
        .from("age_grade_rollover_player_proposals")
        .select(
          "id, player_id, proposed_team_id, selected_team_id, planned_team_id, selected_at, review_state, allocation_status, movement_requirement, regulatory_age_label, reason, placement_applied_at, normal_canonical_team_type_id, players(first_name, surname), current_team:teams!age_grade_rollover_player_proposals_current_team_id_fkey(display_name), proposed_team:teams!age_grade_rollover_player_proposals_proposed_team_id_fkey(display_name), selected_team:teams!age_grade_rollover_player_proposals_selected_team_id_fkey(display_name)"
        )
        .eq("rollover_id", currentRollover.id)
    : { data: null }

  // "Current" is today's identity, but "Normal next" and "Selected" describe
  // the season being decided, so they are resolved through the canonical
  // season-aware projection rather than showing a team's present label.
  const playerTeamIdentities = currentRollover
    ? await loadTeamIdentitiesForSeason(
        supabase,
        (playerProposalRows ?? []).flatMap((p) =>
          [p.proposed_team_id, p.selected_team_id]
            .filter((id): id is string => Boolean(id))
            .map((teamId) => ({ teamId, seasonId: currentRollover.to_season_id as string }))
        )
      )
    : new Map()

  const nextSeasonLabel = (teamId: string | null, fallback: string | null): string | null => {
    if (!teamId || !currentRollover?.to_season_id) return fallback
    return playerTeamIdentities.get(teamIdentityKey(teamId, currentRollover.to_season_id))?.displayName ?? fallback
  }

  const playerProposals: PlayerProposalRow[] = (playerProposalRows ?? [])
    .map((p) => ({
      proposalId: p.id,
      playerId: p.player_id,
      playerName: [p.players?.first_name, p.players?.surname].filter(Boolean).join(" ") || "Player",
      currentTeamName: p.current_team?.display_name ?? "Unknown team",
      normalPlacementName: nextSeasonLabel(p.proposed_team_id, p.proposed_team?.display_name ?? null),
      selectedPlacementName: nextSeasonLabel(p.selected_team_id, p.selected_team?.display_name ?? null),
      regulatoryAgeLabel: p.regulatory_age_label,
      reviewState: p.review_state as PlayerProposalRow["reviewState"],
      allocationStatus: p.allocation_status,
      movementRequirement: p.movement_requirement,
      dispensationRequired: p.movement_requirement === "external_approval_required",
      reason: p.reason,
      placementApplied: p.placement_applied_at !== null,
      // The club runs no team at the age grade this player belongs in, so the
      // board can offer to run one rather than dead-ending.
      normalTeamMissing: p.proposed_team === null && p.normal_canonical_team_type_id !== null,
      plannedTeamName: p.planned_team_id ? (plannedLabelById.get(p.planned_team_id) ?? null) : null,
      placementChosen: p.selected_at !== null,
    }))
    .sort((a, b) => {
      const rank = (r: PlayerProposalRow) => (r.reviewState === "READY" ? 1 : 0)
      return rank(a) - rank(b) || a.playerName.localeCompare(b.playerName)
    })

  const batches: RolloverBatch[] = (rollovers ?? []).map((r) => ({
    id: r.id,
    fromSeasonName: r.from_season?.name ?? null,
    toSeasonName: r.to_season?.name ?? "—",
    createdAt: r.created_at,
    isApplied: r.applied_at !== null,
    proposals: r.age_grade_rollover_team_proposals.map((p) => ({
      id: p.id,
      teamId: p.team_id,
      teamDisplayName:
        (r.from_season_id && rolloverTeamIdentities.get(teamIdentityKey(p.team_id, r.from_season_id))?.displayName) || p.teams?.display_name || "Unknown team",
      teamGender: (p.teams?.gender ?? null) as RolloverBatch["proposals"][number]["teamGender"],
      teamSquadDesignation: p.teams?.squad_designation ?? null,
      currentAgeGroup: p.current_age_group,
      proposedAgeGroup: p.proposed_age_group,
      requiresManualChoice: p.requires_manual_choice,
      isMixedBoundary: p.is_mixed_boundary,
      decision: p.decision as RolloverBatch["proposals"][number]["decision"],
      decidedAgeGroup: p.decided_age_group,
      girlsTeamCreated: p.girls_team_created,
      createGirlsTeam: p.create_girls_team,
      foldReason: p.fold_reason,
      applied: p.applied_at !== null,
    })),
    groupFlags: r.age_grade_rollover_group_flags.map((f) => ({
      id: f.id,
      displayTag: f.scheduling_groups?.display_tag ?? "Mini-Rugby Group",
      reason: f.reason,
      resolved: f.resolved,
    })),
  }))

  const STATE_WORDS: Record<string, string> = {
    PREPARING: "Preparing",
    REVIEW_REQUIRED: "Review required",
    READY: "Ready to apply",
    APPLYING: "Applying",
    COMPLETED: "Completed",
  }

  const plannedResolved = (plannedTeamRows ?? [])
    .filter((p) => p.origin === "PLAYER_PLACEMENT")
    .map((p) => ({
      label: `${p.canonical_team_types?.label ?? "Team"}${p.squad_designation ? ` ${p.squad_designation}` : ""}`,
      note: p.applied_at
        ? "Created by this handover."
        : "Will be created when this handover is applied, and the players waiting on it join then.",
    }))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <CalendarSync className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Season handover</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="text-ink">
          {currentSeasonRows?.name ?? "This season"} <span className="text-ink/40">&rarr;</span>{" "}
          {nextSeasonOption?.name ?? "next season"}
        </span>
        <span className="rounded-md bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink/70">{STATE_WORDS[handoverState] ?? handoverState}</span>
        {nextSeasonRaw?.pre_season_starts_on && (
          <span className="text-ink/55">
            Runs from{" "}
            {new Date(nextSeasonRaw.pre_season_starts_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Review what {club.club_directory?.name}&apos;s teams and players become next season. Nothing about your club changes
        until you apply the handover — every decision here can be changed until then. Season dates come from Site Admin →
        Seasons.
      </p>
      {readiness && (
        <p className="mt-1.5 text-sm text-ink/55">
          {readiness.teams_total} team{readiness.teams_total === 1 ? "" : "s"} · {readiness.players_total} player
          {readiness.players_total === 1 ? "" : "s"} · {readiness.blocker_count} decision
          {readiness.blocker_count === 1 ? "" : "s"} needed
          {readiness.dispensations_pending > 0 && ` · ${readiness.dispensations_pending} awaiting governing approval`}
        </p>
      )}

      <ClubSettingsNav active="rollover" {...navCaps} />
      <HandoverNav active={section} attentionCount={blockers.length} />

      <div className="mt-8 space-y-6">
        {section === "overview" && (
          <HandoverOverview
            consequences={consequences}
            counts={{
              teamsTotal: readiness?.teams_total ?? 0,
              teamsPending: readiness?.teams_pending ?? 0,
              playersTotal: readiness?.players_total ?? 0,
              playersNeedingAttention: (readiness?.players_needs_attention ?? 0) + (readiness?.players_blocked ?? 0),
              dispensationsPending: readiness?.dispensations_pending ?? 0,
              playersClubHolding: readiness?.players_club_holding ?? 0,
            }}
            toSeasonName={nextSeasonOption?.name ?? null}
            isApplied={readiness?.is_applied ?? false}
          />
        )}

        {section === "teams" && (
          <>
            <RolloverReview
              clubId={club.id}
              rugbyCode={rugbyCode}
              toSeasonOptions={toSeasonOptions}
              batches={batches}
              currentSeasonName={currentSeasonRows?.name ?? null}
            />
            <MiniRugbyNextSeasonReview
              toSeasonId={nextSeasonOption?.id ?? null}
              toSeasonName={nextSeasonOption?.name ?? null}
              groups={miniRugbyGroups}
            />
          </>
        )}

        {section === "players" && (
          <>
            <PlayerHandoverProposals rows={playerProposals} toSeasonName={nextSeasonOption?.name ?? null} />
            <GraduationQueue rows={graduationQueueRows} targetTeams={graduationTargetTeams} />
          </>
        )}

        {section === "attention" && <HandoverNeedsAttention blockers={blockers} planned={plannedResolved} />}

        {section === "apply" && (
          <HandoverApply
            rolloverId={currentRollover?.id ?? null}
            toSeasonName={nextSeasonOption?.name ?? null}
            decisionsRevision={currentRollover?.decisions_revision ?? 0}
            isApplied={currentRollover?.applied_at !== null && currentRollover?.applied_at !== undefined}
            appliedAt={currentRollover?.applied_at ?? null}
            blockerCount={blockers.length}
            consequences={consequences}
            audit={audit}
            canApply={navCaps.canRollover}
          />
        )}
      </div>
    </div>
  )
}
