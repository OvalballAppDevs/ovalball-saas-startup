import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSiteUrl } from "@/lib/site-url"
import type { Database } from "@/types/database.types"

import { emailEventDefinition, type EmailEventKey } from "./catalogue"
import type { EmailTemplateContent } from "./contracts"
import { getSenderIdentity, selectEmailProvider } from "./provider"
import { resolveRecipients, type RecipientRef } from "./recipients"
import { resolveTemplateContent } from "./resolve-content"
import { renderEmail, type EmailEventData } from "./templates"

/**
 * The one entry point. Every email in the product goes through here.
 *
 * THE PIPELINE, IN THE ORDER THAT MATTERS
 *
 *   1. Catalogue    -- what kind of email is this, and who is it for?
 *   2. Recipients   -- resolved SERVER-SIDE from a canonical record. No `to`.
 *   3. Policy       -- may this recipient be emailed for this classification?
 *   4. Idempotency  -- claim the occurrence, or stop. Retries do not resend.
 *   5. Render       -- HTML and hand-written plain text.
 *   6. Provider     -- attempt, then record what actually happened.
 *
 * Steps 2-4 happen BEFORE rendering on purpose. Rendering a message for a
 * recipient we then decline to mail wastes nothing important, but claiming
 * the idempotency key after a successful send would leave a window where a
 * retry sends twice.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
 *
 * It never throws into a domain action. A club admin creating an invitation
 * has succeeded at creating an invitation whether or not the mail provider
 * was reachable; failing their action because a third party was down would
 * be inventing a dependency the product does not have. The outcome is
 * recorded in email_deliveries instead, which is where the operator looks.
 */

export type SendOutcome =
  | { status: "sent"; recipients: number }
  | { status: "suppressed"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "duplicate" }

export interface SendEmailEventArgs<K extends EmailEventKey> {
  supabase: SupabaseClient<Database>
  eventKey: K
  /**
   * The canonical occurrence this email belongs to. One occurrence sends once.
   * Build it from the entity, NOT from a timestamp -- `${eventKey}:${id}` for
   * a one-shot event, `${eventKey}:${id}:${version}` where later amendments
   * are legitimately separate messages.
   */
  idempotencyKey: string
  recipient: RecipientRef
  data: EmailEventData[K]
}

