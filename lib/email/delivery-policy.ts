import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { emailEventDefinition, type EmailEventKey, type EmailClassification } from "./catalogue"
import { WIRED_EVENT_KEYS } from "./wiring"
import type { Database } from "@/types/database.types"

/**
 * THE EMAIL ON/OFF SWITCH -- read and write, both server-only, both
 * resolving from public.email_events.active (wired up by migration
 * 20270128000000; the correction in 20270129000000 is the reasoning that
 * actually governs this file now -- read that migration's own header
 * before changing anything here).
 *
 * WHAT DECIDES `toggleable` -- AND WHAT DOES NOT
 * -------------------------------------------------
 * Full Site Admin may switch OFF every WIRED email event, regardless of
 * classification. Classification (MANDATORY_OPERATIONAL,
 * OPTIONAL_OPERATIONAL, TRANSACTIONAL_IDENTITY) governs a completely
 * different question -- whether an ORDINARY RECIPIENT's own preference can
 * suppress the message -- and must never be reused as the admin-authority
 * check here. The only thing that legitimately withholds the control is
 * whether the event has an actual send trigger yet
 * (lib/email/wiring.ts#WIRED_EVENT_KEYS): toggling a channel nothing sends
 * through would show a Site Admin a decision that does nothing, so a
 * "Not Wired" event is presented differently, not as a locked switch.
 *
 * If Ovalball ever needs a message that genuinely cannot be switched off
 * for legal/safeguarding reasons, that is a new, explicit, individually
 * named exception -- never inferred from the existing classification enum.
 * None exists today.
 */

export interface EmailEventPolicy {
  eventKey: EmailEventKey
  active: boolean
  wired: boolean
  classification: EmailClassification
  lockVersion: number
  updatedAt: string | null
}

/** Every registered event's current policy state, in one query -- never one call per event. */
export async function listEmailEventPolicies(
  supabase: SupabaseClient<Database>
): Promise<Record<string, EmailEventPolicy>> {
  const { data, error } = await supabase
    .from("email_events")
    .select("event_key, active, lock_version, updated_at")
  if (error || !data) return {}

  const wiredKeys = new Set<string>(WIRED_EVENT_KEYS)

  const out: Record<string, EmailEventPolicy> = {}
  for (const row of data) {
    const key = row.event_key as EmailEventKey
    out[key] = {
      eventKey: key,
      active: row.active,
      wired: wiredKeys.has(key),
      classification: emailEventDefinition(key).classification,
      lockVersion: row.lock_version,
      updatedAt: row.updated_at,
    }
  }
  return out
}

export type SetEmailEventActiveResult = { ok: true } | { ok: false; error: string }

export async function setEmailEventActive(
  supabase: SupabaseClient<Database>,
  eventKey: EmailEventKey,
  active: boolean,
  expectedLock: number
): Promise<SetEmailEventActiveResult> {
  const { error } = await supabase.rpc("set_email_event_active", {
    p_event_key: eventKey,
    p_active: active,
    p_expected_lock: expectedLock,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
