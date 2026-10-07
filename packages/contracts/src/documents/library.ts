import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { readClubAuthority } from "../club/overview"
import { fullTeamLabel } from "../teams/compact-label"
import { documentCategoryLabel, isDocumentCategory } from "./categories"

export * from "./categories"

type Client = SupabaseClient<Database>

/**
 * THE CLUB DOCUMENT LIBRARY, named once for both clients.
 *
 * One domain: `public.club_documents` and `public.document_folders` (20260831440000), the private
 * `club-documents` bucket, and the team-scoped rows that share them (20270574000000). The website's
 * Documents page (`app/(app)/documents`) and the app's Club Documents area read and write the SAME rows
 * through the SAME policies -- there is no second document store and no mobile-only shape.
 *
 * NOTHING HERE IS AUTHORITY. Row-level security decides what a person sees
 * (`internal.can_view_document_library`, capability `club.documents.view`) and what they may change
 * (`internal.can_manage_document_library`, `club.documents.manage`); storage re-derives the club from the
 * object path (`internal.can_access_document_storage_path`); `delete_club_document` re-checks again. The
 * validation below mirrors the website's server action word for word so a phone never offers an upload
 * the server is about to refuse -- it decides nothing the database does not decide again.
 *
 * NEVER SHOWN: a storage path or a bucket URL. `storagePath` travels with a document only so the client
 * can ask for a short-lived signed URL at the moment somebody opens it.
 */

export const CLUB_DOCUMENT_BUCKET = "club-documents"
/** The same hour the website signs for, with the viewer's own session. */
export const CLUB_DOCUMENT_SIGNED_URL_SECONDS = 60 * 60
export const CLUB_DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024

/** The table's own mime check for a general library file. Word is a team-document format only (`add_team_document`). */
export const CLUB_DOCUMENT_ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const
export type ClubDocumentMimeType = (typeof CLUB_DOCUMENT_ALLOWED_MIME_TYPES)[number]

const EXTENSION_BY_MIME: Record<ClubDocumentMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

