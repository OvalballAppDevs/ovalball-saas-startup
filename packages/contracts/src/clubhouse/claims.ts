/**
 * CLUBHOUSE PROGRAMME SECTION 14: the exact allow-list `club_claims_claimed_role_eligible`
 * (`supabase/migrations/20260831190000_club_claims_add_treasurer.sql`) enforces at the database. The
 * one shared source for both clients' claim-submission forms -- a role list hand-duplicated in two
 * files is exactly how one of them would silently drift from what the database actually accepts,
 * surfacing as a raw check-constraint violation instead of a clear client-side message.
 */
export const CLAIMABLE_ROLES = [
  "Club Chair / Chairman / Chairperson",
  "Club Secretary",
  "Fixture Secretary",
  "Club Administrator",
  "Director of Rugby",
  "Committee Member",
  "Treasurer",
] as const

export type ClaimableRole = (typeof CLAIMABLE_ROLES)[number]
