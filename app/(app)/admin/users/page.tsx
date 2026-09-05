import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { Pagination } from "../pagination"
import { ExportUsersButton } from "./export-button"
import { buildAdminUserQuery, mapAdminUserRow } from "./query"
import { accessLabel, parseAdminUserQuery, type AdminUserRow } from "./types"
import { UserFilters } from "./user-filters"

/** Site Admin only, same convention as /admin/clubs -- RLS (profiles_select_self_or_admin) is the real boundary. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  const resolvedParams = await searchParams
  const query = parseAdminUserQuery(resolvedParams)
  const from = (query.page - 1) * query.size
  const to = from + query.size - 1

  const { data, count, error } = await buildAdminUserQuery(supabase, query).range(from, to)
  const rows = (data ?? []).map(mapAdminUserRow)
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / query.size))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">User management</h1>
          <p className="mt-2 max-w-lg text-sm text-ink/55">
            Review Ovalball accounts, club membership, and permissions directly &mdash; no more editing access in code
            or SQL.
          </p>
        </div>
        <ExportUsersButton query={query} />
      </div>

      <div className="mt-6">
        <UserFilters query={query} />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load users right now. Please try again.
        </p>
      )}

      <p className="mt-4 text-sm text-ink/45">
        {total.toLocaleString()} user{total === 1 ? "" : "s"} match{total === 1 ? "es" : ""}
      </p>

      {/* Desktop table */}
      <div className="mt-3 hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
              <th scope="col" className="px-4 py-3">
                Name
              </th>
              <th scope="col" className="px-4 py-3">
                Email
              </th>
              <th scope="col" className="px-4 py-3">
                Club
              </th>
              <th scope="col" className="px-4 py-3">
                Team scope
              </th>
              <th scope="col" className="px-4 py-3">
                Ovalball access
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{row.name}</p>
                </td>
                <td className="px-4 py-3 text-ink/60">{row.email}</td>
                <td className="px-4 py-3 text-ink/70">{row.clubNames ?? <span className="text-ink/35">&mdash;</span>}</td>
                <td className="px-4 py-3 text-ink/60">{row.teamNames ?? <span className="text-ink/35">&mdash;</span>}</td>
                <td className="px-4 py-3">
                  <AccessPill row={row} />
                </td>
                <td className="px-4 py-3">
                  <StatusPill row={row} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/users/${row.userId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    View
                    <ChevronRight className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <div className="px-4 py-10 text-center text-sm text-ink/50">No users match these filters.</div>}
      </div>

      {/* Mobile cards */}
      <ul className="mt-3 flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.userId}>
            <Link
              href={`/admin/users/${row.userId}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{row.name}</p>
                <p className="mt-0.5 truncate text-sm text-ink/55">{row.email}</p>
                <p className="mt-1 text-sm text-ink/50">{row.clubNames ?? "No club access"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <AccessPill row={row} />
                  <StatusPill row={row} />
                </div>
              </div>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink/30" />
            </Link>
          </li>
        ))}
        {rows.length === 0 && !error && (
          <li className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center text-sm text-ink/50">
            No users match these filters.
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Pagination query={query} totalPages={totalPages} total={total} basePath="/admin/users" />
      </div>
    </div>
  )
}

function AccessPill({ row }: { row: AdminUserRow }) {
  const label = accessLabel(row)
  const style =
    label === "Site Admin"
      ? "bg-forest-950/8 text-forest-950"
      : label === "Club Admin" || label === "Fixtures Admin"
        ? "bg-pitch-600/12 text-forest-800"
        : label === "Team Admin"
          ? "bg-mint-100 text-forest-800"
          : label === "No club access"
            ? "bg-ink/8 text-ink/45"
            : "bg-ink/8 text-ink/60"
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{label}</span>
}

function StatusPill({ row }: { row: AdminUserRow }) {
  if (row.accountStatus === "suspended") {
    return <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">Suspended</span>
  }
  if (row.hasActiveMembership || row.isSiteAdmin) {
    return <span className="rounded-full bg-mint-100 px-2.5 py-1 text-xs font-medium text-forest-800">Active</span>
  }
  if (row.hasPendingRequest) {
    return <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-700">Pending</span>
  }
  return <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/50">No club access</span>
}
