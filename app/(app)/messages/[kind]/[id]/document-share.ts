"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import type { ConversationKind } from "../../actions"
import { attachmentTarget } from "@/lib/messenger/target"
import { mayShareDocumentCategory } from "@ovalball/contracts/document-sharing"

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
export async function listShareableDocuments(query?: string, kind?: ConversationKind): Promise<ShareableDocument[]> {
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
  // NOT OFFERED IS BETTER THAN OFFERED AND REFUSED. The server decides, and it will refuse an
  // uncategorised document heading into a direct conversation; listing it anyway would invite somebody
  // to share a committee minute and then tell them off for trying.
  const target = kind ? attachmentTarget(kind) : null
  const filtered = (data ?? []).filter((d) =>
    target?.supported ? mayShareDocumentCategory(d.category, target.target) : true
  )
  return filtered.map((d) => ({
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

  const target = attachmentTarget(kind)
  if (!target.supported) return { ok: false, error: target.reason }

  // THE SERVER DECIDES WHETHER THIS DOCUMENT MAY GO TO THIS AUDIENCE, and for a direct conversation
  // that is a narrower question than "can the sender see it". Its refusal is passed through in its own
  // words, because "only club documents categorised for visitors and match days can be sent in a
  // direct message" tells somebody exactly what to change.
  const { error } = await supabase.rpc("share_message_document", {
    p_target_type: target.target,
    p_target_id: id,
    p_document_id: documentId,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}
