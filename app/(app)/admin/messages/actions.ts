"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"

export type ActionResult = { ok: true } | { ok: false; error: string }

export interface GlobalPolicyInput {
  allowDirectAttachments: boolean
  allowDocumentLibrarySharing: boolean
  allowImageUploads: boolean
  allowContactCardSharing: boolean
  allowParticipantManagement: boolean
  allowDirectAttachmentsClubOverrideAllowed: boolean
  allowDocumentLibrarySharingClubOverrideAllowed: boolean
  allowImageUploadsClubOverrideAllowed: boolean
  allowContactCardSharingClubOverrideAllowed: boolean
  allowParticipantManagementClubOverrideAllowed: boolean
  maxAttachmentSizeBytes: number
  allowedFileTypes: string[]
}

/**
 * requireSiteAdmin(['message_moderator']) rejects everyone except Full
 * Site Admin and Message Moderator up front -- update_global_message_policy
 * itself re-checks is_full_site_admin() as the real boundary (RLS-adjacent,
 * SECURITY DEFINER), so a Message Moderator's attempt still fails at the
 * RPC even though it passes this looser pre-check; this just gives a
 * clearer rejection than a bare RLS-style error for the common case
 * (anyone who isn't Full at all).
 */
export async function updateGlobalMessagePolicyAction(input: GlobalPolicyInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("update_global_message_policy", {
    p_allow_direct_attachments: input.allowDirectAttachments,
    p_allow_document_library_sharing: input.allowDocumentLibrarySharing,
    p_allow_image_uploads: input.allowImageUploads,
    p_allow_contact_card_sharing: input.allowContactCardSharing,
    p_allow_participant_management: input.allowParticipantManagement,
    p_allow_direct_attachments_club_override_allowed: input.allowDirectAttachmentsClubOverrideAllowed,
    p_allow_document_library_sharing_club_override_allowed: input.allowDocumentLibrarySharingClubOverrideAllowed,
    p_allow_image_uploads_club_override_allowed: input.allowImageUploadsClubOverrideAllowed,
    p_allow_contact_card_sharing_club_override_allowed: input.allowContactCardSharingClubOverrideAllowed,
    p_allow_participant_management_club_override_allowed: input.allowParticipantManagementClubOverrideAllowed,
    p_max_attachment_size_bytes: input.maxAttachmentSizeBytes,
    p_allowed_file_types: input.allowedFileTypes,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/messages")
  return { ok: true }
}

export type ThreadContentResult =
  | { ok: true; messages: { id: string; senderName: string; body: string; createdAt: string; reportStatus: string | null; reportReason: string | null }[] }
  | { ok: false; error: string }

/**
 * The sanctioned content-reveal path -- admin_get_message_thread_content
 * does its own Full/Message Moderator check AND writes its own audit_log
 * row before returning body text (see 20260831290000_message_management.sql).
 * This action never bypasses that; it only forwards the call.
 */
export async function revealMessageThreadContentAction(fixtureId: string | null, fixtureRequestId: string | null): Promise<ThreadContentResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("admin_get_message_thread_content", {
    p_fixture_id: fixtureId ?? undefined,
    p_fixture_request_id: fixtureRequestId ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    messages: (data ?? []).map((m) => ({
      id: m.id,
      senderName: m.sender_name ?? "Unknown",
      body: m.body,
      createdAt: m.created_at,
      reportStatus: m.report_status,
      reportReason: m.report_reason,
    })),
  }
}

export async function markMessageReportReviewedAction(messageId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_message_report_reviewed", { p_message_id: messageId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/messages")
  return { ok: true }
}

export async function resolveMessageReportAction(messageId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolve_message_report", { p_message_id: messageId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/messages")
  return { ok: true }
}
