import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * TEAM DOCUMENTS -- Team Profile Section 7, converging on the SAME canonical Club Document Library
 * (`club_documents`, 20260831440000) Club Documents itself shows, never a second document system. A
 * "team folder" is virtual/derived: it is simply `club_documents` filtered by `team_id`, so this reader
 * and the Club Documents web/mobile surfaces reading the same rows can never disagree. `team_id` is a
 * stable identifier on the canonical team row itself, never the team's display name, so a Season
 * Handover rename never requires touching a single document (`20270574000000`).
 *
 * PRIVATE BUCKET, SIGNED URLS ONLY -- the SAME `club-documents` bucket general club files already use,
 * extended with a second, team-scoped path shape (`{club_id}/{team_id}/{uuid}.{ext}`).
 */
const SIGNED_URL_SECONDS = 60 * 60

export const TEAM_DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const

export const TEAM_DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024

export interface TeamDocumentItem {
  id: string
  title: string
  originalFilename: string
  storagePath: string
  mimeType: string
  sizeBytes: number
  uploadedBy: string
  createdAt: string
  url: string | null
}

/**
 * Raises outright (42501) when the viewer has no authority for this team at all -- never a silent
 * empty list, matching `read_team_media`/`read_team_staff`'s own established shape. The caller is
 * responsible for telling "no documents shared with you" (authority refused) apart from "no team
 * documents yet" (authorised, genuinely empty) -- see `teamDocumentErrorMessage`.
 */
export async function readTeamDocuments(supabase: Client, teamId: string): Promise<TeamDocumentItem[]> {
  const { data, error } = await supabase.rpc("read_team_documents", { p_team_id: teamId })
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const { data: signed } = await supabase.storage
    .from("club-documents")
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_SECONDS)
  const urls = new Map<string, string>()
  for (const row of signed ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    originalFilename: r.original_filename,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
    url: urls.get(r.storage_path) ?? null,
  }))
}

/** One error rule, matching team_media/team_staff's own. */
export function teamDocumentErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

/** True only when the RPC itself refused for lack of authority (42501) -- the caller's cue to show
 * "No documents shared with you" rather than "No team documents yet", so a viewer who can see nothing
 * is never told, one way or the other, whether hidden documents exist. */
export function isTeamDocumentAuthorityError(error: unknown): boolean {
  return ((error ?? {}) as { code?: string }).code === "42501"
}

/**
 * Upload-then-link, the same order `addTeamMediaPhoto`/`replaceClubCrest` already use: a failed link
 * never leaves the canonical library pointing at nothing, and a failed upload never creates an orphan
 * record. The storage policy re-derives club/team from the path itself
 * (`internal.can_access_document_storage_path`) and `add_team_document` re-checks the same authority
 * again -- the client's own belief about `canManage` decides nothing.
 */
export async function addTeamDocument(
  supabase: Client,
  clubId: string,
  teamId: string,
  file: { bytes: ArrayBuffer; contentType: string; originalFilename: string; sizeBytes: number },
  title: string
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const ext = extensionFor(file.contentType, file.originalFilename)
  const path = `${clubId}/${teamId}/${cryptoRandomId()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from("club-documents")
    .upload(path, file.bytes, { contentType: file.contentType, upsert: false })
  if (uploadError) return { ok: false, message: teamDocumentErrorMessage(uploadError, "That file couldn't be uploaded.") }

  const { data, error } = await supabase.rpc("add_team_document", {
    p_team_id: teamId,
    p_storage_path: path,
    p_title: title,
    p_original_filename: file.originalFilename,
    p_mime_type: file.contentType,
    p_size_bytes: file.sizeBytes,
  })
  if (error || !data) {
    await supabase.storage.from("club-documents").remove([path])
    return { ok: false, message: teamDocumentErrorMessage(error, "That document couldn't be added.") }
  }
  return { ok: true, id: data }
}

/** Deletes the ONE canonical record via the SAME `delete_club_document` RPC Club Documents already
 * uses -- never a second delete path for team documents -- then best-effort removes the storage
 * object. Refused outright (with no deletion) when the document has been shared in a fixture
 * conversation, matching every other caller of this RPC. */
export async function deleteTeamDocument(supabase: Client, documentId: string, storagePath: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("delete_club_document", { p_document_id: documentId })
  if (error) return { ok: false, message: teamDocumentErrorMessage(error, "That document couldn't be deleted.") }
  await supabase.storage.from("club-documents").remove([storagePath])
  return { ok: true }
}

function extensionFor(contentType: string, originalFilename: string): string {
  const byType: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  }
  if (byType[contentType]) return byType[contentType]
  const fromName = originalFilename.split(".").pop()
  return fromName && fromName.length <= 5 ? fromName.toLowerCase() : "bin"
}

/** Same rationale as `media.ts`'s own `cryptoRandomId`: `globalThis.crypto` is undefined in this
 * Hermes runtime with no polyfill installed, so `crypto.randomUUID()` crashes every upload. Only
 * uniqueness is required here, not cryptographic unpredictability. */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (n: number) => Array.from({ length: n }, hex).join("")
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${variant}${segment(3)}-${segment(12)}`
}
