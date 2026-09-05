import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ExternalLink, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { mapAdminClubRow } from "../query"
import { getClubTeams, getConnectedUsers, listSuspendedClubMembershipsAdmin } from "./actions"
import { AuditLog } from "./audit-log"
import { ConnectedUsers } from "./connected-users"
import { DangerZone } from "./danger-zone"
import { CheckOnlineNowButton } from "./check-online-now-button"
import { DataQualityPanel } from "./data-quality-panel"
import { DirectoryForm } from "./directory-form"
import { EnterDiagnosticButton } from "./enter-diagnostic-button"
import { LogoManager } from "./logo-manager"
import { ProfileForm } from "./profile-form"
import { ClubDetailTabs } from "./tabs"
import { TeamsPanel } from "./teams-panel"

/** NEXT_PUBLIC_SITE_URL is the deployed origin in production; local dev never hardcodes it. Mirrors submit-signup.ts's own copy of this helper. */
function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}

/** Practically unreachable (admin_club_overview is a superset view of the club_directory row we already confirmed exists), kept only as an honest fallback rather than a non-null assertion. */
const EMPTY_FLAGS = {
  missingPostcode: false,
  missingTown: false,
  missingRugbyCode: false,
  duplicateNormalizedKey: false,
  duplicateExternalId: false,
  unverified: false,
  inactive: false,
  missingWebsite: false,
  missingLogo: false,
  noPublicProfile: false,
  pendingClaim: false,
}

