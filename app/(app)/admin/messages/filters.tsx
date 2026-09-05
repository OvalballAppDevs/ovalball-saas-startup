"use client"

import { useRouter, useSearchParams } from "next/navigation"

interface Option {
  id: string
  name: string
}

export function MessageFiltersBar({ clubOptions, teamOptions }: { clubOptions: Option[]; teamOptions: Option[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key === "club") params.delete("team")
    params.delete("page")
    router.push(`/admin/messages?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={searchParams.get("from") ?? ""}
        onChange={(e) => setParam("from", e.target.value)}
        className="h-9 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
        aria-label="From date"
      />
      <span className="text-xs text-ink/40">to</span>
      <input
        type="date"
        value={searchParams.get("to") ?? ""}
        onChange={(e) => setParam("to", e.target.value)}
        className="h-9 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
        aria-label="To date"
      />

      <select
        value={searchParams.get("club") ?? ""}
        onChange={(e) => setParam("club", e.target.value)}
        className="h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
        aria-label="Club"
      >
        <option value="">All clubs</option>
        {clubOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("team") ?? ""}
        onChange={(e) => setParam("team", e.target.value)}
        disabled={!searchParams.get("club")}
        className="h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none disabled:opacity-50 focus-visible:border-pitch-600"
        aria-label="Team"
      >
        <option value="">All teams</option>
        {teamOptions.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className="h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
        aria-label="Conversation type"
      >
        <option value="">Fixtures &amp; requests</option>
        <option value="fixture">Fixture conversations only</option>
        <option value="request">Fixture request conversations only</option>
      </select>

      {(searchParams.get("from") || searchParams.get("to") || searchParams.get("club") || searchParams.get("team") || searchParams.get("type")) && (
        <button type="button" onClick={() => router.push("/admin/messages")} className="text-xs font-medium text-ink/45 underline underline-offset-2 hover:text-ink/70">
          Clear filters
        </button>
      )}
    </div>
  )
}
