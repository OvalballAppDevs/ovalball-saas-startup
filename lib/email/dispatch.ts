import "server-only"

import { renderEmailEvent, type EmailEvent } from "./events"

/**
 * Where due-diligence notifications (club_claim_submitted) go, distinct
 * from the per-user in-app notification every active Site Admin already
 * gets automatically (see the notify_site_admins_* triggers in
 * 20260831090000_role_vocabulary_and_claim_approval.sql). This is a single
 * named config value precisely so the address lives in one place --
 * `ovalballapp@gmail.com` is the value to set THIS variable to for
 * development, never a string hardcoded anywhere else in application logic.
 */
export function getSiteAdminNotificationEmail(): string | null {
  return process.env.SITE_ADMIN_NOTIFICATION_EMAIL ?? null
}

interface DispatchTarget {
  /** Explicit recipient (e.g. a claimant, an invitee). */
  to?: string
  /** Send to the configured Site Admin notification destination instead/also. */
  toSiteAdminInbox?: boolean
}

/**
 * The only function in the app that "sends" a transactional email. Today
 * it never actually sends anything -- no provider is configured this
 * session, and real mail must not go out during development (session
 * rule). It logs what would be sent, in the shape a real provider call
 * would need, so wiring Resend (or another provider) later is a change
 * inside this one function, not at every call site that raises an event
 * throughout the app.
 */
export async function dispatchEmailEvent(event: EmailEvent & DispatchTarget): Promise<void> {
  const { subject, text } = renderEmailEvent(event)
  const recipients = [event.to, event.toSiteAdminInbox ? getSiteAdminNotificationEmail() : null].filter(
    (r): r is string => Boolean(r)
  )

  if (recipients.length === 0) {
    return
  }

  // Dev no-op: no email provider is connected this session, and sending
  // real mail during development is explicitly out of scope. This log line
  // is the entire "send" -- replace this block with a real provider call
  // (e.g. Resend's API) when one is configured; every call site above stays
  // unchanged.
  console.log(`[email:dev-noop] to=${recipients.join(",")} type=${event.type} subject="${subject}"\n${text}`)
}
