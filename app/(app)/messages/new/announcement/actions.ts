"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database.types"

/**
 * THE COMPOSER'S TWO SERVER CALLS.
 *
 * `previewAnnouncementAudience` exists so a person can see the size of what
 * they are about to do before they do it. It returns FIGURES ONLY -- the
 * underlying RPC never returns an identity -- so nothing that reaches the
 * browser can be turned into a roster of the club's families.
 *
 * `sendAnnouncement` composes and sends in one call. They are two RPCs in the
 * database (a draft, then a fan-out) because an interrupted fan-out has to be
 * resumable, but from the composer's point of view pressing Send is one act
 * and a half-sent announcement is not a state a person should have to
 * understand. If the fan-out fails after the draft is written, the draft
 * survives and pressing Send again completes it -- which is why the error
 * says "try again" rather than "start over".
 */

export interface AudiencePreview {
  recipientCount: number
  unreachableCount: number
  guardianRouteCount: number
  directRouteCount: number
}

export type PreviewResult = { ok: true; preview: AudiencePreview } | { ok: false; error: string }
export type SendResult = { ok: true; announcementId: string; recipientCount: number } | { ok: false; error: string }

export interface AnnouncementInput {
  senderIdentityType: string
  senderIdentityId: string | null
  scope: string
  scopeId: string | null
  replyMode: string
  excludeU18: boolean
  /**
   * The players chosen individually, when the sender narrowed the audience.
   * Empty for a whole-team or whole-club send. Sent as criteria, exactly as
   * the announcement row stores them -- never as a resolved recipient list.
   */
  playerIds?: string[]
}

/** One player a sender may choose. Carries no recipient and no contact detail. */
export interface SelectablePlayer {
  playerId: string
  displayName: string
  isAdult: boolean
  reachable: boolean
  outcome: string
  /**
   * How many people this ONE player resolves to. Shown per row so a sender can
   * see that a child with two guardians reaches two people -- and deliberately
   * never summed for a total, because two children can share a guardian and
   * the sum would then overstate the send. The total comes from the server.
   */
  recipientCount: number
}

export type SelectableResult =
  | { ok: true; players: SelectablePlayer[] }
  | { ok: false; error: string }

/**
 * The audience as CRITERIA. player_ids only where the sender actually narrowed
 * the audience; a whole-team send carries an empty spec so the resolver reads
 * live membership at send time rather than a frozen roster.
 */
function audienceSpec(input: AnnouncementInput): Json {
  if (input.scope !== "selected") return {}
  return { player_ids: input.playerIds ?? [] }
}

function readableError(message: string | undefined, fallback: string): string {
  if (!message) return fallback
  if (message.includes("SQLSTATE") || /^[a-z_]+ [a-z_]+:/i.test(message)) return fallback
  return message
}

/**
 * The people a sender may pick from, for the audience they are addressing.
 *
 * A thin pass-through to public.selectable_announcement_audience, which
 * applies the same authority the send path applies. Nothing is filtered here:
 * a picker that did its own filtering would be a second opinion about who is
 * selectable, and the second opinion is the one that goes stale.
 */
export async function listSelectableAudience(
  scope: string,
  scopeId: string | null,
): Promise<SelectableResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("selectable_announcement_audience", {
    p_scope: scope,
    p_scope_id: scopeId as unknown as string,
  })

  if (error) {
    return { ok: false, error: readableError(error.message, "This audience could not be listed.") }
  }

  return {
    ok: true,
    players: (data ?? []).map((p) => ({
      playerId: p.player_id,
      displayName: p.display_name,
      isAdult: p.is_adult,
      reachable: p.reachable,
      outcome: p.outcome,
      recipientCount: p.recipient_count,
    })),
  }
}

export async function previewAnnouncementAudience(input: AnnouncementInput): Promise<PreviewResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc("preview_audience", {
      p_scope: input.scope,
      // The generated types model a SQL DEFAULT NULL parameter as optional
      // rather than nullable, so an absent scope is omitted, not sent as null.
      p_scope_id: input.scopeId ?? undefined,
      p_audience_spec: audienceSpec(input),
      p_exclude_u18: input.excludeU18,
      p_sender_identity_type: input.senderIdentityType,
      p_reply_mode: input.replyMode,
    })
    .maybeSingle()

  if (error) {
    // The preview IS the authority check, so this message is the honest one
    // to show: "team announcements are turned off", "you are not authorised
    // to address this club's audience". Showing it here means the person
    // finds out when they pick the audience, not after writing the message.
    return { ok: false, error: readableError(error.message, "This audience could not be checked.") }
  }

  return {
    ok: true,
    preview: {
      recipientCount: data?.recipient_count ?? 0,
      unreachableCount: data?.unreachable_count ?? 0,
      guardianRouteCount: data?.guardian_route_count ?? 0,
      directRouteCount: data?.direct_route_count ?? 0,
    },
  }
}

export async function sendAnnouncement(
  input: AnnouncementInput & { title: string; body: string },
): Promise<SendResult> {
  const body = input.body.trim()
  if (!body) return { ok: false, error: "Write your announcement first." }

  const supabase = await createClient()

  // `as unknown as string` on the two id arguments, matching the idiom
  // already used in app/(app)/messages/actions.ts. They are genuinely
  // nullable in SQL -- a platform announcement has no scope and no identity
  // id -- but `supabase gen types` cannot express a nullable ARGUMENT, so it
  // types every required parameter as non-null. The cast records that
  // limitation rather than pretending the value is always present.
  const { data: announcementId, error: createError } = await supabase.rpc("create_announcement", {
    p_sender_identity_type: input.senderIdentityType,
    p_sender_identity_id: input.senderIdentityId as unknown as string,
    p_scope: input.scope,
    p_scope_id: input.scopeId as unknown as string,
    p_body: body,
    p_title: input.title.trim() || undefined,
    p_reply_mode: input.replyMode,
    p_audience_spec: audienceSpec(input),
    p_exclude_u18: input.excludeU18,
  })

  if (createError || !announcementId) {
    return { ok: false, error: readableError(createError?.message, "This announcement could not be created.") }
  }

  const { data: recipientCount, error: sendError } = await supabase.rpc("send_announcement", {
    p_announcement_id: announcementId,
  })

  if (sendError) {
    return {
      ok: false,
      // Truthful about what happened: the announcement exists and is not lost.
      error: readableError(sendError.message, "The announcement was saved but could not be sent. Try again."),
    }
  }

  revalidatePath("/messages")
  return { ok: true, announcementId, recipientCount: recipientCount ?? 0 }
}
