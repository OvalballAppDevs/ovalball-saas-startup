import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { getClubDirectoryOptions, getConversationLog, getGlobalMessagePolicy, getMessageAnalytics, getTeamOptions, type MessageFilters } from "./query"
import { PolicyPanel } from "./policy-panel"
import { MessageFiltersBar } from "./filters"
import { ConversationTable } from "./conversation-table"
import { CsvExportButton } from "./csv-export-button"

const PAGE_SIZE = 25

const ANALYTICS_TILES: { key: string; label: string }[] = [
  { key: "total_messages", label: "Total messages (all time)" },
  { key: "messages_in_range", label: "Messages in range" },
  { key: "conversation_count", label: "Conversations" },
  { key: "active_conversation_count", label: "Active (last 14 days)" },
  { key: "participating_club_count", label: "Participating clubs" },
  { key: "participating_team_count", label: "Participating teams" },
  { key: "direct_attachment_count", label: "Direct attachments" },
  { key: "image_upload_count", label: "Images uploaded" },
  { key: "other_file_upload_count", label: "Other files uploaded" },
  { key: "library_share_count", label: "Library documents shared" },
  { key: "contact_card_count", label: "Contact cards shared" },
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams
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

  const canRevealContent = ctx.siteAdminRole === "full" || ctx.siteAdminRole === "message_moderator"
  const canEditGlobalPolicy = ctx.siteAdminRole === "full"

  const filters: MessageFilters = {
    dateFrom: params.from || null,
    dateTo: params.to || null,
    clubId: params.club || null,
    teamId: params.team || null,
    conversationType: (params.type as "fixture" | "request" | undefined) || null,
  }
  const page = Math.max(1, Number(params.page) || 1)

  const [policy, analytics, log, clubOptions, teamOptions] = await Promise.all([
    getGlobalMessagePolicy(supabase),
    getMessageAnalytics(supabase, filters),
    getConversationLog(supabase, filters, page, PAGE_SIZE),
    getClubDirectoryOptions(supabase),
    getTeamOptions(supabase, filters.clubId),
  ])

  const logoUrl = (path: string | null) => (path ? supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl : null)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400">
        <ChevronLeft className="size-4" />
        Site Admin
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Message Management</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/55">
        Operational moderation and policy for fixture messaging -- metadata is visible to every Site Admin profile;
        actual message content is available only to Full Site Admin and Message Moderator, and every reveal is
        audited.
      </p>

      {policy && (
        <div className="mt-6">
          <PolicyPanel
            canEdit={canEditGlobalPolicy}
            initial={{
              allowDirectAttachments: policy.allow_direct_attachments ?? true,
              allowDocumentLibrarySharing: policy.allow_document_library_sharing ?? true,
              allowImageUploads: policy.allow_image_uploads ?? true,
              allowContactCardSharing: policy.allow_contact_card_sharing ?? true,
              allowParticipantManagement: policy.allow_participant_management ?? true,
              allowDirectAttachmentsClubOverrideAllowed: policy.allow_direct_attachments_club_override_allowed ?? true,
              allowDocumentLibrarySharingClubOverrideAllowed: policy.allow_document_library_sharing_club_override_allowed ?? true,
              allowImageUploadsClubOverrideAllowed: policy.allow_image_uploads_club_override_allowed ?? true,
              allowContactCardSharingClubOverrideAllowed: policy.allow_contact_card_sharing_club_override_allowed ?? true,
              allowParticipantManagementClubOverrideAllowed: policy.allow_participant_management_club_override_allowed ?? true,
              maxAttachmentSizeBytes: policy.max_attachment_size_bytes ?? 2097152,
              allowedFileTypes: policy.allowed_file_types ?? ["application/pdf", "image/jpeg", "image/png", "image/webp"],
            }}
          />
        </div>
      )}

      <div className="mt-10">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Analytics</p>
        {analytics && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {ANALYTICS_TILES.map((tile) => (
              <div key={tile.key} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                <p className="text-2xl font-semibold text-ink">{String(analytics[tile.key as keyof typeof analytics] ?? 0)}</p>
                <p className="mt-0.5 text-xs text-ink/50">{tile.label}</p>
              </div>
            ))}
            <div className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
              <p className="text-2xl font-semibold text-ink">{formatBytes(analytics.attachment_storage_bytes ?? 0)}</p>
              <p className="mt-0.5 text-xs text-ink/50">Stored attachment bytes (real files only)</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Conversation log ({log.count})</p>
          <CsvExportButton rows={log.rows} />
        </div>
        <div className="mt-3">
          <MessageFiltersBar clubOptions={clubOptions} teamOptions={teamOptions} />
        </div>
        <ConversationTable rows={log.rows} canRevealContent={canRevealContent} logoUrl={logoUrl} />
      </div>
    </div>
  )
}
