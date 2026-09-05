"use server"

import { createClient } from "@/lib/supabase/server"
import type { SupportCategory } from "@/lib/support/types"

export type PublicSupportResult = { ok: true; reference: string } | { ok: false; error: string }

/**
 * The public, logged-out entry point -- no account, no session, ever
 * created here. submit_public_support_ticket() (a SECURITY DEFINER RPC
 * granted to anon) does the real validation and rate limiting; this layer
 * adds one more check ahead of that: a honeypot field. `website` is a
 * field a real visitor never sees or fills in (styled off-screen in the
 * form, never a real address book field), so anything in it is a strong
 * signal of an automated submission -- silently accepted-looking but
 * actually a no-op, which tells a scraping bot nothing about why it failed.
 */
export async function submitPublicSupportTicket(input: {
  name: string
  email: string
  category: SupportCategory
  subject: string
  description: string
  clubContext: string
  honeypot: string
}): Promise<PublicSupportResult> {
  if (input.honeypot.trim().length > 0) {
    // Looks successful to whatever filled the honeypot in; nothing is
    // actually submitted.
    return { ok: true, reference: "OB-000000-0000" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("submit_public_support_ticket", {
    p_name: input.name,
    p_email: input.email,
    p_category: input.category,
    p_subject: input.subject,
    p_description: input.description,
    p_club_context: input.clubContext || undefined,
  })

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't submit your request. Please try again." }
  }

  return { ok: true, reference: data }
}
