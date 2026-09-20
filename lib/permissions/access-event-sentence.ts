/**
 * AN ACCESS EVENT, IN A SENTENCE.
 *
 * `public.security_events` stores what happened as a dotted key -- `role.granted`,
 * `override.revoked`, `membership.suspended`. That is the right shape for a
 * stream that has to be queried, and the wrong shape for a Club Admin reading
 * their own club's history: "override.granted · fixture.fixture.cancel" is a
 * database row, not an account of what somebody did.
 *
 * This is presentation only. It decides nothing, it reads nothing, and an event
 * type it does not recognise falls back to the event's own key rather than to a
 * guess -- a timeline that invented a plausible sentence for an event it did
 * not understand would be worse than one that showed the key.
 *
 * The capability and role names shown are the human labels the canonical
 * catalogues already carry, passed in by the caller; this file holds no second
 * catalogue of its own.
 */

const SENTENCE: Record<string, (subject: string) => string> = {
  "role.granted": (what) => `Given the ${what} role`,
  "role.revoked": (what) => `${what} role removed`,
  "role.suspended": (what) => `${what} role suspended`,
  "role.restored": (what) => `${what} role restored`,
  "override.granted": (what) => `Allowed ${what}`,
  "override.revoked": (what) => `${what} reset to their role's answer`,
  "override.preset_applied": (what) => `Given the ${what} job`,
  "membership.granted": () => "Joined the club",
  "membership.approved": () => "Membership approved",
  "membership.requested": () => "Asked to join the club",
  "membership.suspended": () => "Membership suspended",
  "membership.revoked": () => "Removed from the club",
  "membership.restored": () => "Membership restored",
  "invitation.issued": () => "Sent an invitation",
  "invitation.resent": () => "Invitation sent again",
  "invitation.revoked": () => "Invitation withdrawn",
  "invitation.redeemed": () => "Invitation accepted",
  "team_access.granted": (what) => `Given team access: ${what}`,
  "team_access.revoked": (what) => `Team access removed: ${what}`,
  "player_team.added": (what) => `Added to ${what}`,
  "player_team.removed": (what) => `Removed from ${what}`,
  "guardian.linked": () => "Linked as a guardian",
  "guardian.unlinked": () => "Guardian link ended",
}

/**
 * The words for one timeline row.
 *
 * `capabilityKey` and `roleKey` are whichever of the two the event carried;
 * `teamName` is set when the event named a team. Whatever is present is what
 * the sentence is about.
 */
export function accessEventSentence(
  eventType: string,
  capabilityKey: string | null,
  roleKey: string | null,
  teamName: string | null
): string {
  const subject = capabilityKey ?? roleKey ?? teamName ?? ""
  const shape = SENTENCE[eventType]
  if (!shape) return eventType
  const sentence = shape(subject || "it")
  // A team-scoped decision says which team, once, and never twice.
  return teamName && !sentence.includes(teamName) ? `${sentence} — ${teamName}` : sentence
}
