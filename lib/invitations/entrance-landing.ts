import type { SuccessfulRedemptionOutcome } from "./redeem"

/**
 * WHERE AN ACCEPTED INVITATION LEAVES SOMEBODY, AND WHICH CONTEXT THEY ARRIVE IN.
 *
 * This used to be a seven-entry `Record<string, string>` inside `app/join/join-panel.tsx`, and being
 * inside a client component is how it went wrong: Step 16 added an eighth outcome, `BODY_ROLE_ACTIVE`,
 * and nothing in the type system connected the two, so a newly appointed Competitions Officer fell
 * through the map's `?? "/dashboard"` fallback into a club dashboard -- the precise thing UX-8 §22
 * forbids.
 *
 * Two things are therefore deliberate here.
 *
 * **It is exhaustive by construction.** The map is keyed by `SuccessfulRedemptionOutcome`, so adding an
 * outcome without deciding where it lands does not compile. That is the only mechanism that actually
 * prevents this defect recurring; a comment asking the next person to remember does not.
 *
 * **It is pure domain logic, not UI.** UX-8 §33 is explicit that business meaning must not live only
 * inside Next.js components, because a future mobile client would have to reproduce it. Landing is a
 * property of the relationship that was just established, so it is answered from the redemption's own
 * result and nothing else -- no router, no cookies, no `window`. The caller performs the navigation.
 */

/** A context the shell can be switched to, in the key format `listSwitchableContexts` produces. */
export type EntranceContextKey = string

export type EntranceLanding = {
  /** Where to send them. Always an in-application path. */
  href: string
  /**
   * The context to make active first, when acceptance established a NEW one.
   *
   * Navigating alone is not enough: the active context resolves from the `ovalball_ctx` cookie and not
   * from the URL, so somebody who accepts a governing-body invitation and is merely *sent* to the
   * workspace arrives with their club's navigation still wrapped around it. Measured during the Step 18
   * hardening pass, where a probe that navigated by URL turned out to have been reading the club bar all
   * along. `null` means "leave whatever they had" -- which is right for every outcome that did not
   * create a new place to stand.
   */
  contextKey: EntranceContextKey | null
  /**
   * One sentence for the person, in the product's own words, describing what just happened.
   *
   * `null` where the destination speaks for itself. Where the outcome is a *request* rather than an
   * access grant this is never optional, because UX-8 §16 requires pending to read as pending, and a
   * silent redirect to a dashboard reads as success.
   */
  note: string | null
}

/** Ovalball's canonical authenticated entry point, for outcomes with no more specific home. */
const HOME = "/dashboard"

/**
 * The truthful home for a request that has been made and not yet answered. `/welcome` reads canonical
 * pending state through `getPendingStatus` -- the person's own claim, join request or directory request
 * -- so it cannot claim an access they have not been given.
 */
const PENDING = "/welcome"

export function entranceLanding(
  outcome: SuccessfulRedemptionOutcome,
  detail: Record<string, unknown>,
): EntranceLanding {
  switch (outcome) {
    // A club relationship that is live now. The club surfaces resolve their own context from the
    // membership, so no context key is forced.
    case "MEMBERSHIP_ACTIVE":
      return { href: HOME, contextKey: null, note: null }

    // A role assignment that somebody else still has to confirm. Not access yet, and not described as
    // access.
    case "PENDING_CONFIRMATION":
      return {
        href: PENDING,
        contextKey: null,
        note: "Accepted. Your club still has to confirm your role before it starts.",
      }

    // Asked to join, awaiting a Club Admin. The old map sent this to /dashboard, which shows somebody
    // with no membership an application they cannot yet use and no explanation.
    case "JOIN_REQUEST_PENDING":
      return {
        href: PENDING,
        contextKey: null,
        note: "Request sent. You will get in once somebody at the club approves it.",
      }

    // THE OUTCOME THAT WAS MISSING. Step 16's governing-body invitation. The organisation is in the
    // redemption result, so the workspace is addressable and the context is nameable.
    case "BODY_ROLE_ACTIVE": {
      const bodyId = typeof detail.constituent_body_id === "string" ? detail.constituent_body_id : null
      if (!bodyId) return { href: HOME, contextKey: null, note: null }
      return {
        href: `/governing/${bodyId}`,
        contextKey: `governing:${bodyId}`,
        note: null,
      }
    }

    case "SITE_ADMIN_ACTIVE":
      return { href: "/admin", contextKey: "site_admin", note: null }

    // The account exists and is confirmed, but no relationship came with it -- so the useful next screen
    // is the one that asks what they are here for, not an empty dashboard.
    case "ACCOUNT_SETUP_CONFIRMED":
      return { href: "/account", contextKey: null, note: null }

    case "ACCEPTED":
      return { href: HOME, contextKey: null, note: null }

    // Idempotent, and it must stay that way: following the same link twice is something people do, and
    // it is not an error. They already have whatever it gave them.
    case "ALREADY_REDEEMED":
      return {
        href: HOME,
        contextKey: null,
        note: "You had already accepted that invitation, so there was nothing left to do.",
      }
  }
}
