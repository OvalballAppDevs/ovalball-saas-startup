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
        Find a club
      </Label>
      {selected ? (
        <div className="mt-1.5 flex items-center justify-between rounded-lg border border-ink/15 bg-mint-100/40 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selected.name}</p>
            <p className="text-xs text-ink/55">
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
            className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
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
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      )}
      {!selected && query.trim().length >= 2 && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-1">
          {searching && <p className="px-3 py-2 text-sm text-ink/45">Searching…</p>}
          {!searching && results.length === 0 && <p className="px-3 py-2 text-sm text-ink/45">No clubs found.</p>}
          {results.map((r) => (
            <button
              key={r.directoryId}
              type="button"
              onClick={() => {
                setSelected(r)
                setResults([])
              }}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-ink/5"
            >
              <span>
                {r.name}
                {r.town ? <span className="text-ink/45"> · {r.town}</span> : null}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.isPartner ? "bg-pitch-600/15 text-forest-900" : r.isActiveOnOvalball ? "bg-mint-100 text-forest-800" : "bg-ink/8 text-ink/50"
                }`}
              >
                {r.isPartner ? "Partner" : r.isActiveOnOvalball ? "On Ovalball" : "Not on Ovalball"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && !selected.isActiveOnOvalball && (
        <p className="mt-3 text-sm text-ink/55">
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
          <p className="mt-1 text-xs text-ink/45">
            {selected.isPartner
              ? `${selected.name} is already a partner club -- this opens your shared conversation immediately.`
              : `${selected.name} will see this as a message request and can accept or decline it before the conversation opens.`}
          </p>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-3">
            <Button type="button" className="h-10" disabled={submitting || !message.trim()} onClick={handleSend}>
              {submitting ? "Sending…" : selected.isPartner ? "Send message" : "Send message request"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
