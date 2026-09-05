"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import type { ConversationKind } from "../../actions"

export interface AddableClubMember {
  userId: string
  name: string
}

/**
 * My own club's active operational contacts (Club Admin/Fixtures Admin,
 * or coaches/team officials on one of this fixture's own teams) -- never
 * parents/players. can_access_fixture_conversation is re-checked inside
 * the RPC itself, so a caller with no real standing on this fixture just
 * gets an empty list back, never an error that leaks whether the fixture
 * exists.
 */
export async function listAddableClubMembers(kind: ConversationKind, id: string): Promise<AddableClubMember[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("list_addable_club_members", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error || !data) return []
  return data.map((row) => ({ userId: row.user_id, name: row.name }))
}

export type ParticipantActionResult = { ok: true } | { ok: false; error: string }

export async function addConversationParticipant(kind: ConversationKind, id: string, userId: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_fixture_conversation_participant", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_user_id: userId,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  return { ok: true }
}

export async function removeConversationParticipant(kind: ConversationKind, id: string, userId: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_fixture_conversation_participant", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_user_id: userId,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  return { ok: true }
}

export async function leaveConversation(kind: ConversationKind, id: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("leave_fixture_conversation", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}

export async function rejoinConversation(kind: ConversationKind, id: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("rejoin_fixture_conversation", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}

export async function setConversationMute(kind: ConversationKind, id: string, muted: boolean): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_fixture_conversation_mute", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_muted: muted,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