export default async function AdminClubDetailPage({
  params,
}: {
  params: Promise<{ directoryId: string }>
}) {
  const { directoryId } = await params
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

  const { data: directory } = await supabase.from("club_directory").select("*").eq("id", directoryId).maybeSingle()
  if (!directory) notFound()

  const { data: club } = await supabase.from("clubs").select("*").eq("directory_id", directoryId).maybeSingle()

  const [{ count: adminCount }, { data: auditRows }, { data: overviewRow }, { data: pendingClaim }, { count: anyClaimCount }] =
    await Promise.all([
      club
        ? supabase
            .from("club_memberships")
            .select("id", { count: "exact", head: true })
            .eq("club_id", club.id)
            .eq("role", "CLUB_ADMIN")
            .eq("status", "active")
        : Promise.resolve({ count: 0 }),
      supabase
        .from("audit_log")
        .select("id, action, changed_at, changed_by, before, after")
        .in("record_id", club ? [directoryId, club.id] : [directoryId])
        .order("changed_at", { ascending: false })
        .limit(15),
      supabase.from("admin_club_overview").select("*").eq("directory_id", directoryId).maybeSingle(),
      supabase.from("club_claims").select("id").eq("directory_id", directoryId).eq("status", "pending").maybeSingle(),
      supabase.from("club_claims").select("id", { count: "exact", head: true }).eq("directory_id", directoryId),
    ])

  const connectedUsers = club ? await getConnectedUsers(club.id) : []
  const teams = club ? await getClubTeams(club.id) : []
  const suspendedMemberships = club && club.status === "active" ? await listSuspendedClubMembershipsAdmin(club.id) : []
  const hasHistory = Boolean(club) || (anyClaimCount ?? 0) > 0

  const changedByIds = [...new Set((auditRows ?? []).map((r) => r.changed_by).filter((id): id is string => Boolean(id)))]
  const { data: changedByProfiles } =
    changedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", changedByIds) : { data: [] }
  const nameById = new Map((changedByProfiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  // Fallback order matches every other surface's coalesce: the activated
  // club's own upload wins, then the canonical directory crest a Site
  // Admin set (even pre-activation), then a legacy imported path.
  const logoPath = club?.logo_storage_path ?? directory.logo_storage_path
  const logoUrl = logoPath ? supabase.storage.from("club-logos").getPublicUrl(logoPath).data.publicUrl : null
  const logoProvenance: "imported" | "uploaded" | "canonical" | "none" = club?.logo_storage_path
    ? "uploaded"
    : directory.logo_storage_path
      ? "canonical"
      : club?.legacy_logo_path
        ? "imported"
        : "none"

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/clubs" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Club management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL, avoids next/image's remote-pattern config for a small thumbnail
            <img src={logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <span className="text-xs text-ink/30">No crest</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-display-l text-ink">{directory.name}</h1>
          <p className="mt-1 text-sm text-ink/55">
            {directory.rugby_code === "union" ? "Rugby Union" : "Rugby League"}
            {[directory.town, directory.county].filter(Boolean).length > 0
              ? ` · ${[directory.town, directory.county].filter(Boolean).join(", ")}`
              : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {club ? (
              <span className="rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">Activated</span>
            ) : (
              <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/60">Unclaimed</span>
            )}
            {!directory.active && (
              <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/50">Directory inactive</span>
            )}
            {club?.status === "suspended" && (
              <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">Suspended</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {club && (
            <Link
              href={`${getSiteUrl()}/club/${club.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              View public page
              <ExternalLink className="size-3.5" />
            </Link>
          )}
          {club && club.status === "active" && ctx.diagnosticClubAccess && <EnterDiagnosticButton clubId={club.id} />}
        </div>
      </div>

      {pendingClaim && (
        <Link
          href="/admin/claims"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 outline-none hover:border-amber-500/50 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          A claim on this club is awaiting review.
          <span className="font-medium underline">Review in Claims &rarr;</span>
        </Link>
      )}

      <div className="mt-8">
        <ClubDetailTabs
          panels={[
            {
              name: "Overview",
              content: (
                <div className="flex flex-col gap-8">
                  <OverviewSection directory={directory} club={club} adminCount={adminCount ?? 0} />
                  <DangerZone
                    directoryId={directory.id}
                    clubName={directory.name}
                    directoryActive={directory.active}
                    hasHistory={hasHistory}
                    activatedClub={
                      club
                        ? {
                            clubId: club.id,
                            status: club.status as "active" | "suspended" | "deactivated",
                            deactivatedAt: club.deactivated_at,
                            deactivationReason: club.deactivation_reason,
                          }
                        : null
                    }
                    initialSuspendedMemberships={suspendedMemberships}
                  />
                </div>
              ),
            },
            {
              name: "Directory",
              content: (
                <DirectoryForm
                  initial={{
                    directoryId: directory.id,
                    name: directory.name,
                    rugbyCode: directory.rugby_code as "union" | "league",
                    country: directory.country ?? "",
                    nation: directory.nation as "England" | "Scotland" | "Wales" | "Northern Ireland",
                    region: directory.region ?? "",
                    county: directory.county ?? "",
                    town: directory.town ?? "",
                    homeGround: directory.home_ground ?? "",
                    address: directory.address ?? "",
                    postcode: directory.postcode ?? "",
                    website: directory.website ?? "",
                    officialEmail: directory.official_email ?? "",
                    active: directory.active,
                    verificationStatus: directory.verification_status,
                    notes: directory.notes ?? "",
                    constituentBody: directory.constituent_body ?? "",
                  }}
                  initialProvenance={{
                    directoryId: directory.id,
                    source: directory.source,
                    externalId: directory.external_id ?? "",
                    sourceUrl: directory.source_url ?? "",
                  }}
                />
              ),
            },
            ...(club
              ? [
                  {
                    name: "Ovalball profile" as const,
                    content: (
                      <ProfileForm
                        initial={{
                          clubId: club.id,
                          directoryId: directory.id,
                          bio: club.bio ?? "",
                          website: club.website ?? "",
                          facebookUrl: club.facebook_url ?? "",
                          addressDisplay: club.address_display ?? "",
                          status: club.status as "active" | "suspended",
                          showWebsite: club.show_website,
                          showHomeGround: club.show_home_ground,
                          showAddress: club.show_address,
                          showPostcode: club.show_postcode,
                        }}
                      />
                    ),
                  },
                  {
                    name: "Users & roles" as const,
                    content: <ConnectedUsers directoryId={directory.id} users={connectedUsers} />,
                  },
                  {
                    name: "Teams" as const,
                    content: <TeamsPanel teams={teams} />,
                  },
                ]
              : []),
            {
              name: "Media" as const,
              content: (
                <LogoManager clubId={club?.id ?? null} directoryId={directory.id} initialLogoUrl={logoUrl} source={logoProvenance} />
              ),
            },
            {
              name: "Data quality" as const,
              content: (
                <div className="flex flex-col gap-4">
                  <CheckOnlineNowButton directoryId={directory.id} canRun={ctx.siteAdminRole === "full" || ctx.siteAdminRole === "club_data"} />
                  <DataQualityPanel flags={overviewRow ? mapAdminClubRow(overviewRow).flags : EMPTY_FLAGS} />
                </div>
              ),
            },
            {
              name: "Audit",
              content: (
                <AuditLog
                  entries={(auditRows ?? []).map((r) => ({
                    id: r.id,
                    action: r.action,
                    changedAt: r.changed_at,
                    changedByLabel: r.changed_by ? nameById.get(r.changed_by) || "Site Admin" : "System",
                    before: r.before,
                    after: r.after,
                  }))}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}

function OverviewSection({
  directory,
  club,
  adminCount,
}: {
  directory: { verification_status: string; source: string; created_at: string; updated_at: string }
  club: { created_at: string; slug: string } | null
  adminCount: number
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoCard label="Verification status" value={directory.verification_status.replace(/_/g, " ")} />
        <InfoCard label="Canonical source" value={directory.source.replace(/_/g, " ")} />
        <InfoCard label="Directory last updated" value={formatDate(directory.updated_at)} />
        <InfoCard label="Directory added" value={formatDate(directory.created_at)} />
        {club && (
          <>
            <InfoCard label="Activated on" value={formatDate(club.created_at)} />
            <InfoCard label="Active Club Admins" value={String(adminCount)} />
          </>
        )}
      </div>
      {!club && (
        <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-4 text-sm text-ink/55">
          This club exists only in the canonical directory &mdash; nobody has claimed it on Ovalball yet. It will
          activate automatically once a claim for it is approved.
        </p>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      <p className="mt-1 text-sm text-ink capitalize">{value}</p>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