export async function sendEmailEvent<K extends EmailEventKey>(
  args: SendEmailEventArgs<K>
): Promise<SendOutcome> {
  const { supabase, eventKey, idempotencyKey, recipient, data } = args
  const definition = emailEventDefinition(eventKey)

  // ---- 1.5. Delivery policy -- BEFORE recipient resolution, deliberately ----
  //
  // Whether this event's email channel is switched on is checked first, so a
  // disabled event never resolves who it would have mailed: no recipient PII
  // is read merely to record that nothing was sent. The suppression itself is
  // claimed here too, not left to the loop below, because there is nothing
  // per-recipient to claim -- one occurrence, one record, exactly matching
  // "the event occurred, its email channel was off", never a fake per-person
  // failure. See scripts/verify-dynamic-data-catalogue.mjs's sibling guard
  // (verify-email-wiring.mjs) for the structural check that this call cannot
  // be bypassed by a caller that skips straight to rendering.
  const { data: active, error: activeError } = await supabase.rpc("email_event_active", { p_event_key: eventKey })
  if (activeError) {
    return { status: "failed", reason: `Delivery policy could not be checked: ${activeError.message}` }
  }
  if (!active) {
    await supabase.rpc("claim_disabled_email_suppression", {
      p_event_key: eventKey,
      p_occurrence_key: idempotencyKey,
      p_recipient_kind: definition.recipientKind,
    })
    return { status: "suppressed", reason: "This email is currently switched off in Email Configuration." }
  }

  // ---- 2. Recipients, resolved server-side ----
  const resolution = await resolveRecipients(supabase, recipient)
  if (!resolution.ok) {
    return { status: "suppressed", reason: resolution.reason }
  }

  // ---- 3. Policy ----
  // A TRANSACTIONAL_IDENTITY email goes to someone with no account, so there
  // is no preference to consult and none is invented. A MANDATORY_OPERATIONAL
  // email is delivered regardless of preference, by policy. Only
  // OPTIONAL_OPERATIONAL asks -- and it asks the canonical
  // notification_preferences row, never a second consent store.
  let allowed = resolution.recipients
  if (definition.classification === "OPTIONAL_OPERATIONAL" && definition.topicKey) {
    const userIds = allowed.map((r) => r.userId).filter((id): id is string => id !== null)
    if (userIds.length > 0) {
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("user_id, email_enabled")
        .eq("topic_key", definition.topicKey)
        .in("user_id", userIds)
      const optedOut = new Set(
        (prefs ?? []).filter((p) => p.email_enabled === false).map((p) => p.user_id)
      )
      allowed = allowed.filter((r) => !r.userId || !optedOut.has(r.userId))
    }
    if (allowed.length === 0) {
      return { status: "suppressed", reason: "Every recipient has turned this topic's email off." }
    }
  }

  const siteUrl = getSiteUrl()

  // ---- 5. Copy, resolved through the ONE path ----
  // The published Site Admin version if there is a valid one, the registered
  // default otherwise. A send is never blocked by an editing mistake: content
  // that no longer satisfies its contract falls back to the default and says
  // so in the log, because an unsent invitation is a worse outcome than an
  // email that reads the way it shipped.
  const resolved = await resolveTemplateContent(supabase, eventKey)
  const rendered = renderEmail(eventKey, data, siteUrl, resolved.content)
  const { provider, configurationError } = selectEmailProvider()
  const sender = getSenderIdentity()

  let sent = 0
  let lastFailure: string | null = null
  let anyClaimed = false

  for (const target of allowed) {
    // ---- 4. Idempotency ----
    // One key per recipient: a club with three admins is three deliveries of
    // one occurrence, and each must be independently retry-safe.
    const key = allowed.length > 1 ? `${idempotencyKey}:${target.email}` : idempotencyKey
    const { data: deliveryId, error: claimError } = await supabase.rpc("claim_email_delivery", {
      p_event_key: eventKey,
      p_idempotency_key: key,
      // The occurrence this recipient's delivery belongs to -- shared across
      // every recipient of the SAME trigger, so "how many times was this
      // email triggered" (send occurrences) is answerable precisely, never
      // approximated from idempotency_key string-parsing.
      p_occurrence_key: idempotencyKey,
      p_recipient_kind: definition.recipientKind,
      p_recipient_ref: target.ref ?? undefined,
      p_recipient_email: target.email,
      p_club_id: target.clubId ?? undefined,
      p_subject: rendered.subject,
    })

    if (claimError) {
      lastFailure = `Delivery could not be recorded: ${claimError.message}`
      continue
    }
    // Already recorded: this occurrence has been handled. Not an error.
    if (!deliveryId) continue
    anyClaimed = true

    // ---- 5/6. Attempt, then record what actually happened ----
    if (configurationError) {
      await recordResult(supabase, deliveryId, "suppressed", provider.name, null, null, null, configurationError)
      lastFailure = configurationError
      continue
    }
    if (!sender) {
      const reason = "EMAIL_FROM_ADDRESS is not configured."
      await recordResult(supabase, deliveryId, "suppressed", provider.name, null, null, null, reason)
      lastFailure = reason
      continue
    }
    if (!provider.delivers) {
      await recordResult(
        supabase,
        deliveryId,
        "suppressed",
        provider.name,
        null,
        null,
        null,
        "No email provider is configured, so nothing was sent. This is the deliberate local default."
      )
      continue
    }

    const result = await provider.send(
      { to: target.email, subject: rendered.subject, html: rendered.html, text: rendered.text },
      sender
    )

    if (result.ok) {
      await recordResult(supabase, deliveryId, "sent", provider.name, result.providerReference, null, null, null)
      sent += 1
    } else {
      await recordResult(
        supabase,
        deliveryId,
        "failed",
        provider.name,
        null,
        result.errorCode,
        result.errorMessage,
        null
      )
      lastFailure = `${result.errorCode}: ${result.errorMessage}`
    }
  }

  if (!anyClaimed) return { status: "duplicate" }
  if (sent > 0) return { status: "sent", recipients: sent }
  if (lastFailure) return { status: "failed", reason: lastFailure }
  return {
    status: "suppressed",
    reason: "No email provider is configured, so nothing was sent.",
  }
}

export type TestSendOutcome =
  | { status: "sent"; destination: string }
  | { status: "failed"; reason: string }

