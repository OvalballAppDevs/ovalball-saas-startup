import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { CalendarSync } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../settings/club-settings-nav"
import { AutomaticHandoverStatus, type HandoverGroupFlag, type HandoverReviewTeam } from "./automatic-handover-status"
import { GraduationQueue, type GraduationQueueRow, type GraduationTargetTeamOption } from "./graduation-queue"
import { MiniRugbyNextSeasonReview, type MiniRugbyGroupRow } from "./mini-rugby-next-season"
import { RolloverReview, type RolloverBatch, type SeasonOption } from "./rollover-review"

/**
 * Club Admin age-grade rollover review (20260902150000). Nothing here
 * mutates a real team -- generate_rollover_proposal only ever writes to
 * age_grade_rollover_team_proposals/age_grade_rollover_group_flags, and
 * confirm_rollover_team_proposal (called per row from RolloverReview) is
 * the only path that applies a change, one team at a time.
 */
export default async function ClubRolloverPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)
  // Scoped to the ACTIVE context, not "any CLUB_ADMIN membership this
  // session holds" -- see app/(app)/people/page.tsx for the identical,
  // live-confirmed leak this mirrors (Parent View could see and confirm a
  // completely different club's rollover proposals). Season Rollover
  // Permission addendum: authorization now derives from the canonical
  // capability engine (club.season_rollover.manage) rather than a raw
  // role comparison, so a Site Admin grant/deny override for this
  // specific club-scoped capability correctly changes what this page
  // allows.
  const [canRunRollover, canEditProfile, canVenues, canPitches, canPlayerMoves, canGuardians, canSubscriptionConfigure, canSubscriptionViewFinance] = activeClub
    ? await Promise.all([
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.edit_profile", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.guardians.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.subscription.configure", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.subscription.view_finance", "club", { clubId: activeClub }),
      ])
    : [false, false, false, false, false, false, false, false]
  if (!canRunRollover || !activeClub) redirect("/dashboard")
  // profile/pitches/guardians/subscriptions only computed for the shared tab strip's accuracy -- see club-settings-nav.tsx.
  const canTeamsForNav = canEditProfile || canPitches
  const canSubscriptions = canSubscriptionConfigure || canSubscriptionViewFinance

  const { data: club } = await supabase
    .from("clubs")
    .select("id, club_directory(rugby_code, name)")
    .eq("id", activeClub)
    .maybeSingle()
  if (!club) redirect("/dashboard")

  const rugbyCode = (club.club_directory?.rugby_code ?? "union") as "union" | "league"
  const todayIso = new Date().toISOString().slice(0, 10)

  const [{ data: seasons }, { data: currentSeasonRows }, { data: rollovers }] = await Promise.all([
    // is_regression_fixture rows (SQL-regression-test scaffolding) are
    // excluded so a Club Admin can never accidentally roll a real club
    // forward onto a synthetic test season -- same convention as
    // app/(app)/admin/competitions/page.tsx's own season dropdown.
    supabase
      .from("seasons")
      .select("id, name, starts_on, pre_season_starts_on, season_ref")
      .eq("rugby_code", rugbyCode)
      .eq("is_regression_fixture", false)
      .gte("starts_on", todayIso)
      .order("starts_on"),
    // Same canonical `seasons` table the "next season" query above reads --
    // just the row containing today, so the empty state can name it
    // explicitly ("the season after X") instead of a bare "no season yet"
    // that reads as broken when a current season plainly exists elsewhere
    // in the app (Calendar). Never a second season concept.
    supabase.from("seasons").select("id, name").eq("rugby_code", rugbyCode).eq("is_regression_fixture", false).lte("starts_on", todayIso).gte("ends_on", todayIso).limit(1).maybeSingle(),
    supabase
      .from("age_grade_rollovers")
      .select(
        "id, created_at, from_season_id, from_season:from_season_id(name), to_season:to_season_id(name), age_grade_rollover_team_proposals(id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary, decision, decided_age_group, girls_team_created, girls_team_id, teams!age_grade_rollover_team_proposals_team_id_fkey(display_name, gender, squad_designation)), age_grade_rollover_group_flags(id, scheduling_group_id, reason, resolved, scheduling_groups(display_tag))"
      )
      .eq("club_id", club.id)
      // Defence in depth: generate_rollover_proposal now rejects a
      // mismatched rugby_code server-side (20260925070000), but this
      // page must never display a wrong-code batch even if one somehow
      // exists (as a real, since-cleaned-up Burnley row once did).
      .eq("rugby_code", rugbyCode)
      .order("created_at", { ascending: false }),
  ])

  const toSeasonOptions: SeasonOption[] = (seasons ?? []).map((s) => ({ id: s.id, name: s.name }))
  const nextSeasonOption = toSeasonOptions[0] ?? null
  const nextSeasonRaw = seasons?.[0] ?? null

  // The engine only creates a season_transitions row once it's within
  // its 24h lookahead window -- most of the season, there is genuinely
  // no row yet, and that is the correct "not_due" state, not an error.
  // Fetched as two flat queries rather than one deep nested select --
  // the nested-join select shape here made the Supabase client's
  // inferred type too deep for TypeScript to resolve.
  const { data: transitionRow } = nextSeasonOption
    ? await supabase
        .from("season_transitions")
        .select("status, needs_attention_reason, rollover_id")
        .eq("club_id", club.id)
        .eq("rugby_code", rugbyCode)
        .eq("to_season_id", nextSeasonOption.id)
        .maybeSingle()
    : { data: null }

  const [{ data: proposalRows }, { data: groupFlagRows }, { count: graduatingPendingCount }] = await Promise.all([
    transitionRow?.rollover_id
      ? supabase
          .from("age_grade_rollover_team_proposals")
          .select("decision, requires_manual_choice, current_age_group, proposed_age_group, decided_age_group, teams!age_grade_rollover_team_proposals_team_id_fkey(display_name)")
          .eq("rollover_id", transitionRow.rollover_id)
      : Promise.resolve({ data: null }),
    transitionRow?.rollover_id
      ? supabase
          .from("age_grade_rollover_group_flags")
          .select("reason, resolved, scheduling_groups(display_tag)")
          .eq("rollover_id", transitionRow.rollover_id)
      : Promise.resolve({ data: null }),
    supabase.from("player_graduation_queue").select("id", { count: "exact", head: true }).eq("club_id", club.id).eq("status", "pending_placement"),
  ])

  const handoverStatus: "not_due" | "prepared" | "ready" | "applying" | "needs_attention" | "completed" =
    (transitionRow?.status as "prepared" | "ready" | "applying" | "needs_attention" | "completed" | undefined) ?? "not_due"
  const handoverProgressingTeams: HandoverReviewTeam[] = (proposalRows ?? [])
    .filter((p) => p.decision === "confirmed" && !p.requires_manual_choice)
    .map((p) => ({
      displayName: p.teams?.display_name ?? "Unknown team",
      fromAgeGroup: p.current_age_group,
      toAgeGroup: p.decided_age_group ?? p.proposed_age_group,
      needsDecision: false,
    }))
  const handoverDecisionTeams: HandoverReviewTeam[] = (proposalRows ?? [])
    .filter((p) => p.decision === "pending" || p.requires_manual_choice)
    .map((p) => ({
      displayName: p.teams?.display_name ?? "Unknown team",
      fromAgeGroup: p.current_age_group,
      toAgeGroup: p.proposed_age_group,
      needsDecision: true,
    }))
  const handoverGroupFlags: HandoverGroupFlag[] = (groupFlagRows ?? [])
    .filter((f) => !f.resolved)
    .map((f) => ({ displayTag: f.scheduling_groups?.display_tag ?? "Mini-Rugby Group", reason: f.reason }))

  // Section 21-22: the graduation queue itself, and every ACTIVE team
  // at this club as a placement destination -- place_graduating_player
  // itself is the real gate (club match, capability, DOB/dispensation
  // for a senior team), this list is deliberately unfiltered by
  // category so a Club Admin can place a graduate onto colts or senior
  // as appropriate, never guessing at eligibility client-side.
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

  // Active Mini-Rugby Groups for THIS club's CURRENT season only -- a
  // group already scoped to a future season (from an earlier run of
  // this same wizard) is deliberately excluded here, it appears via
  // alreadyCreatedTag below instead.
  let miniRugbyGroups: MiniRugbyGroupRow[] = []
  if (currentSeasonRows) {
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

    // A team already sitting in ANY group scoped to the next season
    // means this historical group has already been progressed (by this
    // wizard, possibly with an edited team set) -- render that outcome
    // instead of offering to create a duplicate.
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

  // A past batch's own proposals recorded what each team's identity WAS
  // at that batch's from_season -- a team renamed/re-aged in a LATER
  // rollover must not retroactively relabel an older batch's history,
  // so resolve each proposal's team label for that batch's own
  // from_season_id rather than reading the team's current live row.
  const rolloverIdentityPairs = (rollovers ?? []).flatMap((r) =>
    r.from_season_id ? r.age_grade_rollover_team_proposals.map((p) => ({ teamId: p.team_id, seasonId: r.from_season_id as string })) : []
  )
  const rolloverTeamIdentities = await loadTeamIdentitiesForSeason(supabase, rolloverIdentityPairs)

  const batches: RolloverBatch[] = (rollovers ?? []).map((r) => ({
    id: r.id,
    fromSeasonName: r.from_season?.name ?? null,
    toSeasonName: r.to_season?.name ?? "—",
    createdAt: r.created_at,
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
    })),
    groupFlags: r.age_grade_rollover_group_flags.map((f) => ({
      id: f.id,
      displayTag: f.scheduling_groups?.display_tag ?? "Mini-Rugby Group",
      reason: f.reason,
      resolved: f.resolved,
    })),
  }))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <CalendarSync className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Season rollover</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Review how {club.club_directory?.name}&apos;s age-grade teams should move up for next season. Nothing
        changes until you confirm each team individually below.
      </p>

      <ClubSettingsNav active="rollover" canProfile={canEditProfile} canTeams={canTeamsForNav} canVenues={canVenues} canRollover={canRunRollover} canPlayerMoves={canPlayerMoves} canGuardians={canGuardians} canSubscriptions={canSubscriptions} />

      <div className="mt-8 space-y-6">
        {nextSeasonOption && (
          <AutomaticHandoverStatus
            fromSeasonName={currentSeasonRows?.name ?? null}
            toSeasonName={nextSeasonOption.name}
            toSeasonRef={nextSeasonRaw?.season_ref ?? nextSeasonOption.name}
            status={handoverStatus}
            boundaryDate={nextSeasonRaw?.pre_season_starts_on ?? null}
            needsAttentionReason={transitionRow?.needs_attention_reason ?? null}
            progressingTeams={handoverProgressingTeams}
            decisionTeams={handoverDecisionTeams}
            groupFlags={handoverGroupFlags}
            graduatingPendingCount={graduatingPendingCount ?? 0}
          />
        )}
        <RolloverReview
          clubId={club.id}
          rugbyCode={rugbyCode}
          toSeasonOptions={toSeasonOptions}
          batches={batches}
          currentSeasonName={currentSeasonRows?.name ?? null}
        />
        <MiniRugbyNextSeasonReview toSeasonId={nextSeasonOption?.id ?? null} toSeasonName={nextSeasonOption?.name ?? null} groups={miniRugbyGroups} />
        <GraduationQueue rows={graduationQueueRows} targetTeams={graduationTargetTeams} />
      </div>
    </div>
  )
}
