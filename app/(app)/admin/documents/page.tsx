import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AdminDocumentsTable } from "./table"

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; club?: string }>
}) {
  const { q, club: clubFilter } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx
  const canManage = ctx.siteAdminRole === "full" || ctx.siteAdminRole === "club_data"

  let query = supabase
    .from("club_documents")
    .select(
      "id, title, category, original_filename, mime_type, size_bytes, uploaded_by, updated_at, archived_at, club_id, directory_id, clubs(club_directory(name)), club_directory(name)"
    )
    .order("updated_at", { ascending: false })
    .limit(200)

  if (q && q.length >= 2) query = query.ilike("title", `%${q}%`)
  if (clubFilter) query = query.or(`club_id.eq.${clubFilter},directory_id.eq.${clubFilter}`)

  const { data: rows } = await query

  const uploaderIds = [...new Set((rows ?? []).map((r) => r.uploaded_by).filter(Boolean))]
  const { data: profiles } =
    uploaderIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", uploaderIds) : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Site Admin"]))

  const docIds = (rows ?? []).map((r) => r.id)
  const { data: refCounts } =
    docIds.length > 0 ? await supabase.from("fixture_message_document_refs").select("document_id").in("document_id", docIds) : { data: [] }
  const usageByDoc = new Map<string, number>()
  for (const r of refCounts ?? []) usageByDoc.set(r.document_id, (usageByDoc.get(r.document_id) ?? 0) + 1)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Documents</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">
        Cross-club document management -- visitor guides, ground information, and other fixture resources every
        club library holds.
      </p>

      <AdminDocumentsTable
        canManage={canManage}
        query={q ?? ""}
        rows={(rows ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          filename: r.original_filename,
          mimeType: r.mime_type,
          sizeBytes: r.size_bytes,
          clubName: r.clubs?.club_directory?.name ?? r.club_directory?.name ?? "Unknown",
          uploadedByName: nameById.get(r.uploaded_by) ?? "Unknown",
          updatedAt: r.updated_at,
          archived: Boolean(r.archived_at),
          usageCount: usageByDoc.get(r.id) ?? 0,
        }))}
      />
    </div>
  )
}
