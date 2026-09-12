"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import type { ConversationKind } from "../../actions"

export interface AddableClubMember {
  userId: string
  name: string
  /**
   * True when the CALLER has blocked this person. Safe to show: it reports
   * the viewer's own decision back to them. There is deliberately no
   * corresponding "they blocked me" flag -- the server omits those people
   * entirely, because a disabled row with any reason attached is still an
   * answer to a question nobody is entitled to ask.
   */
  blockedByMe: boolean
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
  return data.map((row) => ({ userId: row.user_id, name: row.name, blockedByMe: row.blocked_by_me }))
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

/**
 * BLOCKING A PERSON, from the one place a person is genuinely identifiable.
 *
 * Both calls are thin passes to the RPCs from 20270241000000. The blocker is
 * always auth.uid() inside the database, so nothing here can act on somebody
 * else's behalf however it is called.
 *
 * The error text is deliberately the RPC's own: `block_user` says "That
 * person could not be blocked" whether the account is missing or the id is
 * nonsense, precisely so that probing it cannot confirm an account exists.
 * Rewriting that here with something more specific would undo the point.
 */
export async function blockUser(userId: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("block_user", { p_user_id: userId })
  if (error) return { ok: false, error: error.message || "That person could not be blocked." }

  // Every Messenger surface reads block state, so all of them are stale now.
  revalidatePath("/messages", "layout")
  return { ok: true }
}

export async function unblockUser(userId: string): Promise<ParticipantActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("unblock_user", { p_user_id: userId })
  if (error) return { ok: false, error: error.message || "That person could not be unblocked." }

  revalidatePath("/messages", "layout")
  return { ok: true }
}