/** "820 KB", "1.8 MB": enough to tell two documents apart. Null when there is nothing honest to say. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One picture for an image, one for a PDF, one for anything else -- never a bespoke icon per format. */
export function documentFileKind(mimeType: string | null | undefined): { kind: "image" | "pdf" | "word" | "file"; label: string } {
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") return { kind: "image", label: "Image" }
  if (mimeType === "application/pdf") return { kind: "pdf", label: "PDF" }
  if (mimeType === "application/msword" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return { kind: "word", label: "Word Document" }
  return { kind: "file", label: "Document" }
}

/** The website's own refusals, in its own words (`uploadClubDocument`). Null when the file may be offered. */
export function validateClubDocumentFile(file: { mimeType: string | null | undefined; sizeBytes: number | null | undefined }): string | null {
  if (!file.mimeType || !(CLUB_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    return "Unsupported file type. Upload a PDF, JPEG, PNG, or WEBP."
  }
  if (typeof file.sizeBytes !== "number" || file.sizeBytes <= 0) return "That file appears to be empty."
  if (file.sizeBytes > CLUB_DOCUMENT_MAX_SIZE_BYTES) return "Documents must be 10MB or smaller."
  return null
}

/** The title a picked file starts with: its name without the extension, as the website does. */
export function defaultDocumentTitle(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim()
}

/**
 * Search text made safe to place inside a PostgREST `or(...)` filter. A comma or a bracket would end the
 * filter early and turn somebody's search into a different query; `%`/`*`/`_` would become wildcards.
 */
export function librarySearchNeedle(query: string | null | undefined): string {
  return (query ?? "").replace(/[,()%*_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
}

/** "Shared in 2 conversations" -- the reason a document cannot be permanently deleted. */
export function shareCountLabel(count: number): string | null {
  if (!count || count <= 0) return null
  return `Shared in ${count} conversation${count === 1 ? "" : "s"}`
}

export interface LibraryFolder {
  id: string
  name: string
  parentFolderId: string | null
}

/** Every folder with its full path ("Match Day / Parking"), sorted, for a Move or Upload destination picker. */
export function folderPaths(folders: LibraryFolder[]): { id: string; path: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (id: string, seen: Set<string>): string => {
    const f = byId.get(id)
    if (!f) return ""
    if (!f.parentFolderId || seen.has(f.parentFolderId) || !byId.has(f.parentFolderId)) return f.name
    seen.add(id)
    return `${pathOf(f.parentFolderId, seen)} / ${f.name}`
  }
  return folders.map((f) => ({ id: f.id, path: pathOf(f.id, new Set()) })).sort((a, b) => a.path.localeCompare(b.path))
}

/** The folders from the library's root down to (and including) `folderId`. Empty at the root. */
export function folderTrail(folders: LibraryFolder[], folderId: string | null | undefined): LibraryFolder[] {
  if (!folderId) return []
  const byId = new Map(folders.map((f) => [f.id, f]))
  const trail: LibraryFolder[] = []
  const seen = new Set<string>()
  let cursor = byId.get(folderId)
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    trail.unshift(cursor)
    cursor = cursor.parentFolderId ? byId.get(cursor.parentFolderId) : undefined
  }
  return trail
}

/** One error rule: the server's own sentence where it wrote one for a person, otherwise the caller's. */
export function clubDocumentErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501") return "You don't have permission to change this club's documents."
  if ((e.code === "P0001" || e.code === "22023" || e.code === "23514") && e.message) return e.message
  return fallback
}

export interface LibraryDocument {
  id: string
  title: string
  description: string | null
  category: string
  categoryLabel: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  folderId: string | null
  teamId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  /** Only to ask for a signed URL when somebody opens it. Never rendered. */
  storagePath: string
  /** Conversations this viewer can see that the document has been shared into. */
  shareCount: number
}

/** A team's documents, presented as a folder: derived from `club_documents.team_id`, never a stored folder row. */
export interface LibraryTeamFolder {
  id: string
  label: string
  count: number
}

export interface ClubLibrary {
  /** Folders directly inside the one being viewed (none while searching or viewing the archive). */
  folders: LibraryFolder[]
  /** Every live folder in the club's library, for paths and destination pickers. */
  allFolders: LibraryFolder[]
  currentFolder: LibraryFolder | null
  /** Root to current folder. */
  trail: LibraryFolder[]
  documents: LibraryDocument[]
  /** At the library's root only: each active team as a virtual folder, as the website shows them. */
  teams: LibraryTeamFolder[]
}

const DOCUMENT_COLUMNS =
  "id, title, description, category, original_filename, storage_path, mime_type, size_bytes, folder_id, team_id, created_at, updated_at, archived_at"

/** Every live folder in the club's library -- for paths and for an Upload or Move destination. */
export async function readLibraryFolders(supabase: Client, clubId: string): Promise<LibraryFolder[]> {
  const { data, error } = await supabase.from("document_folders").select("id, name, parent_folder_id").eq("club_id", clubId).is("archived_at", null).order("name")
  if (error) throw error
  return (data ?? []).map((f) => ({ id: f.id, name: f.name, parentFolderId: f.parent_folder_id }))
}

/**
 * One view of the club's library.
 *
 *   folderId  the folder being looked at (the root when absent)
 *   query     searches titles and filenames across the WHOLE library, team documents included
 *   archived  the archive instead: every archived document in the club, wherever it was filed
 *
 * Filtered by club in the query, deliberately: `club_documents_select_shared` also lets somebody read a
 * document that was shared INTO a conversation they are in, and another club's visitor guide must never
 * appear in this club's library.
 *
 * Team documents are listed under their team, not loose at the root: a team document has `folder_id`
 * null by construction (`club_documents_team_xor_folder`), so the root list excludes `team_id` rows.
 */
export async function readClubLibrary(
  supabase: Client,
  clubId: string,
  options: { folderId?: string | null; query?: string | null; archived?: boolean } = {}
): Promise<ClubLibrary> {
  const folderId = options.folderId ?? null
  const needle = librarySearchNeedle(options.query)
  const archived = options.archived === true
  const flat = archived || needle.length > 0

  let documentsQuery = supabase.from("club_documents").select(DOCUMENT_COLUMNS).eq("club_id", clubId)
  documentsQuery = archived ? documentsQuery.not("archived_at", "is", null) : documentsQuery.is("archived_at", null)
  if (needle) documentsQuery = documentsQuery.or(`title.ilike.%${needle}%,original_filename.ilike.%${needle}%`)
  if (!flat) {
    documentsQuery = folderId ? documentsQuery.eq("folder_id", folderId) : documentsQuery.is("folder_id", null).is("team_id", null)
  }
  documentsQuery = documentsQuery.order(archived ? "archived_at" : "updated_at", { ascending: false }).limit(200)

  const [allFolders, documentsResult] = await Promise.all([readLibraryFolders(supabase, clubId), documentsQuery])
  if (documentsResult.error) throw documentsResult.error

  const rows = documentsResult.data ?? []

  // Shared-in counts, batched for the visible page -- the reason Delete is refused, said before it is.
  const shareCounts = new Map<string, number>()
  if (rows.length > 0) {
    const { data: refs } = await supabase
      .from("fixture_message_document_refs")
      .select("document_id")
      .in("document_id", rows.map((r) => r.id))
    for (const r of refs ?? []) shareCounts.set(r.document_id, (shareCounts.get(r.document_id) ?? 0) + 1)
  }

  let teams: LibraryTeamFolder[] = []
  if (!flat && !folderId) {
    const [teamsResult, countsResult] = await Promise.all([
      supabase.from("teams").select("id, category, age_group, gender, squad_designation, rugby_code").eq("club_id", clubId).eq("active", true),
      supabase.from("club_documents").select("team_id").eq("club_id", clubId).not("team_id", "is", null).is("archived_at", null),
    ])
    const countByTeam = new Map<string, number>()
    for (const row of countsResult.data ?? []) if (row.team_id) countByTeam.set(row.team_id, (countByTeam.get(row.team_id) ?? 0) + 1)
    teams = (teamsResult.data ?? [])
      .map((t) => ({
        id: t.id,
        label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code }),
        count: countByTeam.get(t.id) ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  const currentFolder = folderId ? allFolders.find((f) => f.id === folderId) ?? null : null
  return {
    folders: flat ? [] : allFolders.filter((f) => f.parentFolderId === folderId),
    allFolders,
    currentFolder,
    trail: folderTrail(allFolders, folderId),
    documents: rows.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      category: d.category,
      categoryLabel: documentCategoryLabel(d.category),
      originalFilename: d.original_filename,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      folderId: d.folder_id,
      teamId: d.team_id,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      archivedAt: d.archived_at,
      storagePath: d.storage_path,
      shareCount: shareCounts.get(d.id) ?? 0,
    })),
    teams,
  }
}

/**
 * Whether this person may see and may change the club's library -- one `my_capabilities` probe, through
 * the shared club authority reader. What it SHOWS only: every read and write is judged again by RLS.
 */
export async function readClubLibraryAuthority(supabase: Client, clubId: string): Promise<{ view: boolean; manage: boolean }> {
  const authority = await readClubAuthority(supabase, clubId)
  return { view: authority.documentsView || authority.documentsManage, manage: authority.documentsManage }
}

/** A short-lived URL for opening one document, signed with the viewer's own session, at the moment it is opened. */
export async function signDocumentUrl(supabase: Client, storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(CLUB_DOCUMENT_BUCKET).createSignedUrl(storagePath, CLUB_DOCUMENT_SIGNED_URL_SECONDS)
  if (error) return null
  return data?.signedUrl ?? null
}

export type LibraryResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; message: string }

