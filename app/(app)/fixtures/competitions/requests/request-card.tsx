"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { respondToCompetitionMatch } from "../actions"

export interface CompetitionRequest {
  verificationId: string
  matchId: string
  status: string
  message: string | null
  proposedDate: string | null
  proposedKickoff: string | null
  proposedVenue: string | null
  proposedPitch: string | null
  /** The answering club's own grounds and their pitches. */
  grounds: { id: string; name: string; pitches: { id: string; name: string }[] }[]
  competitionName: string
  home: string
  away: string
  ours: "home" | "away"
  date: string | null
  kickoff: string | null
  venue: string | null
  matchStatus: string | null
  round: number | null
}

const ANSWER: Record<string, { glyph: string; word: string; className: string }> = {
  awaiting: { glyph: "○", word: "Waiting for your answer", className: "text-ink-muted" },
  confirmed: { glyph: "●", word: "Confirmed", className: "text-forest-800" },
  change_requested: { glyph: "▲", word: "Change requested", className: "text-amber-700" },
  declined: { glyph: "■", word: "Declined", className: "text-destructive-text" },
}

function formatDate(iso: string | null) {
  if (!iso) return "Date to be confirmed"
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

export function RequestCard({ request: r, focus }: { request: CompetitionRequest; focus: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<"idle" | "change" | "decline">("idle")
  const [message, setMessage] = useState("")
  const [date, setDate] = useState("")
  const [kickoff, setKickoff] = useState("")
  const [venueId, setVenueId] = useState("")
  const [pitchId, setPitchId] = useState("")
  const pitches = r.grounds.find((g) => g.id === venueId)?.pitches ?? []
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const answer = ANSWER[r.status] ?? ANSWER.awaiting
  const open = r.status === "awaiting" && r.matchStatus !== "cancelled"

  function send(response: "confirmed" | "change_requested" | "declined") {
    setError(null)
    start(async () => {
      const result = await respondToCompetitionMatch({ verificationId: r.verificationId, response, message: message.trim() || null, proposedDate: date || null, proposedKickoff: kickoff || null, proposedVenueId: venueId || null, proposedPitchId: pitchId || null })
      if (!result.ok) return setError(result.error)
      setMode("idle")
      router.refresh()
    })
  }

  return (
    <article id={`match-${r.matchId}`} className={cn("rounded-lg border bg-white px-4 py-3", focus ? "border-forest-800/50 ring-2 ring-pitch-400/30" : "border-ink/10")} aria-label={`${r.home} v ${r.away}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            {r.competitionName}
            {r.round ? `, Round ${r.round}` : ""}
          </p>
          <h3 className="mt-0.5 font-medium text-ink">
            {r.home} v {r.away}
          </h3>
          <p className="text-sm text-ink-muted">
            {formatDate(r.date)}
            {r.kickoff ? ` at ${r.kickoff}` : ""}
            {r.venue ? `, ${r.venue}` : ""}. You are the {r.ours} side.
          </p>
        </div>
        <p className={cn("text-sm font-medium", answer.className)}>
          <span aria-hidden="true">{answer.glyph} </span>
          {r.matchStatus === "cancelled" ? "Cancelled by the organiser" : answer.word}
        </p>
      </div>
      {!open && (r.message || r.proposedDate || r.proposedKickoff) && (
        <p className="mt-1 text-sm text-ink-muted">
          {r.proposedDate ? `Proposed ${formatDate(r.proposedDate)}` : ""}
          {r.proposedKickoff ? ` at ${r.proposedKickoff}` : ""}
          {r.proposedVenue ? `${r.proposedDate || r.proposedKickoff ? ", " : "Proposed "}${r.proposedVenue}${r.proposedPitch ? `, ${r.proposedPitch}` : ""}` : ""}
          {r.message ? `${r.proposedDate || r.proposedKickoff || r.proposedVenue ? ". " : ""}"${r.message}"` : ""}
        </p>
      )}

      {open && mode === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="h-9" disabled={pending} onClick={() => send("confirmed")}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
          <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => setMode("change")}>
            Request Change
          </Button>
          <Button type="button" variant="ghost" className="h-9 text-destructive-text" disabled={pending} onClick={() => setMode("decline")}>
            Decline
          </Button>
        </div>
      )}

      {open && mode !== "idle" && (
        <div className="mt-3 rounded-md border border-ink/10 bg-chalk p-3">
          {mode === "change" && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label htmlFor={`pd-${r.verificationId}`} className="block text-xs font-medium text-ink-muted">
                  Proposed Date
                </label>
                <input id={`pd-${r.verificationId}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
              </div>
              <div>
                <label htmlFor={`pk-${r.verificationId}`} className="block text-xs font-medium text-ink-muted">
                  Proposed Kick-Off
                </label>
                <input id={`pk-${r.verificationId}`} type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
              </div>
              {r.ours === "home" && r.grounds.length > 0 && (
                <>
                  <div>
                    <label htmlFor={`pv-${r.verificationId}`} className="block text-xs font-medium text-ink-muted">
                      Proposed Venue
                    </label>
                    <select id={`pv-${r.verificationId}`} value={venueId} onChange={(e) => (setVenueId(e.target.value), setPitchId(""))} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm">
                      <option value="">No change</option>
                      {r.grounds.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {pitches.length > 0 && (
                    <div>
                      <label htmlFor={`pp-${r.verificationId}`} className="block text-xs font-medium text-ink-muted">
                        Proposed Pitch
                      </label>
                      <select id={`pp-${r.verificationId}`} value={pitchId} onChange={(e) => setPitchId(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm">
                        <option value="">No change</option>
                        {pitches.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <label htmlFor={`msg-${r.verificationId}`} className="mt-3 block text-xs font-medium text-ink-muted">
            {mode === "change" ? "What Should Change" : "Why You Are Declining"}
          </label>
          <textarea id={`msg-${r.verificationId}`} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm" />
          <div className="mt-2 flex gap-2">
            <Button type="button" className="h-9" variant={mode === "decline" ? "destructive" : "default"} disabled={pending || !message.trim()} onClick={() => send(mode === "change" ? "change_requested" : "declined")}>
              {pending ? "Sending…" : mode === "change" ? "Send Change Request" : "Decline Match"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => setMode("idle")}>
              Back
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
    </article>
  )
}
