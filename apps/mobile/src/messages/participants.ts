import type { SupabaseClient } from "@supabase/supabase-js"
import {
  canManageConversationParticipants,
  listAddableMembers,
  loadConversationParticipants,
  resolveConversationParties,
  type AddableMember,
  type ConversationParticipant,
  type ConversationParticipants,
  type Database,
  type GroupConversationKind,
  type SessionContext,
} from "@ovalball/contracts"

/**
 * WHO IS IN THIS CONVERSATION, AND WHAT MAY BE DONE ABOUT IT.
 *
 * Every read and every mutation below is the platform's own. The list comes from the shared resolver
 * both clients use; adding, removing, leaving, rejoining and muting are the canonical RPCs, each of
 * which re-checks `can_access_fixture_conversation` itself. `canManage` is mirrored here for the
 * INTERFACE only -- so the worst a wrong answer can do is show a control that is then refused, never
 * grant anything.
 *
 * BLOCKING IS A PERSON-LEVEL ACT, not a conversation one. `block_user` takes the person and the blocker
 * is always `auth.uid()` inside the database, so nothing here can act on somebody else's behalf however
 * it is called. Its error text is deliberately the RPC's own -- "That person could not be blocked"
 * whether the account is missing or the id is nonsense -- because rewriting it with something more
 * specific would turn it into a way of confirming an account exists.
 */

type Client = SupabaseClient<Database>
type Result = { ok: true } | { ok: false; message: string }

export interface ParticipantsView extends ConversationParticipants {
  canManage: boolean
  /** Present only where the platform models an explicit participant list, which a club thread does not. */
  canAdd: boolean
}

export async function loadParticipants(
  supabase: Client,
  ctx: SessionContext,
  kind: GroupConversationKind,
  id: string,
  viewerId: string
): Promise<ParticipantsView | null> {
  const parties = await resolveConversationParties(supabase, kind, id)
  if (!parties) return null
  const loaded = await loadConversationParticipants(supabase, kind, id, parties, viewerId)
  const canManage = canManageConversationParticipants(ctx, parties)
  return { ...loaded, canManage, canAdd: canManage && kind !== "club" }
}

export async function addableMembers(supabase: Client, kind: GroupConversationKind, id: string): Promise<AddableMember[]> {
  return listAddableMembers(supabase, kind, id)
}

const target = (kind: GroupConversationKind, id: string) => ({
  p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
  p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
})

export async function addParticipant(supabase: Client, kind: GroupConversationKind, id: string, userId: string): Promise<Result> {
  const { error } = await supabase.rpc("add_fixture_conversation_participant", { ...target(kind, id), p_user_id: userId })
  return error ? { ok: false, message: error.message || "That person couldn't be added." } : { ok: true }
}

export async function removeParticipant(supabase: Client, kind: GroupConversationKind, id: string, userId: string): Promise<Result> {
  const { error } = await supabase.rpc("remove_fixture_conversation_participant", { ...target(kind, id), p_user_id: userId })
  return error ? { ok: false, message: error.message || "That person couldn't be removed." } : { ok: true }
}

/**
 * LEAVING IS NOT LOSING ACCESS. A subscription ends; the role-derived or explicitly granted right to be
 * here does not, which is why rejoining is a button rather than a request.
 */
export async function leaveConversation(supabase: Client, kind: GroupConversationKind, id: string): Promise<Result> {
  const { error } = await supabase.rpc("leave_fixture_conversation", target(kind, id))
  return error ? { ok: false, message: error.message || "Couldn't leave this conversation." } : { ok: true }
}

export async function rejoinConversation(supabase: Client, kind: GroupConversationKind, id: string): Promise<Result> {
  const { error } = await supabase.rpc("rejoin_fixture_conversation", target(kind, id))
  return error ? { ok: false, message: error.message || "Couldn't rejoin this conversation." } : { ok: true }
}

export async function setMuted(supabase: Client, kind: GroupConversationKind, id: string, muted: boolean): Promise<Result> {
  const { error } = await supabase.rpc("set_fixture_conversation_mute", { ...target(kind, id), p_muted: muted })
  return error ? { ok: false, message: error.message || "Couldn't change notifications for this conversation." } : { ok: true }
}

export async function blockPerson(supabase: Client, userId: string): Promise<Result> {
  const { error } = await supabase.rpc("block_user", { p_user_id: userId })
  return error ? { ok: false, message: error.message || "That person could not be blocked." } : { ok: true }
}

export async function unblockPerson(supabase: Client, userId: string): Promise<Result> {
  const { error } = await supabase.rpc("unblock_user", { p_user_id: userId })
  return error ? { ok: false, message: error.message || "That person could not be unblocked." } : { ok: true }
}

export type { ConversationParticipant, AddableMember }
