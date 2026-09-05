"use server"

import { createClient } from "@/lib/supabase/server"
import {
  CONTACT_REASON_CATEGORY,
  contactSubject,
  isContactReason,
} from "@/lib/contact/reasons"

export type ContactResult = { ok: true; reference: string } | { ok: false; error: string }

const MAX_NAME = 120
const MAX_MESSAGE = 5000

/**
 * The public Contact endpoint.
 *
 * This is a thin, deliberately boring layer over the SAME
 * submit_public_support_ticket() RPC that /support already uses. It is not
 * a mail relay and never becomes one:
 *
 *  - there is no recipient parameter, here or in the RPC -- a submission is
 *    a row in `support_tickets`, so there is no address for a caller to
 *    point somewhere else;
 *  - the ticket category and subject are derived server-side from a
 *    validated reason key, never accepted from the client;
 *  - the RPC re-validates everything below (name, email shape, subject and
 *    message length, category membership) and enforces a hard limit of
 *    three public tickets per email address per rolling hour, inside the
 *    database, so it cannot be bypassed by calling the RPC directly.
 *
 * The checks in this function are therefore a second layer that exists to
 * return kind, specific messages -- not the security boundary.
 */
export async function submitContactMessage(input: {
  name: string
  email: string
  reason: string
  message: string
  honeypot: string
}): Promise<ContactResult> {
  // A field no real visitor can see or reach (off-screen, aria-hidden,
  // tabIndex -1) but a scripted form-filler populates. Reported as success
  // so an automated submitter learns nothing about why it failed; nothing
  // is written.
  if (input.honeypot.trim().length > 0) {
    return { ok: true, reference: "OB-000000-0000" }
  }

  const name = input.name.trim()
  const email = input.email.trim()
  const message = input.message.trim()

  if (name.length === 0) return { ok: false, error: "Please tell us your name." }
  if (name.length > MAX_NAME) return { ok: false, error: "That name is too long." }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address so we can reply." }
  }
  if (message.length === 0) return { ok: false, error: "Please write your message." }
  if (message.length > MAX_MESSAGE) {
    return { ok: false, error: "That message is too long. Please shorten it a little." }
  }
  if (!isContactReason(input.reason)) {
    return { ok: false, error: "Please choose a reason for contacting us." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("submit_public_support_ticket", {
    p_name: name,
    p_email: email,
    p_category: CONTACT_REASON_CATEGORY[input.reason],
    p_subject: contactSubject(input.reason),
    p_description: message,
  })

  if (error || !data) {
    // The rate limiter raises a deliberately user-facing message; anything
    // else is an internal fault the visitor can do nothing with, so it is
    // replaced rather than surfaced as a raw provider/database string.
    const isRateLimit = error?.message?.includes("Too many requests")
    return {
      ok: false,
      error: isRateLimit
        ? error!.message
        : "We couldn't send your message just now.",
    }
  }

  return { ok: true, reference: data }
}
