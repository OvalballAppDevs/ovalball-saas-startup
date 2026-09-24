/**
 * THE ONE LIST OF OPERATIONS THAT ASK FOR A REASON (owner decision CA-M1 / 4).
 *
 * The server is the authority: `internal.require_reason(p_reason, p_required)` inside each of these
 * public RPCs decides whether a reason is mandatory for THIS call, and refuses (22023, "Please give
 * a reason.") when it is missing. This list exists so that BOTH clients ask for a reason on the
 * same operations and neither carries a list of its own -- the website's screens used to name seven
 * and the mobile map counted eleven; the truth was twelve. `supabase/tests/club_profile_domain_operation.sql`
 * asserts this list equals the set of public functions whose body calls require_reason, so it
 * cannot drift from the server.
 *
 * `when` records the server's own condition, in words, for the client's copy: "always" means the
 * server always requires one; the others are conditional and a client should still OFFER the field.
 */
export interface ReasonRequiredOperation {
  rpc: string
  when: "always" | "conditional"
  /** The server's condition, quoted for the reader; the server still decides. */
  condition?: string
}

export const REASON_REQUIRED_OPERATIONS: ReasonRequiredOperation[] = [
  { rpc: "assign_role", when: "conditional", condition: "when acting with site-level authority" },
  { rpc: "change_membership_access_profile", when: "always" },
  { rpc: "decide_club_join_request", when: "conditional", condition: "when declining, or when acting with site-level authority" },
  { rpc: "grant_club_membership", when: "always" },
  { rpc: "move_player_team_membership", when: "conditional", condition: "optional; kept to 500 characters when given" },
  { rpc: "remove_team_access", when: "conditional", condition: "when acting with site-level authority" },
  { rpc: "revoke_invitation", when: "always" },
  { rpc: "set_primary_club_role", when: "conditional", condition: "when acting with site-level authority" },
  { rpc: "set_team_access", when: "conditional", condition: "when acting with site-level authority" },
  { rpc: "transition_club_membership", when: "conditional", condition: "always, except a person acting on their own membership" },
  { rpc: "transition_guardian_relationship", when: "conditional", condition: "always, except a guardian acting on their own relationship" },
  { rpc: "transition_role_assignment", when: "always" },
]

export const REASON_REQUIRED_RPCS: string[] = REASON_REQUIRED_OPERATIONS.map((o) => o.rpc)
