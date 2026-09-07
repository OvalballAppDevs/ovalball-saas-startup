import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSiteUrl } from "@/lib/site-url"
import type { Database } from "@/types/database.types"

import { emailEventDefinition, type EmailEventKey } from "./catalogue"
import { getFromAddress, selectEmailProvider } from "./provider"
import { resolveRecipients, type RecipientRef } from "./recipients"
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
  const rendered = renderEmail(eventKey, data, siteUrl)
  const { provider, configurationError } = selectEmailProvider()
  const from = getFromAddress()

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
    if (!from) {
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
      from
    )

    if (result.ok) {
      await recordResult(supabase, deliveryId, "sent", provider.name, result.providerMessageId, null, null, null)
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

async function recordResult(
  supabase: SupabaseClient<Database>,
  deliveryId: string,
  status: string,
  providerName: string,
  providerMessageId: string | null,
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
    p_provider_message_id: providerMessageId ?? undefined,
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
