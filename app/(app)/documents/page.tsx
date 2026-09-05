import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents/categories"
import { createClient } from "@/lib/supabase/server"

import { DocumentLibraryClient } from "./library-client"

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { folder: folderId } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? ctx.clubMemberships[0]?.clubId` fallback -- activeClubId()
  // already returns null for every case with no real ambient club scope
  // (Site Admin, or nothing switchable); falling further back to "the
  // first club membership this session happens to hold" would show a
  // Site Admin who also happens to be a Club Admin somewhere that OTHER
  // club's private document library while switched into Site Admin.
  const myClubId = activeClubId(ctx, activeContext)
  if (!myClubId) redirect("/dashboard")

  const canManage = activeManageableClubId(ctx, activeContext) === myClubId

  let documentsQuery = supabase
    .from("club_documents")
    .select("id, title, description, category, original_filename, storage_path, mime_type, size_bytes, folder_id, archived_at, updated_at")
    .eq("club_id", myClubId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
  documentsQuery = folderId ? documentsQuery.eq("folder_id", folderId) : documentsQuery.is("folder_id", null)

  const [{ data: folders }, { data: documents }, { data: club }] = await Promise.all([
    supabase.from("document_folders").select("id, name, parent_folder_id").eq("club_id", myClubId).is("archived_at", null).order("name"),
    documentsQuery,
    supabase.from("clubs").select("club_directory(name)").eq("id", myClubId).maybeSingle(),
  ])

  // Usage (shared-in-N-conversations) counts, batched for the visible page.
  const docIds = (documents ?? []).map((d) => d.id)
  const { data: refCounts } =
    docIds.length > 0 ? await supabase.from("fixture_message_document_refs").select("document_id").in("document_id", docIds) : { data: [] }
  const usageByDoc = new Map<string, number>()
  for (const r of refCounts ?? []) usageByDoc.set(r.document_id, (usageByDoc.get(r.document_id) ?? 0) + 1)

  const childFolders = (folders ?? []).filter((f) => f.parent_folder_id === (folderId ?? null))
  const currentFolder = folderId ? (folders ?? []).find((f) => f.id === folderId) : null

  // Full-path folder list for the "Move to..." picker -- every folder in
  // the club's library needs to be a valid destination, not just the ones
  // visible at the current level.
  const folderById = new Map((folders ?? []).map((f) => [f.id, f]))
  function folderPath(id: string): string {
    const f = folderById.get(id)
    if (!f) return "Unknown folder"
    return f.parent_folder_id ? `${folderPath(f.parent_folder_id)} / ${f.name}` : f.name
  }
  const allFolders = (folders ?? []).map((f) => ({ id: f.id, path: folderPath(f.id) })).sort((a, b) => a.path.localeCompare(b.path))

  const signedUrlByDoc = new Map<string, string | null>()
  for (const d of documents ?? []) {
    const { data } = await supabase.storage.from("club-documents").createSignedUrl(d.storage_path, 3600)
    signedUrlByDoc.set(d.id, data?.signedUrl ?? null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{club?.club_directory?.name ?? "Your club"}</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Documents</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">
        Important club and fixture resources -- visitor guides, ground and pitch information, parking, match-day
        documents and approved images. Files up to 10MB. Documents are private to your club unless you share one
        into a specific fixture conversation.
      </p>

      <DocumentLibraryClient
        canManage={canManage}
        currentFolderId={folderId ?? null}
        currentFolderName={currentFolder?.name ?? null}
        folders={childFolders}
        allFolders={allFolders}
        documents={(documents ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          description: d.description,
          category: d.category,
          categoryLabel: DOCUMENT_CATEGORY_LABEL[d.category] ?? d.category,
          originalFilename: d.original_filename,
          mimeType: d.mime_type,
          sizeBytes: d.size_bytes,
          folderId: d.folder_id,
          updatedAt: d.updated_at,
          usageCount: usageByDoc.get(d.id) ?? 0,
          signedUrl: signedUrlByDoc.get(d.id) ?? null,
        }))}
      />
    </div>
  )
}
