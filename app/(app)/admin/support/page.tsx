import { redirect } from "next/navigation"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { supportAccessLevel } from "@/lib/support/access"
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS } from "@/lib/support/types"
import { createClient } from "@/lib/supabase/server"

import { Pagination } from "../pagination"
import { ExportCsvButton } from "./export-csv-button"
import { fetchAdminSupportTickets, fetchSupportStatusCounts, parseAdminSupportQuery } from "./query"
import { SupportFilters } from "./support-filters"

const STATUS_BADGE_STYLE: Record<string, string> = {
  new: "bg-pitch-600/12 text-forest-800",
  in_progress: "bg-amber-500/15 text-amber-800",
  closed: "bg-ink/8 text-ink/55",
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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

  const access = supportAccessLevel(ctx)
  const query = parseAdminSupportQuery(await searchParams)

  if (access === "none") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center md:px-8">
        <ShieldCheck className="mx-auto size-8 text-ink/30" />
        <p className="mt-3 text-sm text-ink/55">Your Site Admin profile doesn&apos;t include Support access.</p>
      </div>
    )
  }

  const [{ rows, total }, counts] = await Promise.all([fetchAdminSupportTickets(supabase, query), fetchSupportStatusCounts(supabase)])
  const totalPages = Math.max(1, Math.ceil(total / query.size))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Support</h1>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-2xl font-semibold text-forest-800">{counts.new}</p>
          <p className="text-xs text-ink/50">New</p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-2xl font-semibold text-amber-700">{counts.inProgress}</p>
          <p className="text-xs text-ink/50">In Progress</p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-2xl font-semibold text-ink/60">{counts.closed}</p>
          <p className="text-xs text-ink/50">Closed</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SupportFilters query={query} />
        <ExportCsvButton query={query} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
              <th scope="col" className="px-4 py-3">Reference</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Category</th>
              <th scope="col" className="px-4 py-3">Subject</th>
              <th scope="col" className="px-4 py-3">Club</th>
              <th scope="col" className="px-4 py-3">Raised by</th>
              <th scope="col" className="px-4 py-3">Origin</th>
              <th scope="col" className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
                <td className="px-4 py-3">
                  <Link href={`/admin/support/${r.id}`} className="font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400">
                    {r.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLE[r.status]}`}>
                    {SUPPORT_STATUS_LABELS[r.status as keyof typeof SUPPORT_STATUS_LABELS] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink/70">{SUPPORT_CATEGORY_LABELS[r.category as keyof typeof SUPPORT_CATEGORY_LABELS] ?? r.category}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-ink/80">
                  <Link href={`/admin/support/${r.id}`} className="outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                    {r.subject}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/60">{r.clubName ?? "—"}</td>
                <td className="px-4 py-3 text-ink/60">{r.raisedBy}</td>
                <td className="px-4 py-3 text-ink/50">{r.origin === "public" ? "Public" : "Authenticated"}</td>
                <td className="px-4 py-3 text-ink/50">{relativeTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink/50">No support requests match these filters.</div>}
      </div>

      <div className="mt-6">
        <Pagination query={query} totalPages={totalPages} total={total} basePath="/admin/support" />
      </div>
    </div>
  )
}
