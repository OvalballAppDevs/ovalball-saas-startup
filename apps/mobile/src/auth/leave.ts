import { forgetSelectedContext } from "../context/contexts"
import { forgetSelectedChild } from "../family/selection"
import { clearAllDrafts } from "../messages/drafts"
import { forgetHubTeamPreference } from "../hub/identity"
import { forgetRecentSearches } from "../hub/recent"
import { forgetHubCache } from "../hub/cache"
import { forgetHubExplanations } from "../hub/experience/explain"
import { forgetAttentionCache } from "../attention/cache"
import { discardIntents } from "../admin/pending-intent"
import { discardJoinSecret } from "../onboarding/join-secret"

/**
 * LEAVING IS ONE LIST, KEPT IN ONE PLACE (CA-M11).
 *
 * Signing out on a shared handset must leave nothing of this person for the next: not the team they
 * stood in, not the child they had chosen, not a half-typed message, not an attention list, not a
 * Rugby Hub search, not a change they were about to confirm, and not an invitation they were holding.
 * The session itself is cleared by the auth library; everything else is cleared here, before it.
 *
 * `keepInvitation` is the one deliberate exception: somebody signed in as the wrong account for an
 * invitation signs out IN ORDER TO come back to it, so the held secret (memory only) survives that one
 * sign-out and is discarded when the journey ends.
 */
export async function leaveSession(signOut: () => Promise<void>, options: { keepInvitation?: boolean } = {}): Promise<void> {
  discardIntents()
  if (!options.keepInvitation) discardJoinSecret()
  await forgetSelectedContext()
  await forgetSelectedChild()
  await clearAllDrafts()
  await forgetHubTeamPreference()
  await forgetRecentSearches()
  forgetHubCache()
  forgetHubExplanations()
  forgetAttentionCache()
  await signOut()
}
