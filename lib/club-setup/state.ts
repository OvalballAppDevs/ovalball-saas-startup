import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Club first-run activation state.
 *
 * The lifecycle owns ONE thing: how far setup has got. Every requirement is
 * re-derived from canonical data by `club_setup_requirements` on each read,
 * so this module never caches a "step 2 is done" that could outlive the
 * venue it was based on.
 */
export type ClubSetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"

export interface ClubSetupRequirements {
  hasLogo: boolean
  hasPrimaryKit: boolean
  hasDefaultVenue: boolean
  defaultVenueHasAddress: boolean
  defaultVenueHasPitch: boolean
  teamsConfirmed: boolean
  step1Complete: boolean
  step2Complete: boolean
  step3Complete: boolean
}

export interface ClubSetupState {
  status: ClubSetupStatus
  /** Furthest step reached. A resume position, never a completion proof. */
  currentStep: number
  requirements: ClubSetupRequirements
}

/**
 * Paths that stay reachable while a club is gated.
 *
 * The gate stops an unfinished club being OPERATED -- fixtures, calendar,
 * messaging, people -- not being CONFIGURED. Everything the wizard asks for
 * lives in Club Settings and Team Administration, and the wizard links
 * straight into both, so gating those would send someone from the wizard to
 * a page that bounces them back to the wizard.
 *
 * Being told to finish setup must also never mean being unable to sign out,
 * ask for help, or switch to a different club -- hence account, support and
 * auth. `/club/setup` is here for the obvious reason: gating a path to
 * itself is how redirect loops happen.
 */
export const SETUP_ALLOWED_PREFIXES = [
  "/club",
  "/teams",
  "/account",
  "/support",
  "/welcome",
  "/auth",
]

/**
 * The two paths under `/club` that are operations wearing a settings URL.
 *
 * `/club` is allowed as a whole so the Club Settings tab strip works during
 * setup and so a tab added later does not silently start bouncing. These
 * two are scheduling surfaces that happen to live there, and running
 * training at a club with no confirmed teams is exactly what the gate
 * exists to prevent.
 */
const SETUP_BLOCKED_PREFIXES = ["/club/training", "/club/calendar"]

export function isSetupAllowedPath(pathname: string): boolean {
  if (SETUP_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false
  }
  return SETUP_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Reads a club's setup state, or null when the club has none.
 *
 * Null is not "incomplete": clubs that pre-date the lifecycle were
 * grandfathered as COMPLETED, and a genuinely missing row means the caller
 * cannot see the club. Callers treat null as "do not gate".
 */
export async function getClubSetupState(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubSetupState | null> {
  const [{ data: stateRow }, { data: reqRows }] = await Promise.all([
    supabase.from("club_setup_state").select("status, current_step").eq("club_id", clubId).maybeSingle(),
    supabase.rpc("club_setup_requirements", { p_club_id: clubId }),
  ])

  if (!stateRow) return null

  const r = reqRows?.[0]
  const requirements: ClubSetupRequirements = {
    hasLogo: r?.has_logo ?? false,
    hasPrimaryKit: r?.has_primary_kit ?? false,
    hasDefaultVenue: r?.has_default_venue ?? false,
    defaultVenueHasAddress: r?.default_venue_has_address ?? false,
    defaultVenueHasPitch: r?.default_venue_has_pitch ?? false,
    teamsConfirmed: r?.teams_confirmed ?? false,
    step1Complete: r?.step1_complete ?? false,
    step2Complete: r?.step2_complete ?? false,
    step3Complete: r?.step3_complete ?? false,
  }

  return {
    status: (stateRow.status as ClubSetupStatus) ?? "NOT_STARTED",
    currentStep: stateRow.current_step ?? 1,
    requirements,
  }
}

/**
 * The first step that is not finished -- where a returning Club Admin
 * resumes. Derived from requirements rather than from the stored step, so
 * closing the browser on step 3 and having a venue deactivated meanwhile
 * returns them to step 2 rather than to a step they can no longer pass.
 */
export function resumeStep(requirements: ClubSetupRequirements): 1 | 2 | 3 {
  if (!requirements.step1Complete) return 1
  if (!requirements.step2Complete) return 2
  return 3
}
