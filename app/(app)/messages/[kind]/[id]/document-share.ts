"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import type { ConversationKind } from "../../actions"

export interface ShareableDocument {
  id: string
  title: string
  category: string
  originalFilename: string
  sizeBytes: number
}

/**
 * The sender's OWN club library only -- share_fixture_document itself
 * re-checks can_view_document_library server-side, so this is purely a
 * convenience list (never the recipient's library, never cross-club).
 */
export async function listShareableDocuments(query?: string): Promise<ShareableDocument[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? ctx.clubMemberships[0]?.clubId` fallback -- see
  // app/(app)/documents/page.tsx for why.
  const myClubId = activeClubId(ctx, activeContext)
  if (!myClubId) return []

  let q = supabase
    .from("club_documents")
    .select("id, title, category, original_filename, size_bytes")
    .eq("club_id", myClubId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(20)
  if (query && query.trim().length >= 2) q = q.ilike("title", `%${query.trim()}%`)

  const { data } = await q
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    originalFilename: d.original_filename,
    sizeBytes: d.size_bytes,
  }))
}

export type ShareDocumentResult = { ok: true } | { ok: false; error: string }

export async function shareDocumentToConversation(kind: ConversationKind, id: string, documentId: string): Promise<ShareDocumentResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { error } = await supabase.rpc("share_fixture_document", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_document_id: documentId,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}
