"use client"

import { useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { ChevronDown, Search } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { ClubMapCard } from "./club-map-card"
import { ClubStatusPill } from "./club-status-pill"
import type { ClubMapHandle } from "./club-map"
import type { MapClub } from "./map-data"

const ClubMap = dynamic(() => import("./club-map").then((m) => m.ClubMap), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-ink/[0.03] text-sm text-ink/40">Loading map…</div>,
})

type StatusFilter = "all" | "on_ovalball" | "not_on_ovalball" | "partners"
type CodeFilter = "all" | "union" | "league"

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "on_ovalball", label: "On Ovalball" },
  { value: "not_on_ovalball", label: "Not on Ovalball" },
  { value: "partners", label: "Partners" },
]

function matchesQuery(club: MapClub, query: string): boolean {
  if (query.length < 2) return true
  const q = query.toLowerCase()
  return (
    club.name.toLowerCase().includes(q) ||
    (club.town ?? "").toLowerCase().includes(q) ||
    (club.postcode ?? "").toLowerCase().replace(/\s+/g, "").includes(q.replace(/\s+/g, ""))
  )
}

/**
 * Map + search + filters + list, all reading the same filtered array --
 * selecting a club (from the list, or by clicking its pin) is the single
 * source of truth that drives both the map fly-to and the list's own
 * expanded detail card, so the two views never show a different club at
 * once. Rows without a resolved location (the large majority of the
 * canonical directory right now, per the geocoding coverage) still
 * appear in the list and remain fully searchable -- they just have no
 * pin, and the row makes that explicit rather than pretending a location
 * exists.
 */
export function PartnerClubsExplorer({ clubs }: { clubs: MapClub[] }) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all")
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null)
  const mapRef = useRef<ClubMapHandle>(null)

  const filtered = useMemo(() => {
    return clubs.filter((c) => {
      if (!matchesQuery(c, query.trim())) return false
      if (codeFilter !== "all" && c.rugbyCode !== codeFilter) return false
      if (statusFilter === "on_ovalball" && !c.clubId) return false
      if (statusFilter === "not_on_ovalball" && c.clubId) return false
      if (statusFilter === "partners" && c.partnershipStatus !== "active") return false
      return true
    })
  }, [clubs, query, statusFilter, codeFilter])

  const showList = query.trim().length >= 2 || statusFilter !== "all" || codeFilter !== "all"
  const listRows = showList ? filtered.slice(0, 200) : []

  function handleSelect(club: MapClub) {
    setSelectedDirectoryId((prev) => (prev === club.directoryId ? null : club.directoryId))
    if (club.hasLocation && club.latitude !== null && club.longitude !== null) {
      mapRef.current?.flyTo(club.latitude, club.longitude)
    }
  }

  return (
    <div>
      <Label htmlFor="club-map-search" className="sr-only">
        Search all clubs by name, town or postcode
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink/35" />
        <Input
          id="club-map-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all clubs by name, town or postcode"
          className="h-12 border-ink/15 bg-white pl-10"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              aria-pressed={statusFilter === opt.value}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                statusFilter === opt.value ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <select
          value={codeFilter}
          onChange={(e) => setCodeFilter(e.target.value as CodeFilter)}
          className="h-8 rounded-full border border-ink/15 bg-white px-3 text-xs font-medium text-ink/60 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          aria-label="Filter by rugby code"
        >
          <option value="all">Union &amp; League</option>
          <option value="union">Union only</option>
          <option value="league">League only</option>
        </select>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[360px_1fr]">
        <div className="order-2 md:order-1">
          {!showList && (
            <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center text-sm text-ink/50">
              Search by name, town or postcode, or use a filter above, to list clubs here alongside the map.
            </div>
          )}
          {showList && listRows.length === 0 && <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center text-sm text-ink/50">No clubs match.</div>}
          {showList && listRows.length > 0 && (
            <ul className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-1">
              {listRows.map((club) => {
                const expanded = selectedDirectoryId === club.directoryId
                return (
                  <li key={club.directoryId} className="rounded-lg border border-ink/10 bg-white">
                    <button
                      type="button"
                      onClick={() => handleSelect(club)}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <ClubAvatar logoUrl={club.logoUrl} name={club.name} size="xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{club.name}</p>
                        <p className="truncate text-xs text-ink/45">{club.town ?? club.postcode ?? "No location on file"}</p>
                      </div>
                      <ClubStatusPill club={club} />
                      <ChevronDown className={`size-4 shrink-0 text-ink/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                    {expanded && (
                      <div className="border-t border-ink/8 px-3 py-3">
                        <ClubMapCard club={club} dense />
                        {!club.hasLocation && <p className="mt-2 text-xs text-ink/40">Location unavailable &mdash; no pin on the map for this club yet.</p>}
                      </div>
                    )}
                  </li>
                )
              })}
              {filtered.length > listRows.length && <li className="px-3 py-2 text-center text-xs text-ink/40">Showing first {listRows.length} of {filtered.length} &mdash; narrow your search to see more.</li>}
            </ul>
          )}
        </div>

        <div className="order-1 h-[320px] overflow-hidden rounded-lg border border-ink/10 md:order-2 md:h-[560px]">
          <ClubMap ref={mapRef} clubs={filtered} />
        </div>
      </div>
    </div>
  )
}
