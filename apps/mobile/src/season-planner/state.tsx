import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { newClientMessageId, type SendItem, type SendResult } from "@ovalball/contracts"

import { useSession } from "../auth/session"
import { useAppContexts } from "../context/contexts"
import { readDraft, writeDraft } from "../messages/drafts"

/**
 * THE PLANNER'S WORKING STATE -- one club day in progress, held across the planner's screens.
 *
 * It is a DRAFT, not a record: nothing here is a fixture or a request until the server answers a send. It is kept
 * on the device for the signed-in person (the same store as message drafts, cleared on sign-out), so a phone call
 * mid-plan does not lose eight teams' Home/Away, and it belongs to ONE club: switching to another club's context
 * never shows -- or sends -- this club's draft.
 *
 * The batch id is the send's replay key. It is kept until a send is ANSWERED, so a retry after a timeout replays
 * the same batch (the server returns what it already created) instead of sending a second set.
 */

export interface PlannerOpponent {
  directoryId: string
  clubId: string | null
  name: string
  town: string | null
  crestUrl: string | null
  onOvalball: boolean
}

export interface PlannerSelection {
  targetTeamId: string
  venue: "home" | "away"
  /** Sending despite a pending request elsewhere that day -- a deliberate choice, never a default. */
  acknowledge: boolean
  /** The planner's own note on this fixture, sent with it. */
  note?: string | null
}

export interface SentLeg {
  opponent: PlannerOpponent
  date: string
  groupId: string | null
  /** What was asked, per team. */
  items: SendItem[]
  results: SendResult[]
  mode: "first" | "return"
  /** Teams chosen for this club day that could not be sent on its date, and why -- so the result can say so. */
  leftOut?: { teamName: string; reason: string }[]
}

export interface PlannerDraft {
  clubId: string
  seasonId: string | null
  weekStart: string | null
  matchDate: string | null
  opponent: PlannerOpponent | null
  selections: Record<string, PlannerSelection>
  batchId: string
  mode: "first" | "return"
  /** The club day a return club day returns (its group id), when planning a return. */
  reverseOfGroupId: string | null
  /** The first club day, kept while the return leg is planned. */
  firstLeg: SentLeg | null
  lastSent: SentLeg | null
  /**
   * A send that left the phone but whose answer never came back (timeout, network, relaunch). Kept with its batch id so
   * Review can ask the server what actually happened -- the same batch is replayed, never sent twice (M9).
   */
  pendingSend?: PendingSend | null
}

export interface PendingSend {
  batchId: string
  opponent: PlannerOpponent
  date: string
  items: SendItem[]
  mode: "first" | "return"
  reverseOfGroupId: string | null
  leftOut: { teamName: string; reason: string }[]
}

function freshDraft(clubId: string): PlannerDraft {
  return {
    clubId,
    seasonId: null,
    weekStart: null,
    matchDate: null,
    opponent: null,
    selections: {},
    batchId: newClientMessageId(),
    mode: "first",
    reverseOfGroupId: null,
    firstLeg: null,
    lastSent: null,
  }
}

interface PlannerContextValue {
  clubId: string | null
  ready: boolean
  draft: PlannerDraft | null
  update: (change: Partial<PlannerDraft> | ((draft: PlannerDraft) => Partial<PlannerDraft>)) => void
  /** Start a new club day (keeps the season); a new batch id. */
  startClubDay: (keep?: Partial<PlannerDraft>) => void
}

const PlannerContext = createContext<PlannerContextValue | null>(null)

const DRAFT_KEY = (clubId: string) => `season-planner:${clubId}`

export function SeasonPlannerProvider({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const { active } = useAppContexts()
  const userId = session?.user.id ?? null
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [draft, setDraft] = useState<PlannerDraft | null>(null)
  const [ready, setReady] = useState(false)
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !clubId) {
      setDraft(null)
      setReady(true)
      return
    }
    const key = `${userId}:${clubId}`
    if (loadedFor.current === key) return
    loadedFor.current = key
    setReady(false)
    void (async () => {
      const raw = await readDraft(userId, DRAFT_KEY(clubId))
      let restored: PlannerDraft | null = null
      try {
        const parsed = raw ? (JSON.parse(raw) as PlannerDraft) : null
        // Another club's draft is never carried into this club's planner.
        restored = parsed && parsed.clubId === clubId ? parsed : null
      } catch {
        restored = null
      }
      // A draft saved before the return link existed simply has none.
      setDraft(restored ? { ...freshDraft(clubId), ...restored } : freshDraft(clubId))
      setReady(true)
    })()
  }, [userId, clubId])

  const persist = useCallback(
    (next: PlannerDraft) => {
      if (userId) void writeDraft(userId, DRAFT_KEY(next.clubId), JSON.stringify(next))
    },
    [userId]
  )

  const update = useCallback<PlannerContextValue["update"]>(
    (change) => {
      setDraft((current) => {
        if (!current) return current
        const patch = typeof change === "function" ? change(current) : change
        const next = { ...current, ...patch }
        persist(next)
        return next
      })
    },
    [persist]
  )

  const startClubDay = useCallback<PlannerContextValue["startClubDay"]>(
    (keep) => {
      setDraft((current) => {
        if (!clubId) return current
        const next: PlannerDraft = { ...freshDraft(clubId), seasonId: current?.seasonId ?? null, lastSent: current?.lastSent ?? null, ...keep }
        persist(next)
        return next
      })
    },
    [clubId, persist]
  )

  const value = useMemo<PlannerContextValue>(
    () => ({ clubId, ready, draft: draft && draft.clubId === clubId ? draft : null, update, startClubDay }),
    [clubId, ready, draft, update, startClubDay]
  )
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}

export function useSeasonPlanner(): PlannerContextValue {
  const value = useContext(PlannerContext)
  if (!value) throw new Error("useSeasonPlanner must be used inside SeasonPlannerProvider")
  return value
}
