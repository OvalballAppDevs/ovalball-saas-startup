"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { sendOvieMessage } from "@/lib/ovie/actions"
import { EMPTY_OVIE_STATE, type OvieConversationState, type OvieTurnResult, type SafeOpponentCandidate } from "@/lib/ovie/types"

interface DisplayMessage {
  role: "user" | "assistant"
  text: string
  candidates?: SafeOpponentCandidate[] | null
  confirmationCard?: OvieTurnResult["confirmationCard"]
}

const STARTER_CHIPS = ["Find our U12s an opponent this Saturday", "Who's free for our 1st XV next weekend?", "Arrange a fixture within 20 miles"]

/** Section 21: subtle, rotating activity feedback while a search runs -- never raw SQL, never model chain-of-thought, just plain user-relevant progress text. */
const ACTIVITY_MESSAGES = ["Checking nearby clubs…", "Checking availability…", "Comparing this season's fixtures…"]

const AVAILABILITY_LABEL: Record<SafeOpponentCandidate["fixtureAvailabilityState"], string> = {
  AVAILABLE: "Available",
  PENDING_COMMITMENT: "Pending commitment",
  BOOKED: "Booked",
  TEAM_INACTIVE: "Team inactive",
  TEAM_MISSING: "No team of this type",
  UNCLAIMED_CLUB: "Not yet on Ovalball",
}

function formatDistance(miles: number | null): string {
  return miles != null ? `Approx. ${miles.toFixed(1)} miles` : "Distance unknown"
}

/**
 * Section 14's compact candidate card -- built entirely from
 * SafeOpponentCandidate's already privacy-reduced fields, nothing else.
 * "Request Fixture" reuses the exact same natural-language pipeline
 * (sends the club's display name as an ordinary chat message) rather than
 * a parallel selection path -- select_candidate in the orchestrator is the
 * one and only place a candidate is ever chosen.
 */
function CandidateCard({ candidate, isBestMatch, onSelect, disabled }: { candidate: SafeOpponentCandidate; isBestMatch: boolean; onSelect: () => void; disabled: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-white p-3 text-xs", isBestMatch ? "border-pitch-600/50 ring-1 ring-pitch-600/30" : "border-forest-900/12")}>
      {isBestMatch && <p className="mb-1 text-[10px] font-semibold tracking-[0.06em] text-pitch-700 uppercase">Best match</p>}
      <p className="text-sm font-semibold text-forest-900">{candidate.clubDisplayName}</p>
      <p className="text-forest-900/60">{candidate.canonicalTeamLabel}</p>
      <dl className="mt-1.5 flex flex-col gap-0.5 text-forest-900/70">
        <div>{formatDistance(candidate.approximateDistanceMiles)}</div>
        <div>{AVAILABILITY_LABEL[candidate.fixtureAvailabilityState]}</div>
        <div>{candidate.partnershipState === "partner" ? "Partner Club" : candidate.membershipState === "on_ovalball" ? "On Ovalball" : "Not yet on Ovalball"}</div>
        <div>{candidate.meetingsThisSeason === 0 ? "Not played this season" : `${candidate.meetingsThisSeason} meeting${candidate.meetingsThisSeason === 1 ? "" : "s"} this season`}</div>
      </dl>
      {candidate.requestActionAvailable && (
        <Button type="button" size="sm" className="mt-2 h-7 w-full text-xs" disabled={disabled} onClick={onSelect}>
          Request fixture
        </Button>
      )}
    </div>
  )
}

