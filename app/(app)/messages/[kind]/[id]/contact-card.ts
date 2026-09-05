"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import type { ConversationKind } from "../../actions"

export interface ContactCardPreview {
  displayName: string
  roleLabel: string | null
  clubName: string | null
  teamName: string | null
  telephone: string | null
}

/**
 * Read-only -- resolves what a real share_fixture_contact_card call would
 * post, for the confirm screen the brief requires, without writing
 * anything. roleLabel/clubName null means the caller has no club/team
 * standing on this fixture (share will be refused); telephone null means
 * their profile has none yet (share will be refused, UI should offer
 * "Add telephone number").
 */
export async function previewMyContactCard(kind: ConversationKind, id: string): Promise<ContactCardPreview | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("preview_my_fixture_contact_card", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return {
    displayName: row.display_name,
    roleLabel: row.role_label,
    clubName: row.club_name,
    teamName: row.team_name,
    telephone: row.telephone,
  }
}

export type ShareContactCardResult = { ok: true } | { ok: false; error: string }

export async function shareContactCard(kind: ConversationKind, id: string): Promise<ShareContactCardResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("share_fixture_contact_card", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}
