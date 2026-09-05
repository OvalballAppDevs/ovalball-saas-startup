"use client"

import { useRouter } from "next/navigation"

import { Input } from "@/components/ui/input"
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS } from "@/lib/support/types"

import type { AdminSupportQuery } from "./query"

const STATUS_OPTIONS: { value: AdminSupportQuery["status"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: SUPPORT_STATUS_LABELS.new },
  { value: "in_progress", label: SUPPORT_STATUS_LABELS.in_progress },
  { value: "closed", label: SUPPORT_STATUS_LABELS.closed },
]

const ORIGIN_OPTIONS: { value: AdminSupportQuery["origin"]; label: string }[] = [
  { value: "all", label: "All origins" },
  { value: "authenticated", label: "Authenticated" },
  { value: "public", label: "Public / anonymous" },
]

export function SupportFilters({ query }: { query: AdminSupportQuery }) {
  const router = useRouter()

  function update(next: Partial<{ q: string; status: string; category: string; origin: string }>) {
    const params = new URLSearchParams()
    params.set("q", next.q ?? query.q)
    params.set("status", next.status ?? query.status)
    params.set("category", next.category ?? query.category)
    params.set("origin", next.origin ?? query.origin)
    params.set("page", "1")
    router.push(`/admin/support?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        defaultValue={query.q}
        onChange={(e) => update({ q: e.target.value })}
        placeholder="Search by reference or subject…"
        className="h-10 max-w-xs border-ink/15 bg-white"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ status: opt.value })}
            aria-pressed={query.status === opt.value}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              query.status === opt.value ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <select
        value={query.category}
        onChange={(e) => update({ category: e.target.value })}
        className="h-9 rounded-full border border-ink/15 bg-white px-3 text-xs font-medium text-ink/60 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        aria-label="Filter by category"
      >
        <option value="">All categories</option>
        {SUPPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {SUPPORT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <select
        value={query.origin}
        onChange={(e) => update({ origin: e.target.value })}
        className="h-9 rounded-full border border-ink/15 bg-white px-3 text-xs font-medium text-ink/60 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        aria-label="Filter by origin"
      >
        {ORIGIN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
