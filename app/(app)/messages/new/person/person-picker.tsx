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

  /**
   * ONE SEARCH OVER EVERYTHING A ROW SAYS -- a person, their team, and their
   * CLUB. It matched the name alone, which meant the only way to find the
   * Preston fixture contact was to already know their name; typing "Preston"
   * found nobody. It matches the club because the row now carries one, rather
   * than because the search was taught to guess at it.
   *
   * NARROWING ONLY. This runs in the browser over an already-authorised list --
   * `my_direct_message_candidates` is built from relationships the caller
   * already holds, so a search here cannot reach anybody outside them and is
   * not a directory lookup.
   */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) =>
      [c.displayName, c.contextLabel, c.contextDetail, c.contextClub].some((field) =>
        (field ?? "").toLowerCase().includes(q)
      )
    )
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
          placeholder="Search by name or club"
          aria-label="Search the people you can message, by name, team or club"
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
              aria-label={`Message ${person.displayName}, ${contextLine(person)}`}
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
                {/* WHO THEY ARE, AND WHOSE. "Fixture contact · Under 12 Boys"
                    did not say whose Under 12 Boys -- and a fixture contact is
                    by definition from the other side, so a season against three
                    different Under 12 sides produced three identical rows. The
                    club is de-duplicated rather than repeated: a "Your club"
                    row's detail already IS the club. */}
                <span className="block truncate text-xs text-ink-muted">{contextLine(person)}</span>
              </span>
              {opening === person.userId && <span className="shrink-0 text-xs text-ink-muted">Opening…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The row's second line: the reason they are listed, the side, and the club — each said once. */
function contextLine(person: { contextLabel: string; contextDetail: string | null; contextClub: string | null }): string {
  return Array.from(new Set([person.contextLabel, person.contextDetail, person.contextClub].filter(Boolean) as string[])).join(" · ")
}
