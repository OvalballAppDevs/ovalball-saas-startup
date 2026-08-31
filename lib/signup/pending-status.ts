import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export type PendingStatus =
  | { kind: "no-request" }
  | { kind: "claim-pending"; clubName: string; role: string; status: string }
  | { kind: "join-pending"; clubName: string; role: string; status: string }
  | { kind: "directory-pending"; clubName: string; status: string }
  | { kind: "approved"; clubName: string; role: string }

/**
 * Reads the current user's own club-access status -- never anyone else's.
 * Every query here runs through the caller's authenticated client, so it is
 * bound by this session's RLS: the *_select_self policies (added alongside
 * the pending-access feature) only ever return this user's own rows, and
 * club_memberships_select_scoped only returns their own membership rows.
 * There is no service-role client anywhere in this file.
 */
export async function getPendingStatus(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<PendingStatus> {
  // An approved, active membership takes priority over any pending request
  // -- once approved, that's the real state regardless of what request led
  // there.
  const { data: membership } = await supabase
    .from("club_memberships")
    .select("role, clubs(directory_id, club_directory(name))")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (membership) {
    const clubName = membership.clubs?.club_directory?.name ?? "your club"
    return { kind: "approved", clubName, role: membership.role }
  }

  const { data: claim } = await supabase
    .from("club_claims")
    .select("status, claimed_role, club_directory(name)")
    .eq("claimant_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (claim) {
    return {
      kind: "claim-pending",
      clubName: claim.club_directory?.name ?? "your club",
      role: claim.claimed_role,
      status: claim.status,
    }
  }

  const { data: joinRequest } = await supabase
    .from("club_join_requests")
    .select("status, requested_role, clubs(club_directory(name))")
    .eq("requesting_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (joinRequest) {
    return {
      kind: "join-pending",
      clubName: joinRequest.clubs?.club_directory?.name ?? "your club",
      role: joinRequest.requested_role,
      status: joinRequest.status,
    }
  }

  const { data: directoryRequest } = await supabase
    .from("directory_requests")
    .select("status, club_name")
    .eq("submitted_by", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directoryRequest) {
    return {
      kind: "directory-pending",
      clubName: directoryRequest.club_name,
      status: directoryRequest.status,
    }
  }

  return { kind: "no-request" }
}
