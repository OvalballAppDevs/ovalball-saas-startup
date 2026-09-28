import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { FolderClosed } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents/categories"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"

import { canManageTeamDocuments } from "./actions"
import { DocumentLibraryClient } from "./library-client"
import { TeamDocumentsClient } from "./team-documents-client"

export const metadata = { title: "Documents" }

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ folder?: string; team?: string }> }) {
  const { folder: folderId, team: teamId } = await searchParams
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

  // TEAM DOCUMENTS (Section 7) -- a team is a virtual/derived "folder": club_documents rows filtered
  // by team_id, never a second table and never a persisted folder row per team. This is the SAME
  // dataset Team Profile's own Documents screen reads (read_team_documents), so the two can never
  // disagree about what a team's documents are.
  if (teamId) {
    const { data: team } = await supabase
      .from("teams")
      .select("id, club_id, category, age_group, gender, squad_designation, rugby_code")
      .eq("id", teamId)
      .maybeSingle()
    if (!team || team.club_id !== myClubId) redirect("/documents")

    const teamLabel = fullTeamLabel({
      category: team.category,
      ageGroup: team.age_group,
      gender: team.gender,
      squadDesignation: team.squad_designation,
      rugbyCode: team.rugby_code,
    })

    const [{ data: teamDocuments }, canManageThisTeam] = await Promise.all([
      supabase
        .from("club_documents")
        .select("id, title, original_filename, storage_path, mime_type, size_bytes")
        .eq("team_id", teamId)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      canManageTeamDocuments(myClubId, teamId),
    ])

    const signedUrlByDoc = new Map<string, string | null>()
    for (const d of teamDocuments ?? []) {
      const { data } = await supabase.storage.from("club-documents").createSignedUrl(d.storage_path, 3600)
      signedUrlByDoc.set(d.id, data?.signedUrl ?? null)
    }

    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <div className="mb-3 flex items-center gap-1.5 text-sm">
          <Link href="/documents" className="text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Documents
          </Link>
          <span className="text-ink-muted">/</span>
          <span className="font-medium text-ink">{teamLabel}</span>
        </div>
        <h1 className="font-display text-display-l text-ink">{teamLabel}</h1>
        <p className="mt-2 max-w-lg text-sm text-ink-muted">Documents shared with this team -- the same list this team's own Team Profile shows.</p>

        <TeamDocumentsClient
          teamId={teamId}
          teamLabel={teamLabel}
          canManage={canManageThisTeam}
          documents={(teamDocuments ?? []).map((d) => ({
            id: d.id,
            title: d.title,
            originalFilename: d.original_filename,
            mimeType: d.mime_type,
            sizeBytes: d.size_bytes,
            storagePath: d.storage_path,
            signedUrl: signedUrlByDoc.get(d.id) ?? null,
          }))}
        />
      </div>
    )
  }

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

  // "TEAMS" -- shown only at the library root, never inside a general folder. Every active team is a
  // virtual folder tile (owner's stated preference: a team appears even with zero documents, so Club
  // Admin always has somewhere obvious to add one), derived from teams + a live count of its own
  // club_documents rows -- never a persisted per-team folder row.
  let teamTiles: { id: string; label: string; count: number }[] = []
  if (!folderId) {
    const [{ data: teams }, { data: teamDocCounts }] = await Promise.all([
      supabase
        .from("teams")
        .select("id, category, age_group, gender, squad_designation, rugby_code")
        .eq("club_id", myClubId)
        .eq("active", true)
        .order("category")
        .order("age_group"),
      supabase.from("club_documents").select("team_id").eq("club_id", myClubId).not("team_id", "is", null).is("archived_at", null),
    ])
    const countByTeam = new Map<string, number>()
    for (const row of teamDocCounts ?? []) {
      if (row.team_id) countByTeam.set(row.team_id, (countByTeam.get(row.team_id) ?? 0) + 1)
    }
    teamTiles = (teams ?? [])
      .map((t) => ({
        id: t.id,
        label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code }),
        count: countByTeam.get(t.id) ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{club?.club_directory?.name ?? "Your club"}</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Documents</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Important club and fixture resources -- visitor guides, ground and pitch information, parking, match-day
        documents and approved images. Files up to 10MB. Documents are private to your club unless you share one
        into a specific fixture conversation.
      </p>

      {teamTiles.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium tracking-[0.06em] text-ink-muted uppercase">Teams</p>
          <ul className="flex flex-col gap-2">
            {teamTiles.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/documents?team=${t.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <FolderClosed className="size-4 text-ink-muted" />
                  <span className="flex-1 text-sm font-medium text-ink">{t.label}</span>
                  <span className="text-xs text-ink-muted">
                    {t.count} document{t.count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!folderId && <p className="mt-6 mb-2 text-xs font-medium tracking-[0.06em] text-ink-muted uppercase">General</p>}

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
