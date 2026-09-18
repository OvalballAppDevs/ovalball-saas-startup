import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * A CLUB'S SAFEGUARDING OFFICER APPOINTMENTS, FROM THE STATE MACHINE THAT OWNS THEM.
 *
 * There are two safeguarding records and they answer different questions, which
 * is how one screen came to say a club had no Safeguarding Officer while another
 * captioned somebody as being one.
 *
 * `public.club_safeguarding_officers` is a CONTACT register: a name and an email
 * a club publishes, reachable through `get_club_safeguarding_officers`. It is
 * written by the invite-an-outsider path.
 *
 * `public.role_assignments` is the APPOINTMENT -- the 4G state machine. A
 * nomination of an existing member enters it through
 * `internal.enter_safeguarding_nomination` with
 * `confirmation_state = 'PENDING_CONFIRMATION'`, confers nothing, and becomes an
 * appointment only when Ovalball confirms it (AN-6, `confirm_safeguarding_officer`,
 * which takes the ASSIGNMENT id -- the clearest evidence of which record is
 * canonical). It writes no contact row, so a page reading only the register was
 * blind to every nomination made this way.
 *
 * This is the one place the appointment is read for a club. It resolves nothing
 * and decides nothing: RLS on `role_assignments` decides who may see it, and the
 * confirmation state is reported exactly as stored. Adding a second reader would
 * recreate the disagreement it exists to end.
 */

export interface SafeguardingAppointment {
  assignmentId: string
  userId: string
  /** "primary" or "deputy", from the assignment's own attributes. */
  officerType: string
  /** PENDING_CONFIRMATION until Ovalball confirms it; CONFIRMED afterwards. */
  confirmationState: string | null
  /** ACTIVE or SUSPENDED -- a revoked appointment is not returned. */
  state: string
  grantedAt: string | null
  personName: string | null
  email: string | null
}

export async function resolveClubSafeguardingAppointments(
  supabase: SupabaseClient<Database>,
  clubId: string | null
): Promise<SafeguardingAppointment[]> {
  if (!clubId) return []

  const { data, error } = await supabase
    .from("role_assignments")
    .select("id, user_id, attributes, confirmation_state, state, granted_at")
    .eq("club_id", clubId)
    .eq("role_key", "SAFEGUARDING_OFFICER")
    .is("team_id", null)
    .in("state", ["ACTIVE", "SUSPENDED"])
    .order("granted_at")
  if (error || !data) return []

  // Names come from the club's own authorised directory, the same call the
  // people surfaces use -- never a direct profiles read, which returns only the
  // viewer's own row and would caption everybody else "Club member".
  const { data: directory } = await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
  const byUser = new Map((directory ?? []).map((p) => [p.user_id, p]))

  return data
    .filter((row): row is typeof row & { id: string; user_id: string } => Boolean(row.id && row.user_id))
    .map((row) => {
      const profile = byUser.get(row.user_id)
      const attributes = (row.attributes ?? {}) as { officer_type?: string }
      return {
        assignmentId: row.id,
        userId: row.user_id,
        officerType: attributes.officer_type ?? "primary",
        confirmationState: row.confirmation_state,
        state: row.state ?? "ACTIVE",
        grantedAt: row.granted_at,
        personName: [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || null,
        email: profile?.email ?? null,
      }
    })
}
