import { entranceOutcome, type SuccessfulRedemptionOutcome } from "@ovalball/contracts/invitations"

/**
 * WHERE AN ACCEPTED INVITATION LANDS ON THE WEBSITE.
 *
 * The decision -- home, pending, the governing body, site admin, the account page, and the one
 * sentence worth saying -- is `entranceOutcome` in the shared package, keyed by the success union so a
 * new outcome cannot compile without a landing. This module only turns that decision into a web
 * address. The phone turns the same decision into its own routes.
 */
export type EntranceContextKey = string

export type EntranceLanding = {
  href: string
  contextKey: EntranceContextKey | null
  note: string | null
}

const HOME = "/dashboard"
const PENDING = "/welcome"

export function entranceLanding(outcome: SuccessfulRedemptionOutcome, detail: Record<string, unknown>): EntranceLanding {
  const decided = entranceOutcome(outcome, detail)
  switch (decided.landing) {
    case "HOME":
      return { href: HOME, contextKey: decided.contextKey, note: decided.note }
    case "PENDING":
      return { href: PENDING, contextKey: decided.contextKey, note: decided.note }
    case "GOVERNING":
      return { href: `/governing/${decided.bodyId}`, contextKey: decided.contextKey, note: decided.note }
    case "SITE_ADMIN":
      return { href: "/admin", contextKey: decided.contextKey, note: decided.note }
    case "ACCOUNT":
      return { href: "/account", contextKey: decided.contextKey, note: decided.note }
  }
}
