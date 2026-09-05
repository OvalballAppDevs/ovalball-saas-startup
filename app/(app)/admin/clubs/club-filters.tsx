"use client"

import { ChevronDown } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { hasActiveFilters, type AdminClubQuery } from "./types"

/**
 * Every control here just writes to the URL's searchParams and lets the
 * server component re-fetch -- no client-side filtering of a fetched page,
 * which would silently break as soon as the real result set (1390+ rows)
 * exceeds one page. Changing any filter resets `page` to 1: staying on
 * page 4 of a filter that now has 2 pages would show nothing and look
 * broken.
 */
export function ClubFilters({ query }: { query: AdminClubQuery }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(query.q)
  // Resyncs local input state when query.q changes from outside (back/forward
  // nav, a filter reset). Adjusted during render per React's own guidance for
  // derived state, rather than in an effect, which would cause an extra
  // render pass after every external change.
  const [prevQ, setPrevQ] = useState(query.q)
  if (query.q !== prevQ) {
    setPrevQ(query.q)
    setSearchValue(query.q)
  }
  const advancedActive =
    query.verified !== "all" ||
    query.logo !== "all" ||
    query.profile !== "all" ||
    query.duplicate !== "all" ||
    query.pendingClaim !== "all" ||
    query.missingPostcode !== "all" ||
    query.missingWebsite !== "all"
  const [showAdvanced, setShowAdvanced] = useState(advancedActive)

  function updateParams(patch: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === "all") params.delete(key)
      else params.set(key, value)
    }
    if (resetPage) params.delete("page")
    router.push(`/admin/clubs?${params.toString()}`)
  }

  useEffect(() => {
    const trimmed = searchValue.trim()
    if (trimmed === query.q) return
    const timer = setTimeout(() => {
      updateParams({ q: trimmed || null })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the debounced value should re-trigger this
  }, [searchValue])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search clubs</span>
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by club name, town, county or postcode&hellip;"
            className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </label>
        <SortSelect value={query.sort} onChange={(v) => updateParams({ sort: v }, false)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterGroup
          label="Code"
          value={query.code}
          options={[
            { value: "all", label: "All codes" },
            { value: "union", label: "Union" },
            { value: "league", label: "League" },
          ]}
          onChange={(v) => updateParams({ code: v })}
        />
        <FilterGroup
          label="Claimed"
          value={query.claimed}
          options={[
            { value: "all", label: "Activated + Unclaimed" },
            { value: "claimed", label: "Activated only" },
            { value: "unclaimed", label: "Unclaimed only" },
          ]}
          onChange={(v) => updateParams({ claimed: v })}
        />
        <FilterGroup
          label="Directory status"
          value={query.active}
          options={[
            { value: "all", label: "Active + Inactive" },
            { value: "active", label: "Active only" },
            { value: "inactive", label: "Inactive only" },
          ]}
          onChange={(v) => updateParams({ active: v })}
        />

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex h-9 items-center gap-1 rounded-full border border-dashed border-ink/20 px-3 text-sm text-ink/55 outline-none hover:border-ink/35 hover:text-ink/75 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          More filters
          <ChevronDown className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>

        {hasActiveFilters(query) && (
          <button
            type="button"
            onClick={() => router.push("/admin/clubs")}
            className="flex h-9 items-center rounded-full px-3 text-sm text-ink/45 underline decoration-dotted outline-none hover:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Clear filters
          </button>
        )}
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">
          <FilterGroup
            label="Verification"
            value={query.verified}
            options={[
              { value: "all", label: "Verified + Unverified" },
              { value: "verified", label: "Verified only" },
              { value: "unverified", label: "Unverified only" },
            ]}
            onChange={(v) => updateParams({ verified: v })}
          />
          <FilterGroup
            label="Crest"
            value={query.logo}
            options={[
              { value: "all", label: "Has + Missing crest" },
              { value: "has", label: "Has crest" },
              { value: "missing", label: "Missing crest" },
            ]}
            onChange={(v) => updateParams({ logo: v })}
          />
          <FilterGroup
            label="Public profile"
            value={query.profile}
            options={[
              { value: "all", label: "Has + Missing profile" },
              { value: "has", label: "Has public profile" },
              { value: "missing", label: "Missing public profile" },
            ]}
            onChange={(v) => updateParams({ profile: v })}
          />
          <ToggleChip label="Possible duplicate" checked={query.duplicate === "only"} onChange={(v) => updateParams({ duplicate: v ? "only" : null })} />
          <ToggleChip label="Pending claim" checked={query.pendingClaim === "only"} onChange={(v) => updateParams({ pendingClaim: v ? "only" : null })} />
          <ToggleChip
            label="Missing postcode"
            checked={query.missingPostcode === "only"}
            onChange={(v) => updateParams({ missingPostcode: v ? "only" : null })}
          />
          <ToggleChip
            label="Missing website"
            checked={query.missingWebsite === "only"}
            onChange={(v) => updateParams({ missingWebsite: v ? "only" : null })}
          />
        </div>
      )}
    </div>
  )
}

function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`h-9 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
        checked ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70 hover:border-ink/30"
      }`}
    >
      {label}
    </button>
  )
}

function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink/60">
      <span className="whitespace-nowrap">Sort</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
      >
        <option value="name-asc">A &rarr; Z</option>
        <option value="name-desc">Z &rarr; A</option>
        <option value="updated-desc">Recently updated</option>
        <option value="created-desc">Recently added</option>
        <option value="town-asc">Town</option>
        <option value="county-asc">County</option>
      </select>
    </label>
  )
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
