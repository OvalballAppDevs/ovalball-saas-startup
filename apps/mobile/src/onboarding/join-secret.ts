import type { InvitationSecret } from "@ovalball/contracts/invitations"

/**
 * AN INVITATION'S SECRET, HELD IN MEMORY AND NOWHERE ELSE.
 *
 * A person taps an invitation link while signed out. The link must survive signing in -- otherwise
 * they authenticate and land on Home wondering where the invitation went -- but the token in it is a
 * credential for a grant, and a credential is not written to disk. So it is held here, in process
 * memory, for the length of one journey: taken once by the invitation screen, discarded on sign-out.
 *
 * Nothing here logs, persists or transmits the value. The only place it goes is `preview_invitation`
 * and the redemption operation, which hash it on arrival.
 */
let held: InvitationSecret | null = null

export function holdJoinSecret(secret: InvitationSecret): void {
  const token = secret.token?.trim() || null
  const code = secret.code?.trim() || null
  held = token || code ? { token, code } : null
}

/** Read without consuming: the screen shows a preview before anyone decides anything. */
export function peekJoinSecret(): InvitationSecret | null {
  return held
}

export function hasJoinSecret(): boolean {
  return held !== null
}

export function discardJoinSecret(): void {
  held = null
}
