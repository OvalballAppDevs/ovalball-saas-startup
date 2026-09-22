import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

import { messageTarget, type AttachableKind } from "./attachments"

/**
 * YOUR OWN CONTACT DETAILS, SHARED DELIBERATELY.
 *
 * A fixture secretary arranging an away game needs the other club to be able to ring them, and typing a
 * mobile number into a message means it is then in a thread forever with no record of having decided to
 * share it. The platform models the decision instead: `share_fixture_contact_card` writes a SNAPSHOT of
 * the sender's own name, role, club, team and telephone at the moment they chose to send it.
 *
 * IT IS ALWAYS YOUR OWN CARD, NEVER SOMEBODY ELSE'S. The RPC takes no person parameter -- it reads
 * `auth.uid()` -- so there is no shape of call that shares a colleague's telephone number, and nothing
 * here could add one.
 *
 * PREVIEW BEFORE SEND, because the number comes from the profile rather than from the composer, and
 * somebody is entitled to see exactly what is about to leave. `preview_my_message_contact_card` returns
 * the same snapshot the share would write; a profile with no telephone returns nothing to preview, which
 * is the honest answer to "share my number" when there is no number.
 *
 * FIVE FIELDS, AND ONLY FIVE. A conversation existing is not consent to inspect a profile: the snapshot
 * is the canonical contact-card projection -- name, role, club, team, telephone -- and there is no shape
 * of call from here that returns anything else. In a direct conversation the role comes from the club the
 * two people share, which is the relationship the conversation rests on.
 */

export interface ContactCardPreview {
  displayName: string
  roleLabel: string
  clubName: string
  teamName: string | null
  telephone: string
}

export async function previewContactCard(
  supabase: SupabaseClient<Database>,
  kind: AttachableKind,
  id: string
): Promise<{ ok: true; card: ContactCardPreview } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("preview_my_message_contact_card", {
    p_target_type: messageTarget(kind),
    p_target_id: id,
  })
  if (error) return { ok: false, message: error.message || "Couldn't prepare your contact card." }
  const row = data?.[0]
  if (!row) {
    return {
      ok: false,
      message:
        "There's nothing to share yet. Add a telephone number to your Ovalball account first, and it will appear here.",
    }
  }
  return {
    ok: true,
    card: {
      displayName: row.display_name,
      roleLabel: row.role_label,
      clubName: row.club_name,
      teamName: row.team_name,
      telephone: row.telephone,
    },
  }
}

export async function shareContactCard(
  supabase: SupabaseClient<Database>,
  kind: AttachableKind,
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("share_message_contact_card", {
    p_target_type: messageTarget(kind),
    p_target_id: id,
  })
  if (error) return { ok: false, message: error.message || "Couldn't share your contact card." }
  return { ok: true }
}