/**
 * Upload, then record -- the website's order. A failed upload never creates a record; a refused record
 * removes the object it would have pointed at. The path is `{club_id}/{uuid}.{ext}`, the general-file
 * shape the storage policy recognises.
 */
export async function uploadClubDocument(
  supabase: Client,
  input: {
    clubId: string
    folderId: string | null
    title: string
    category: string
    description?: string | null
    file: { bytes: ArrayBuffer; mimeType: string; name: string; sizeBytes: number }
  }
): Promise<LibraryResult<{ id: string }>> {
  const title = input.title.trim()
  if (!title) return { ok: false, message: "A title is required." }
  const invalid = validateClubDocumentFile({ mimeType: input.file.mimeType, sizeBytes: input.file.sizeBytes })
  if (invalid) return { ok: false, message: invalid }
  const category = isDocumentCategory(input.category) ? input.category : "other"

  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) return { ok: false, message: "Not signed in." }

  const extension = EXTENSION_BY_MIME[input.file.mimeType as ClubDocumentMimeType]
  const storagePath = `${input.clubId}/${randomId()}.${extension}`
  const { error: uploadError } = await supabase.storage
    .from(CLUB_DOCUMENT_BUCKET)
    .upload(storagePath, input.file.bytes, { contentType: input.file.mimeType, upsert: false })
  if (uploadError) return { ok: false, message: "Couldn't upload that file. Please try again." }

  const { data, error } = await supabase
    .from("club_documents")
    .insert({
      club_id: input.clubId,
      folder_id: input.folderId,
      title,
      description: input.description?.trim() || null,
      category,
      original_filename: input.file.name,
      storage_path: storagePath,
      mime_type: input.file.mimeType,
      size_bytes: input.file.sizeBytes,
      uploaded_by: userId,
    })
    .select("id")
    .single()
  if (error || !data) {
    await supabase.storage.from(CLUB_DOCUMENT_BUCKET).remove([storagePath])
    return { ok: false, message: clubDocumentErrorMessage(error, "That document couldn't be added.") }
  }
  return { ok: true, id: data.id }
}