/**
 * SEND TEST EMAIL -- a deliberate, narrow, disclosed exception to "there is
 * no `to` parameter anywhere in this system".
 *
 * Every other function in this file exists because a `to` parameter is how
 * an authenticated open mail relay happens -- see lib/email/recipients.ts's
 * own header for the safeguarding officer bug this whole design prevents.
 * This one function is allowed to take an explicit destination because it is
 * the ONE place that is supposed to: a Full Site Admin checking their own
 * wording, never a real recipient, never inferred to belong to any Player or
 * Guardian. What keeps it from reopening that hazard is everything BELOW it,
 * not an absence of a `to`:
 *
 *   - public.claim_test_email_send re-checks Full Site Admin authority and a
 *     6-per-10-minutes rate limit itself, server-side -- never trusts the
 *     caller to have already checked (see the RPC's own comment).
 *   - the render call always passes isTest: true, so the renderer-owned test
 *     banner and subject prefix are never something a template author can
 *     omit or fake.
 *   - it uses this event's registered PREVIEW FIXTURE data, never a real
 *     record -- a test destination cannot pull real Player/Guardian data
 *     into an email merely by being typed into a box.
 *   - it goes through the SAME renderEmail, the SAME selectEmailProvider,
 *     the SAME email_deliveries ledger as a real send -- the only
 *     intentional differences are the destination, the fixture data, and
 *     the test marker.
 */
export async function sendTestEmail<K extends EmailEventKey>(args: {
  supabase: SupabaseClient<Database>
  eventKey: K
  destinationEmail: string
  data: EmailEventData[K]
  content: EmailTemplateContent
  /**
   * The embedded logo's origin only. Resolved by the CALLER (the Send Test
   * Email server action) from the request that is actually serving it --
   * this file deliberately never resolves an asset origin itself, only
   * accepts one as a plain string, so the request-bound resolution logic
   * stays in exactly one place and can never be imported into the real send
   * path by mistake. A real send always resolves links and images from
   * getSiteUrl() unconditionally; this narrow exception exists because a
   * test send is a REAL email opened in a REAL mail client (Mailpit
   * locally), not a same-origin preview iframe, so a worktree dev server on
   * a nonstandard port needs the request's own origin for the embedded
   * image to load at all. Undefined falls back to getSiteUrl(), matching
   * every other send.
   */
  assetOrigin?: string
}): Promise<TestSendOutcome> {
  const { supabase, eventKey, destinationEmail, data, content, assetOrigin } = args
  const siteUrl = getSiteUrl()
  const rendered = renderEmail(eventKey, data, siteUrl, content, assetOrigin, true)

  const { data: deliveryId, error: claimError } = await supabase.rpc("claim_test_email_send", {
    p_event_key: eventKey,
    p_recipient_email: destinationEmail,
    p_subject: rendered.subject,
  })
  if (claimError) return { status: "failed", reason: claimError.message }
  if (!deliveryId) return { status: "failed", reason: "The test send could not be recorded." }

  const { provider, configurationError } = selectEmailProvider()
  const sender = getSenderIdentity()

  if (configurationError) {
    await recordResult(supabase, deliveryId, "suppressed", provider.name, null, null, null, configurationError)
    return { status: "failed", reason: configurationError }
  }
  if (!sender) {
    const reason = "EMAIL_FROM_ADDRESS is not configured."
    await recordResult(supabase, deliveryId, "suppressed", provider.name, null, null, null, reason)
    return { status: "failed", reason }
  }
  if (!provider.delivers) {
    const reason = "No email provider is configured, so nothing was sent. This is the deliberate local default."
    await recordResult(supabase, deliveryId, "suppressed", provider.name, null, null, null, reason)
    return { status: "failed", reason }
  }

  const result = await provider.send(
    { to: destinationEmail, subject: rendered.subject, html: rendered.html, text: rendered.text },
    sender
  )

  if (result.ok) {
    await recordResult(supabase, deliveryId, "sent", provider.name, result.providerReference, null, null, null)
    return { status: "sent", destination: destinationEmail }
  }
  await recordResult(supabase, deliveryId, "failed", provider.name, null, result.errorCode, result.errorMessage, null)
  return { status: "failed", reason: `${result.errorCode}: ${result.errorMessage}` }
}

async function recordResult(
  supabase: SupabaseClient<Database>,
  deliveryId: string,
  status: string,
  providerName: string,
  providerReference: string | null,
  errorCode: string | null,
  errorMessage: string | null,
  suppressionReason: string | null
): Promise<void> {
  const { error } = await supabase.rpc("record_email_delivery_result", {
    p_delivery_id: deliveryId,
    p_status: status,
    p_provider: providerName,
    // The generated RPC arg types model a nullable SQL default as `undefined`,
    // so an explicit "no value" is passed as undefined rather than null.
    p_provider_reference: providerReference ?? undefined,
    p_error_code: errorCode ?? undefined,
    p_error_message: errorMessage ?? undefined,
    p_suppression_reason: suppressionReason ?? undefined,
  })
  // The mail may genuinely have gone out; losing the RECORD of it is an
  // observability failure, not a delivery one, and must not be silent.
  if (error) {
    console.error(`[email] delivery ${deliveryId} result could not be recorded: ${error.message}`)
  }
}
