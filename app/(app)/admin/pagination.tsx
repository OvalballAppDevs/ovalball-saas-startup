"use client"

import { useRouter, useSearchParams } from "next/navigation"

import { PAGE_SIZES } from "./pagination-constants"

/** Shared between /admin/clubs and /admin/users -- same page/size URL-param convention, just a different basePath. */
export function Pagination({
  query,
  totalPages,
  total,
  basePath,
}: {
  query: { page: number; size: number }
  totalPages: number
  total: number
  basePath: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function goTo(page: number, size?: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    if (size) params.set("size", String(size))
    router.push(`${basePath}?${params.toString()}`)
  }

  if (total === 0) return null

  const from = (query.page - 1) * query.size + 1
  const to = Math.min(query.page * query.size, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink/50">
        Showing {from.toLocaleString()}&ndash;{to.toLocaleString()} of {total.toLocaleString()}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-ink/60">
          <span>Per page</span>
          <select
            value={query.size}
            onChange={(e) => goTo(1, Number(e.target.value))}
            className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 outline-none focus-visible:border-pitch-600"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={query.page <= 1}
            onClick={() => goTo(query.page - 1)}
            className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-ink/70 outline-none disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Back
          </button>
          <span className="px-2 text-ink/50">
            Page {query.page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={query.page >= totalPages}
            onClick={() => goTo(query.page + 1)}
            className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-ink/70 outline-none disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