/** Archive or restore. Archived documents leave the library and cannot be shared, but are kept. */
export async function setDocumentArchived(supabase: Client, clubId: string, documentId: string, archived: boolean): Promise<LibraryResult> {
  const { data, error } = await supabase
    .from("club_documents")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", documentId)
    .eq("club_id", clubId)
    .select("id")
  if (error) return { ok: false, message: clubDocumentErrorMessage(error, archived ? "That document couldn't be archived." : "That document couldn't be restored.") }
  // RLS hides a refused update as zero rows rather than an error; say so rather than pretend it worked.
  if (!data || data.length === 0) return { ok: false, message: "You don't have permission to change this club's documents." }
  return { ok: true }
}

/** File a document in a folder, or at the library's root (`folderId` null). */
export async function moveClubDocument(supabase: Client, clubId: string, documentId: string, folderId: string | null): Promise<LibraryResult> {
  const { data, error } = await supabase.from("club_documents").update({ folder_id: folderId }).eq("id", documentId).eq("club_id", clubId).select("id")
  if (error) return { ok: false, message: clubDocumentErrorMessage(error, "That document couldn't be moved.") }
  if (!data || data.length === 0) return { ok: false, message: "You don't have permission to change this club's documents." }
  return { ok: true }
}

/**
 * Permanent delete, through the ONE canonical RPC every caller uses -- refused by the server while the
 * document is shared into any conversation (archive it instead). The storage object is then removed,
 * best effort, exactly as Team Documents already does (`deleteTeamDocument`).
 */
export async function deleteClubDocument(supabase: Client, documentId: string, storagePath: string): Promise<LibraryResult> {
  const { error } = await supabase.rpc("delete_club_document", { p_document_id: documentId })
  if (error) return { ok: false, message: clubDocumentErrorMessage(error, "That document couldn't be deleted.") }
  await supabase.storage.from(CLUB_DOCUMENT_BUCKET).remove([storagePath])
  return { ok: true }
}

export async function createFolder(supabase: Client, clubId: string, parentFolderId: string | null, name: string): Promise<LibraryResult<{ id: string }>> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, message: "A folder name is required." }
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from("document_folders")
    .insert({ club_id: clubId, parent_folder_id: parentFolderId, name: trimmed, created_by: auth.user?.id ?? null })
    .select("id")
    .single()
  if (error || !data) return { ok: false, message: clubDocumentErrorMessage(error, "That folder couldn't be created.") }
  return { ok: true, id: data.id }
}

/** `globalThis.crypto` is undefined in the Hermes runtime, so `crypto.randomUUID()` would crash an upload.
 * Only uniqueness is needed for an object name, not unpredictability -- the bucket is private. */
function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (n: number) => Array.from({ length: n }, hex).join("")
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${variant}${segment(3)}-${segment(12)}`
}
