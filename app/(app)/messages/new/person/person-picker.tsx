"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"

import { openDirectConversation } from "../../direct/[id]/actions"
import type { ContactCandidate } from "./actions"

/**
 * CHOOSING A PERSON TO MESSAGE.
 *
 * The list is already the complete set of people this person may contact, so
 * the search box filters what is on screen rather than querying the server.
 * That is the whole point: there is no lookup to expose, because there is no
 * directory behind it.
 *
 * EVERY ROW SAYS WHY IT IS THERE -- "Your club · Ovalball UAT RUFC",
 * "Fixture contact · Under 12 Girls". An unfamiliar name with no explanation
 * is the thing that makes a contact list feel like a leak; the reason is what
 * makes it feel like a product.
 */
export function PersonPicker({ candidates }: { candidates: ContactCandidate[] }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => c.displayName.toLowerCase().includes(q))
  }, [candidates, query])

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg text-ink">Nobody to message yet</h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          You can message people at your club, on your teams, and the clubs you have fixtures against. Once any of
          those exist, they will appear here.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          aria-label="Search the people you can message"
          className="pl-9"
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <ul className="mt-3 divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {visible.length === 0 && (
          <li className="px-4 py-4 text-sm text-ink-muted">Nobody matches &ldquo;{query.trim()}&rdquo;.</li>
        )}
        {visible.map((person) => (
          <li key={person.userId}>
            <button
              type="button"
              disabled={opening !== null}
              aria-label={`Message ${person.displayName}`}
              onClick={async () => {
                setOpening(person.userId)
                setError(null)
                const result = await openDirectConversation(person.userId)
                setOpening(null)
                if (result.ok) router.push(`/messages/direct/${result.conversationId}`)
                else setError(result.error)
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] disabled:opacity-60"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-forest-800 text-xs font-semibold text-white">
                {person.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{person.displayName}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {[person.contextLabel, person.contextDetail].filter(Boolean).join(" · ")}
                </span>
              </span>
              {opening === person.userId && <span className="shrink-0 text-xs text-ink-muted">Opening…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
