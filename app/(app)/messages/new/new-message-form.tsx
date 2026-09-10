"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { startClubConversation } from "../club-actions"
import { searchClubsForMessaging, type ClubMessageSearchResult } from "../club-search"

export function NewMessageForm({ myClubId }: { myClubId: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ClubMessageSearchResult[]>([])
  const [searching, startSearch] = useTransition()
  const [selected, setSelected] = useState<ClubMessageSearchResult | null>(null)
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleQueryChange(value: string) {
    setQuery(value)
    setSelected(null)
    startSearch(async () => {
      const r = await searchClubsForMessaging(value, myClubId)
      setResults(r)
    })
  }

  async function handleSend() {
    if (!selected?.clubId || !message.trim()) return
    setSubmitting(true)
    setError(null)
    const result = await startClubConversation(myClubId, selected.clubId, message.trim())
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push(`/messages/club/${result.conversationId}`)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <Label htmlFor="club-message-search" className="text-ink/80">
        Find a Club
      </Label>
      {/* WHAT THIS SEARCHES, said plainly. Ovalball never exposes a directory
          of people: a club message goes club-to-club, and the club on the
          other side decides who reads it. Saying so here stops somebody
          hunting for a person search that should not exist. */}
      <p id="club-search-hint" className="mt-1 text-xs text-ink-muted">
        Club-to-club message. Search the Club Directory by name &mdash; Ovalball does not
        list individual people.
      </p>
      {selected ? (
        <div className="mt-1.5 flex items-center justify-between rounded-lg border border-ink/15 bg-mint-100/40 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selected.name}</p>
            <p className="text-xs text-ink-muted">
              {[selected.town, selected.county].filter(Boolean).join(" · ")}
              {selected.rugbyCode ? ` · Rugby ${selected.rugbyCode === "union" ? "Union" : "League"}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null)
              setQuery("")
            }}
            className="flex h-11 shrink-0 items-center text-sm font-medium text-forest-800 underline underline-offset-2 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Change
          </button>
        </div>
      ) : (
        <Input
          id="club-message-search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by club name"
          role="combobox"
          aria-expanded={!selected && query.trim().length >= 2}
          aria-controls="club-search-results"
          aria-describedby="club-search-hint"
          autoComplete="off"
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      )}
      {!selected && query.trim().length >= 2 && (
        <>
          {/* The result count is announced once, quietly. Without it a screen
              reader user types and hears nothing at all happen. */}
          <p aria-live="polite" className="sr-only">
            {searching
              ? "Searching"
              : results.length === 0
                ? "No clubs found"
                : `${results.length} club${results.length === 1 ? "" : "s"} found`}
          </p>
          <ul
            id="club-search-results"
            role="listbox"
            aria-label="Matching clubs"
            className="mt-2 flex flex-col overflow-hidden rounded-lg border border-ink/10 bg-white"
          >
            {searching && <li className="px-3 py-3 text-sm text-ink-muted">Searching…</li>}
            {!searching && results.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-muted">
                No clubs match that name. Try the club&rsquo;s full name, or a town.
              </li>
            )}
            {results.map((r) => (
              <li key={r.directoryId} role="option" aria-selected="false" className="border-b border-ink/[0.07] last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(r)
                    setResults([])
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-ink outline-none transition-colors hover:bg-ink/[0.035] focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
                >
                  <span className="min-w-0 truncate">
                    {r.name}
                    {r.town ? <span className="text-ink-muted"> · {r.town}</span> : null}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.isPartner ? "bg-pitch-600/15 text-forest-900" : r.isActiveOnOvalball ? "bg-mint-100 text-forest-800" : "bg-ink/8 text-ink-muted"
                    }`}
                  >
                    {r.isPartner ? "Partner" : r.isActiveOnOvalball ? "On Ovalball" : "Not on Ovalball"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && !selected.isActiveOnOvalball && (
        <p className="mt-3 text-sm text-ink-muted">
          This club is not currently active on Ovalball. You can still use this club when creating fixtures, but
          direct Ovalball messaging isn&apos;t available yet.
        </p>
      )}

      {selected && selected.isActiveOnOvalball && (
        <div className="mt-4">
          <Label htmlFor="club-message-body" className="text-ink/80">
            Message
          </Label>
          <textarea
            id="club-message-body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={selected.isPartner ? "Write your message…" : "Explain why you'd like to start a conversation…"}
            className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <p className="mt-1 text-xs text-ink-muted">
            {selected.isPartner
              ? `${selected.name} is already a partner club -- this opens your shared conversation immediately.`
              : `${selected.name} will see this as a message request and can accept or decline it before the conversation opens.`}
          </p>
          {error && (
            <p role="alert" className="mt-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive-text">
              {error}
            </p>
          )}
          <div className="mt-3">
            <Button type="button" className="h-11" disabled={submitting || !message.trim()} onClick={handleSend}>
              {submitting ? "Sending…" : selected.isPartner ? "Send Message" : "Send Message Request"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
