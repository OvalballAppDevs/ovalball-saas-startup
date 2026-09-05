/**
 * The explicit Club Subscriptions state machine. The `enabled` checkbox
 * on club_subscription_programmes is deliberately NOT the same thing as
 * "this club can collect money right now" -- this function is the one
 * place that gap is resolved into a single, unambiguous state for the
 * Club Settings UI to render.
 */
export type SubscriptionState = "DISABLED" | "SETUP_REQUIRED" | "GOCARDLESS_NOT_CONNECTED" | "CONNECTED_UNVERIFIED" | "CONNECTED_VERIFIED" | "READY_FOR_ENROLMENT" | "ACTIVE" | "PAUSED" | "ACTION_REQUIRED"

export function resolveSubscriptionState(input: {
  enabled: boolean
  hasPricing: boolean
  gocardlessConnected: boolean
  gocardlessVerificationStatus: "action_required" | "in_review" | "successful" | "unknown" | null
  activeSubscriptionCount: number
}): SubscriptionState {
  if (!input.enabled) return "DISABLED"
  if (!input.hasPricing) return "SETUP_REQUIRED"
  if (!input.gocardlessConnected) return "GOCARDLESS_NOT_CONNECTED"
  if (input.gocardlessVerificationStatus === "action_required" || input.gocardlessVerificationStatus === "unknown") return "ACTION_REQUIRED"
  if (input.gocardlessVerificationStatus === "in_review") return "CONNECTED_UNVERIFIED"
  // gocardlessVerificationStatus === "successful" from here on.
  if (input.activeSubscriptionCount > 0) return "ACTIVE"
  return "READY_FOR_ENROLMENT"
}

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionState, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  DISABLED: { label: "Disabled", tone: "neutral" },
  SETUP_REQUIRED: { label: "Setup required", tone: "warning" },
  GOCARDLESS_NOT_CONNECTED: { label: "GoCardless not connected", tone: "warning" },
  CONNECTED_UNVERIFIED: { label: "Connected, verification pending", tone: "info" },
  CONNECTED_VERIFIED: { label: "Connected", tone: "info" },
  READY_FOR_ENROLMENT: { label: "Ready for enrolment", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "neutral" },
  ACTION_REQUIRED: { label: "Action required", tone: "danger" },
}