/** Section 19's confirmation card -- the one and only write in the whole widget lives behind this button, and only after this exact card has been shown. */
function ConfirmationCard({ card, onSend, onCancel, disabled }: { card: NonNullable<OvieTurnResult["confirmationCard"]>; onSend: () => void; onCancel: () => void; disabled: boolean }) {
  return (
    <div className="rounded-lg border border-pitch-600/40 bg-white p-3 text-xs">
      <p className="text-[10px] font-semibold tracking-[0.06em] text-pitch-700 uppercase">Ready to request</p>
      <p className="mt-1 text-sm font-semibold text-forest-900">
        vs {card.clubDisplayName} ({card.teamLabel})
      </p>
      <dl className="mt-1.5 flex flex-col gap-0.5 text-forest-900/70">
        <div>{card.date}</div>
        <div className="capitalize">
          {card.venuePreference}
          {card.kickoffTime ? ` at ${card.kickoffTime}` : ""}
        </div>
        {card.venueName && <div>{card.venueName}</div>}
      </dl>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" className="h-7 flex-1 text-xs" disabled={disabled} onClick={onSend}>
          Send fixture request
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 flex-1 text-xs" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * The persistent "Ask Ovie" widget -- compact closed, expands to a
 * conversation panel. Conversation state (lib/ovie/orchestrator.ts's
 * OvieConversationState) lives only in this component's own React state,
 * by design (see the orchestrator's module comment) -- a page refresh
 * starts a fresh conversation.
 */
export function AskOvie() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [state, setState] = useState<OvieConversationState>(EMPTY_OVIE_STATE)
  const [input, setInput] = useState("")
  const [notConfigured, setNotConfigured] = useState(false)
  const [pending, startTransition] = useTransition()
  const [activityIndex, setActivityIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setActivityIndex((i) => (i + 1) % ACTIVITY_MESSAGES.length), 1100)
    return () => clearInterval(id)
  }, [pending])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setMessages((prev) => [...prev, { role: "user", text: trimmed }])
    setInput("")
    startTransition(async () => {
      const result = await sendOvieMessage(state, trimmed)
      setState(result.state)
      setMessages((prev) => [...prev, { role: "assistant", text: result.reply, candidates: result.candidates, confirmationCard: result.confirmationCard }])
      if (result.error === "not_configured") setNotConfigured(true)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }))
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-50 flex h-12 items-center gap-2 rounded-full bg-forest-900 px-4 text-sm font-medium text-chalk shadow-lg transition-transform hover:scale-105 hover:bg-forest-800"
        aria-label="Ask Ovie"
      >
        <span aria-hidden className="text-base">🏉</span>
        Ask Ovie
      </button>
    )
  }

  return (
    <div className="fixed right-5 bottom-5 z-50 flex h-[32rem] w-[22rem] flex-col overflow-hidden rounded-2xl border border-forest-900/10 bg-chalk shadow-2xl">
      <div className="flex items-center justify-between bg-forest-900 px-4 py-3 text-chalk">
        <div className="flex items-center gap-2">
          <span aria-hidden>🏉</span>
          <span className="text-sm font-semibold">Ask Ovie</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-1.5 py-0.5 text-chalk/80 hover:bg-forest-800 hover:text-chalk">
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-forest-900/70">Ask me to find an opponent, and I&apos;ll handle the search -- you confirm before anything is sent.</p>
            <div className="flex flex-col gap-2">
              {STARTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => send(chip)}
                  className="rounded-lg border border-forest-900/15 bg-forest-900/5 px-3 py-2 text-left text-sm text-forest-900 hover:bg-forest-900/10"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1
          return (
            <div key={i} className="flex flex-col gap-2">
              <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line", m.role === "user" ? "ml-auto bg-pitch-600 text-ink" : "bg-forest-900/5 text-forest-900")}>
                {m.text}
              </div>
              {m.role === "assistant" && m.candidates && m.candidates.length > 0 && (
                <div className="grid grid-cols-1 gap-2">
                  {m.candidates.map((c, idx) => (
                    <CandidateCard key={c.clubDirectoryId} candidate={c} isBestMatch={idx === 0} disabled={pending || !isLast} onSelect={() => send(c.clubDisplayName)} />
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.confirmationCard && (
                <ConfirmationCard
                  card={m.confirmationCard}
                  disabled={pending || !isLast}
                  onSend={() => send("Yes, send it.")}
                  onCancel={() => send("Cancel that.")}
                />
              )}
            </div>
          )
        })}
        {pending && <div className="w-fit rounded-xl bg-forest-900/5 px-3 py-2 text-sm text-forest-900/60">{ACTIVITY_MESSAGES[activityIndex]}</div>}
      </div>

      {notConfigured && (
        <div className="border-t border-forest-900/10 bg-amber-50 px-3 py-2 text-xs text-amber-800">Ovie isn&apos;t connected in this environment yet.</div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex items-center gap-2 border-t border-forest-900/10 p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Ovie about a fixture…"
          disabled={pending || notConfigured}
          className="h-9 flex-1 rounded-lg border border-forest-900/15 bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={pending || notConfigured || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  )
}
