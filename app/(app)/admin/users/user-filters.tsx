"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { CLUB_ROLE_LABEL, TEAM_PERMISSION_LABEL } from "@/lib/permissions/role-labels"

import type { AdminUserQuery } from "./types"

/** Mirrors admin/clubs/club-filters.tsx's own URL-driven, server-refetch pattern -- no client-side filtering of an already-fetched page. */
export function UserFilters({ query }: { query: AdminUserQuery }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(query.q)
  const [prevQ, setPrevQ] = useState(query.q)
  if (query.q !== prevQ) {
    setPrevQ(query.q)
    setSearchValue(query.q)
  }

  function updateParams(patch: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === "all") params.delete(key)
      else params.set(key, value)
    }
    if (resetPage) params.delete("page")
    router.push(`/admin/users?${params.toString()}`)
  }

  useEffect(() => {
    const trimmed = searchValue.trim()
    if (trimmed === query.q) return
    const timer = setTimeout(() => updateParams({ q: trimmed || null }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the debounced value should re-trigger this
  }, [searchValue])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search users</span>
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by name, email, club or team&hellip;"
            className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink/60">
          <span className="whitespace-nowrap">Sort</span>
          <select
            value={query.sort}
            onChange={(e) => updateParams({ sort: e.target.value }, false)}
            className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="name-asc">Name A &rarr; Z</option>
            <option value="name-desc">Name Z &rarr; A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="club">Club</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Access</span>
          <select
            value={query.access}
            onChange={(e) => updateParams({ access: e.target.value })}
            aria-label="Ovalball access"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">Any access</option>
            <option value="site_admin">Site Admin</option>
            <option value="club_admin">{CLUB_ROLE_LABEL.CLUB_ADMIN}</option>
            <option value="fixtures_admin">{CLUB_ROLE_LABEL.FIXTURE_SECRETARY}</option>
            <option value="team_admin">{TEAM_PERMISSION_LABEL.team_admin}</option>
            <option value="view_only">{TEAM_PERMISSION_LABEL.view_only}</option>
            <option value="no_access">No club access</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Account status</span>
          <select
            value={query.status}
            onChange={(e) => updateParams({ status: e.target.value })}
            aria-label="Account status"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">Any status</option>
            <option value="active">Active member</option>
            <option value="pending">Pending claim/join</option>
            <option value="no_access">No club access</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        {(query.q || query.access !== "all" || query.status !== "all") && (
          <button
            type="button"
            onClick={() => router.push("/admin/users")}
            className="flex h-9 items-center rounded-full px-3 text-sm text-ink/45 underline decoration-dotted outline-none hover:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
