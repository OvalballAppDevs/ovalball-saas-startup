"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

export type DocActionResult = { ok: true } | { ok: false; error: string }

const MAX_DOC_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

async function requireManageableClub(): Promise<{ ok: true; clubId: string; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- that resolved to whichever
  // club-admin/fixture-secretary membership happened to be first in the
  // session, regardless of which club is actually active. A Parent View or
  // a different club's Team Admin context must never be able to upload,
  // delete, or reorganise a DIFFERENT club's document library just because
  // this account also manages it elsewhere. See app/(app)/people/page.tsx
  // for the identical, live-confirmed leak this mirrors.
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) return { ok: false, error: "You don't have permission to manage this club's document library." }
  return { ok: true, clubId, userId: user.id }
}

export async function uploadClubDocument(formData: FormData): Promise<DocActionResult> {
  const auth = await requireManageableClub()
  if (!auth.ok) return auth

  const file = formData.get("file")
  const title = String(formData.get("title") ?? "").trim()
  const category = String(formData.get("category") ?? "other")
  const description = String(formData.get("description") ?? "").trim()
  const folderId = String(formData.get("folderId") ?? "") || null

  if (!(file instanceof File)) return { ok: false, error: "No file provided." }
  if (!title) return { ok: false, error: "A title is required." }
  const extension = ALLOWED_MIME[file.type]
  if (!extension) return { ok: false, error: "Unsupported file type. Upload a PDF, JPEG, PNG, or WEBP." }
  if (file.size > MAX_DOC_BYTES) return { ok: false, error: "Documents must be 10MB or smaller." }
  if (file.size <= 0) return { ok: false, error: "That file appears to be empty." }

  const supabase = await createClient()
  const storagePath = `${auth.clubId}/${crypto.randomUUID()}.${extension}`
  const bytes = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from("club-documents")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false })
  if (uploadError) return { ok: false, error: "Couldn't upload that file -- please try again." }

  const { error: insertError } = await supabase.from("club_documents").insert({
    club_id: auth.clubId,
    folder_id: folderId,
    title,
    description: description || null,
    category,
    original_filename: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: auth.userId,
  })
  if (insertError) {
    await supabase.storage.from("club-documents").remove([storagePath])
    return { ok: false, error: insertError.message }
  }

  revalidatePath("/documents")
  return { ok: true }
}

export async function createDocumentFolder(name: string, parentFolderId: string | null): Promise<DocActionResult> {
  const auth = await requireManageableClub()
  if (!auth.ok) return auth
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: "A folder name is required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("document_folders")
    .insert({ club_id: auth.clubId, parent_folder_id: parentFolderId, name: trimmed, created_by: auth.userId })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/documents")
  return { ok: true }
}

export async function moveClubDocument(documentId: string, folderId: string | null): Promise<DocActionResult> {
  const auth = await requireManageableClub()
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase.from("club_documents").update({ folder_id: folderId }).eq("id", documentId).eq("club_id", auth.clubId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/documents")
  return { ok: true }
}

export async function archiveClubDocument(documentId: string, archive: boolean): Promise<DocActionResult> {
  const auth = await requireManageableClub()
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase
    .from("club_documents")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", documentId)
    .eq("club_id", auth.clubId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/documents")
  return { ok: true }
}

export async function deleteClubDocument(documentId: string): Promise<DocActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_club_document", { p_document_id: documentId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/documents")
  return { ok: true }
}
