import "server-only"

import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { User } from "@supabase/supabase-js"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import type { Database } from "@/types/database.types"

import { isActiveFixtureAuthority } from "./fixture-authority-rule"

/**
 * SECURITY FIX, shared by every caller of update_fixture_pitch /
 * update_fixture_kickoff / update_fixture_venue / submit_fixture_result /
 * reject_fixture_kickoff_change / update_fixture_competition (found live
 * during Calendar Pitch Allocation's canonical-mutation-service audit,
 * fixed at the user's explicit request even though the affected callers
 * belong to Fixture Management/Messages, not Pitch Allocation).
 *
 * Those RPCs' own DB-level authorization is `can_submit_fixture_result(
 * fixture_id) OR is_site_admin()` -- and is_site_admin() is ACCOUNT-held,
 * not active-context-aware (RLS/RPCs cannot see the active-context cookie
 * at all -- the same architectural fact this session already applied to
 * every /admin/* route). The callers of these RPCs had NO application-
 * layer active-context check at all, so an account that is ALSO a Site
 * Admin, while ACTIVELY operating as an unrelated club, could edit ANY
 * club's fixture through the ordinary club-side Fixture Detail page --
 * live-reproduced this pass.
 *
 * A Site Admin's bypass is honoured ONLY while genuinely active as Site
 * Admin; otherwise the caller must be operating as one of the fixture's
 * own two sides (club or team) -- matching admin/fixtures/[fixtureId]/
 * page.tsx's own isInvolvedClub dual-access model, but ACTIVE-context-
 * scoped here because this guards a WRITE, not a read.
 */
export async function requireActiveFixtureAuthority(
  supabase: SupabaseClient<Database>,
  user: User,
  fixtureId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: fixture } = await supabase
    .from("fixtures")
    .select("owning_team_id, opponent_team_id, teams!fixtures_owning_team_id_fkey(club_id), opponent:teams!fixtures_opponent_team_id_fkey(club_id)")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!fixture) return { ok: false, error: "Fixture not found." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  const involvedClubIds = [fixture.teams?.club_id, fixture.opponent?.club_id].filter((id): id is string => Boolean(id))
  const involvedTeamIds = [fixture.owning_team_id, fixture.opponent_team_id].filter((id): id is string => Boolean(id))

  if (!isActiveFixtureAuthority(ctx, activeContext, { involvedClubIds, involvedTeamIds })) {
    return { ok: false, error: "You must be operating as this fixture's own club or team (or as an active Site Admin) to change it." }
  }
  return { ok: true }
}
