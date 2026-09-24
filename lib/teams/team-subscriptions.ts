import "server-only"

/**
 * Moved to `packages/contracts/src/team/subscriptions.ts` (CA-M7) and re-exported here.
 *
 * WHAT CHANGED WITH THE MOVE. The loader used to read `membership_obligations` and
 * `player_subscription_payers` directly under the caller's RLS -- and those policies admit
 * `finance.subscription.view` at CLUB scope only, so a Team Manager holding the TEAM-scoped view that
 * migration 20270531 gave them passed the page guard and was shown "No players in this team yet". It now
 * reads through `team_subscription_status`, the one server operation that enforces the team-scoped
 * sentence: operational state for the players of that team, and nothing else.
 */
export {
  loadTeamSubscriptions,
  resolveSubscriptionState,
  summariseTeamSubscriptions,
  currentBillingPeriod,
  SUBSCRIPTION_STATE_LABEL,
  type SubscriptionState,
  type TeamSubscriptionRow,
  type TeamSubscriptionSummary,
} from "@ovalball/contracts/team/subscriptions"
