import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AuditLog } from "../../clubs/[directoryId]/audit-log"
import { mapAdminUserRow } from "../query"
import { AccountStatusControl } from "./account-status-control"
import { MembershipCard } from "./membership-card"
import { PersonalDetailsPanel } from "./personal-details-panel"
import { SiteAdminControl } from "./site-admin-control"

const PENDING_LABEL: Record<string, string> = { claim: "Pending club claim", join_request: "Pending join request" }

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
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

  const { data: overviewRow } = await supabase.from("admin_user_overview").select("*").eq("user_id", userId).maybeSingle()
  if (!overviewRow) notFound()

  const person = mapAdminUserRow(overviewRow)

  const auditRecordIds = [userId, ...person.memberships.map((m) => m.membershipId)]
  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("id, table_name, action, changed_at, changed_by, before, after")
    .in("record_id", auditRecordIds)
    .in("table_name", ["profiles", "site_admins", "club_memberships"])
    .order("changed_at", { ascending: false })
    .limit(20)

  const changedByIds = [...new Set((auditRows ?? []).map((r) => r.changed_by).filter((id): id is string => Boolean(id)))]
  const { data: changedByProfiles } =
    changedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", changedByIds) : { data: [] }
  const nameById = new Map((changedByProfiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        User management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <h1 className="mt-3 font-display text-display-l text-ink">{person.name}</h1>
      <p className="mt-1 text-sm text-ink/55">{person.email}</p>

      <div className="mt-8 flex flex-col gap-8">
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Account</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoCard label="Account created" value={formatDate(person.createdAt)} />
            <InfoCard
              label="Status"
              value={
                person.accountStatus === "suspended"
                  ? "Suspended"
                  : person.isSiteAdmin
                    ? "Site Admin"
                    : person.hasActiveMembership
                      ? "Active member"
                      : person.hasPendingRequest
                        ? "Pending"
                        : "No club access"
              }
            />
          </div>
          <div className="mt-4">
            <PersonalDetailsPanel userId={person.userId} />
          </div>
          <div className="mt-4">
            <AccountStatusControl userId={person.userId} userName={person.name} status={person.accountStatus} isSelf={person.userId === user.id} />
          </div>
        </section>

        <section>
          <SiteAdminControl userId={person.userId} isSiteAdmin={person.isSiteAdmin} isSelf={person.userId === user.id} />
        </section>

        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Club memberships</h2>
          <p className="mt-1 text-sm text-ink/50">
            Ovalball access, real-world club role, and team scope are three separate things &mdash; each shown and
            edited on its own.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {person.memberships.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink/50">
                No club memberships.
              </p>
            ) : (
              person.memberships.map((m) => <MembershipCard key={m.membershipId} userId={person.userId} userName={person.name} membership={m} />)
            )}
          </div>
        </section>

        {person.pendingRequests.length > 0 && (
          <section>
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Pending requests</h2>
            <p className="mt-1 text-sm text-ink/50">No authority is granted until these are approved &mdash; reviewed in Claims, not here.</p>
            <div className="mt-3 flex flex-col gap-2">
              {person.pendingRequests.map((r, i) => (
                <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                  <p className="text-sm font-medium text-ink">{PENDING_LABEL[r.type] ?? r.type}</p>
                  <p className="text-sm text-ink/60">
                    {r.clubName} &middot; {r.role}
                  </p>
                </div>
              ))}
              <Link href="/admin/claims" className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                Review in Claims &rarr;
              </Link>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Audit</h2>
          <div className="mt-3">
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
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
