"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Save, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { detectConflicts, unallocatedReason } from "@/lib/pitch-allocation/auto-allocate"
import type { AllocationFixture, PitchOption } from "@/lib/pitch-allocation/types"

import { allocateFixture, createPitchAllocationProposal, discardPitchAllocationProposal, getProposal, type ProposalItemView } from "./actions"
import type { PitchAllocationBoard as BoardData } from "./data"
import { PitchAllocationDatePicker } from "./pitch-allocation-date-picker"

const START_MINUTES = 8 * 60 // 08:00
const END_MINUTES = 23 * 60 // 23:00
const SLOT_MINUTES = 15
const PX_PER_SLOT = 22
const SLOT_COUNT = (END_MINUTES - START_MINUTES) / SLOT_MINUTES
const TIMELINE_WIDTH = SLOT_COUNT * PX_PER_SLOT
const ROW_HEIGHT = 76
/** Section 41-47: a multi-lane pitch renders each lane at this shorter height instead of the full single-pitch ROW_HEIGHT, so a lane_count=3 pitch doesn't triple the whole board's vertical space. */
const LANE_HEIGHT = 40

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0")
  const mm = (m % 60).toString().padStart(2, "0")
  return `${h}:${mm}`
}

/**
 * Section 41-47: which visual LANE each fixture on a multi-capacity pitch
 * sits in -- computed at render time from kickoff/duration overlap
 * (classic greedy interval scheduling), never stored. There is no
 * canonical "lane" fact on a fixture; fixtures.pitch_id still names the
 * one real physical pitch either way, so this can never drift out of
 * sync with what's actually booked. A fixture landing beyond the pitch's
 * configured lane_count (already flagged as a hard conflict by
 * detectConflicts) is clamped into the last lane so it still renders
 * somewhere rather than being silently dropped.
 */
function assignLanes(fixtures: AllocationFixture[], laneCount: number): Map<string, number> {
  const sorted = [...fixtures].sort((a, b) => timeToMinutes(a.kickoffTime!) - timeToMinutes(b.kickoffTime!))
  const laneEndTimes: number[] = []
  const laneByFixtureId = new Map<string, number>()
  for (const f of sorted) {
    const start = timeToMinutes(f.kickoffTime!)
    const end = start + (f.durationMinutes ?? 60)
    let lane = laneEndTimes.findIndex((endTime) => endTime <= start)
    if (lane === -1) {
      lane = laneEndTimes.length
      laneEndTimes.push(end)
    } else {
      laneEndTimes[lane] = end
    }
    laneByFixtureId.set(f.fixtureId, Math.min(lane, laneCount - 1))
  }
  return laneByFixtureId
}
function formatHour(m: number): string {
  const h = Math.floor(m / 60)
  const period = h >= 12 ? "pm" : "am"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${period}`
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function conflictFor(fixtureId: string, conflicts: BoardData["conflicts"]) {
  return conflicts.find((c) => c.fixtureId === fixtureId) ?? null
}

/**
 * Section 12: alias-aware label already resolved server-side in data.ts --
 * never re-derived here.
 *
 * Section 13-17: dragging uses the Pointer Events API (pointerdown/move/up)
 * rather than native HTML5 drag-and-drop -- native DnD simply never fires
 * from a touch gesture in any mobile browser, so it could never have
 * worked on the tablet a touchline Club Admin actually uses, no matter how
 * the coordinate math was fixed. Pointer Events unify mouse and touch in
 * one model with no new dependency (the same primitive most drag
 * libraries are themselves built on) -- see handlePointerDown in
 * PitchAllocationBoard for the drag state machine this card starts.
 * The "Move" affordance is now always visible, not opacity-0-until-hover,
 * so it's actually discoverable on a device with no hover state.
 */
function FixtureCard({
  fixture,
  conflict,
  left,
  width,
  top,
  height,
  draggable,
  isDragSource,
  onPointerDownCard,
  onPointerMoveCard,
  onPointerUpCard,
  onOpenMove,
  reason,
}: {
  fixture: AllocationFixture
  conflict: { severity: "hard" | "warning"; reason: string } | null
  left?: number
  width?: number
  /** Section 41-47: vertical position within a multi-lane pitch row. Omitted (the normal single-lane case) keeps the original top:4/bottom:4-inset-to-fill-the-row behaviour exactly as before. */
  top?: number
  height?: number
  draggable: boolean
  /** True while THIS fixture is the one currently being dragged -- dims the source card so the live preview elsewhere on the board reads as "the" position. */
  isDragSource?: boolean
  onPointerDownCard?: (e: React.PointerEvent) => void
  onPointerMoveCard?: (e: React.PointerEvent) => void
  onPointerUpCard?: (e: React.PointerEvent) => void
  onOpenMove: () => void
  /** Section 3: set only for cards rendered in the Unallocated tray -- explains why this fixture isn't on the board yet. */
  reason?: string
}) {
  const style =
    left !== undefined
      ? top !== undefined && height !== undefined
        ? { position: "absolute" as const, left, width: Math.max(width ?? 0, 90), top, height }
        : { position: "absolute" as const, left, width: Math.max(width ?? 0, 90), top: 4, bottom: 4 }
      : undefined
  return (
    <div
      onPointerDown={draggable ? onPointerDownCard : undefined}
      onPointerMove={draggable ? onPointerMoveCard : undefined}
      onPointerUp={draggable ? onPointerUpCard : undefined}
      onPointerCancel={draggable ? onPointerUpCard : undefined}
      role="group"
      aria-label={`${fixture.homeTeamLabel} versus ${fixture.opponentLabel}, ${fixture.kickoffTime ?? "unallocated"}${reason ? `. ${reason}` : ""}`}
      style={style}
      className={cn(
        "group flex touch-none flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-pitch-400",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        isDragSource && "opacity-40",
        conflict?.severity === "hard"
          ? "border-destructive/40 bg-destructive/10"
          : conflict?.severity === "warning"
            ? "border-amber-400 bg-amber-50"
            : "border-forest-800/20 bg-mint-100"
      )}
    >
      <div className="flex items-center gap-1">
        {conflict && <AlertTriangle className={cn("size-3 shrink-0", conflict.severity === "hard" ? "text-destructive" : "text-amber-600")} />}
        <p className="truncate text-xs font-semibold text-forest-950">{fixture.homeTeamLabel}</p>
      </div>
      <p className="truncate text-[11px] text-forest-900/70">v {fixture.opponentLabel}</p>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-medium text-forest-900/60">{fixture.kickoffTime ?? "--:--"}</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onOpenMove()
          }}
          className="rounded px-1 py-0.5 text-[10px] font-medium text-forest-800/70 underline decoration-dotted underline-offset-2 outline-none hover:bg-white/60 focus-visible:ring-1 focus-visible:ring-pitch-400"
        >
          Move
        </button>
      </div>
      {reason && <p className="text-[10px] leading-tight text-forest-900/55">{reason}</p>}
    </div>
  )
}

function MoveFixtureDialog({
  fixture,
  pitches,
  onClose,
  onMove,
}: {
  fixture: AllocationFixture
  pitches: PitchOption[]
  onClose: () => void
  onMove: (pitchId: string, kickoffTime: string) => Promise<void>
}) {
  // Bug fix: the dropdown only ever renders ACTIVE pitches (filtered
  // below), but the default state here used to fall back to the raw
  // pitches[0] -- if that happened to be an INACTIVE pitch (e.g. sorted
  // first), the visible <select> silently showed the first active option
  // while the actual React state still held the inactive pitch's id, so
  // clicking Move without touching the dropdown submitted a pitch that
  // failed the server's own active check ("That pitch does not belong to
  // this club, or is not active.") -- live-reproduced with Burnley's
  // inactive "AGP" pitch, which sorts before Main Pitch.
  const activePitches = pitches.filter((p) => p.active)
  const currentPitchIsActive = fixture.pitchId !== null && activePitches.some((p) => p.id === fixture.pitchId)
  const [pitchId, setPitchId] = useState((currentPitchIsActive ? fixture.pitchId : null) ?? activePitches[0]?.id ?? "")
  const [time, setTime] = useState(fixture.kickoffTime ?? "10:00")
  const [saving, setSaving] = useState(false)

  return (
    <div role="dialog" aria-modal="true" aria-label={`Move ${fixture.homeTeamLabel} v ${fixture.opponentLabel}`} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <p className="text-sm font-medium text-ink/50">Move fixture</p>
        <p className="mt-1 font-display text-lg text-ink">
          {fixture.homeTeamLabel} v {fixture.opponentLabel}
        </p>
        <div className="mt-4">
          <label htmlFor="move-pitch" className="text-xs font-medium text-ink/60">
            Pitch
          </label>
          <select
            id="move-pitch"
            value={pitchId}
            onChange={(e) => setPitchId(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          >
            {pitches
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </select>
        </div>
        <div className="mt-3">
          <label htmlFor="move-time" className="text-xs font-medium text-ink/60">
            Kick-off time
          </label>
          <input
            id="move-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          />
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" className="h-9" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={saving || !pitchId}
            onClick={async () => {
              setSaving(true)
              await onMove(pitchId, time)
              setSaving(false)
            }}
          >
            {saving ? "Moving…" : "Move"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProposalReview({ clubId, proposalId, onClose, onStage }: { clubId: string; proposalId: string; onClose: () => void; onStage: (items: ProposalItemView[]) => void }) {
  const [items, setItems] = useState<ProposalItemView[] | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getProposal(clubId, proposalId).then((r) => {
      if (cancelled) return
      if (r.ok) setItems(r.items)
      else setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [clubId, proposalId])

  /**
   * Live save-gating request: no proposal item mutates a canonical fixture
   * here anymore -- eligible items are staged into the board's own pending
   * changes (same place a manual drag lands) and only reach the database
   * when the page-level Save Changes is pressed. The draft proposal row is
   * discarded immediately since its items now live in that pending state
   * instead -- there is nothing left for it to track.
   */
  async function handleApply() {
    if (!items) return
    setApplying(true)
    const eligible = items.filter((i) => !i.isUnallocated && i.conflictSeverity !== "hard")
    onStage(eligible)
    await discardPitchAllocationProposal(clubId, proposalId)
    setApplying(false)
    onClose()
  }

  async function handleDiscard() {
    await discardPitchAllocationProposal(clubId, proposalId)
    onClose()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Review proposed allocation" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-ink/10 px-5 py-4">
          <p className="text-sm font-medium text-ink/50">Auto-allocate proposal</p>
          <p className="mt-1 font-display text-lg text-ink">Review before applying</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!items ? (
            <p className="py-8 text-center text-sm text-ink/40">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/40">Nothing to allocate -- every home fixture already has a pitch and time.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((it) => (
                <li
                  key={it.fixtureId}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm",
                    it.conflictSeverity === "hard" ? "border-destructive/30 bg-destructive/5" : it.conflictSeverity === "warning" ? "border-amber-300 bg-amber-50" : "border-ink/10 bg-chalk"
                  )}
                >
                  <p className="font-medium text-ink">
                    {it.homeTeamLabel} v {it.opponentLabel}
                  </p>
                  {it.isUnallocated || it.conflictSeverity === "hard" ? (
                    <p className="mt-0.5 text-xs text-destructive">{it.conflictReason ?? "Could not be allocated."}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-ink/60">
                      Proposed: {it.proposedPitchName} at {it.proposedKickoffTime}
                      {it.conflictSeverity === "warning" && <span className="ml-1.5 text-amber-700">· {it.conflictReason}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-ink/10 px-5 py-4">
          <p className="text-xs text-ink/45">Added to your draft -- nothing saves until you press Save Changes.</p>
          <div className="flex shrink-0 items-center gap-3">
            <Button type="button" variant="ghost" className="h-9" onClick={handleDiscard} disabled={applying}>
              Discard
            </Button>
            <Button type="button" className="h-9" onClick={handleApply} disabled={applying || !items || items.every((i) => i.isUnallocated || i.conflictSeverity === "hard")}>
              {applying ? "Adding…" : "Apply allocation"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PitchAllocationBoard({ clubId, dateIso, initialBoard }: { clubId: string; dateIso: string; initialBoard: BoardData }) {
  const router = useRouter()
  const [board, setBoard] = useState(initialBoard)
  const [moving, setMoving] = useState<AllocationFixture | null>(null)
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [autoAllocating, setAutoAllocating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoTriggeredForDate = useRef<string | null>(null)
  /**
   * Live save-gating request: every board edit (drag, keyboard move, an
   * applied auto-allocate proposal) lands here first and only reaches the
   * database when Save Changes is pressed -- so a club moving fixtures
   * around several times in a row, with real people on the other end of
   * each notification, only ever sends ONE final notification per fixture
   * instead of one per intermediate drag. `board` itself is still updated
   * optimistically the moment a change is staged (unchanged from the
   * pre-existing drag behaviour) so the grid always shows the true draft;
   * this map is only the replay list Save Changes sends to the server.
   */
  const [pendingChanges, setPendingChanges] = useState<Map<string, { pitchId: string | null; kickoffTime: string }>>(new Map())
  const [saving, setSaving] = useState(false)
  const [confirmDiscardAction, setConfirmDiscardAction] = useState<(() => void) | null>(null)
  const isDirty = pendingChanges.size > 0
  // Section 13-17: pointer-based drag state. rowRefs lets pointermove
  // hit-test which pitch row the pointer is currently over by comparing
  // clientY against each row's live bounding rect -- rebuilt every drag
  // rather than cached, since the board can scroll or resize mid-drag.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [drag, setDrag] = useState<{ fixtureId: string; pointerId: number; pitchId: string | null; minutes: number } | null>(null)

  // Section 38-44 (board live-sync bug fix): useState(initialBoard) only
  // ever reads its argument on the FIRST render -- router.refresh() genuinely
  // re-runs the server component and passes a fresh initialBoard prop
  // afterward, but without this the already-mounted client component keeps
  // its own stale `board` state forever, silently ignoring the new prop.
  // This is exactly why only a full, jarring browser reload (which
  // remounts everything from scratch) ever showed the real result --
  // router.refresh()'s whole point is to avoid that. React's own
  // recommended "adjust state during render" pattern (never inside a
  // useEffect -- this project's own lint rule forbids that cascade) --
  // comparing against the LAST SEEN prop reference, not the current
  // `board` state, so a genuine local edit (drag/optimistic update) is
  // never clobbered by this render just because `board` itself changed.
  // A fresh object reference is guaranteed on every real refetch (data.ts
  // builds a new object literal each call), so reference-equality here is
  // reliable, never a false-positive skip.
  const [lastSeenInitialBoard, setLastSeenInitialBoard] = useState(initialBoard)
  if (initialBoard !== lastSeenInitialBoard) {
    setLastSeenInitialBoard(initialBoard)
    setBoard(initialBoard)
  }

  const activePitches = board.pitches.filter((p) => p.active)
  const inactivePitches = board.pitches.filter((p) => !p.active)

  const slots = useMemo(() => Array.from({ length: SLOT_COUNT }, (_, i) => START_MINUTES + i * SLOT_MINUTES), [])
  const hourMarks = slots.filter((m) => m % 60 === 0)

  /**
   * Recomputed against the CURRENT draft board (not just the server's last
   * save) with the exact same pure function and buffer inputs data.ts uses
   * server-side, so a staged-but-unsaved drag still shows an honest
   * conflict badge immediately -- someone shuffling several fixtures
   * before saving isn't flying blind until Save Changes tells them.
   */
  const liveConflicts = useMemo(
    () => detectConflicts(board.fixtures, board.pitches, { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }),
    [board.fixtures, board.pitches, board.policy.warmUpMinutes, board.policy.packUpMinutes]
  )

  function navigateNow(nextDate: string) {
    router.push(`/calendar/pitch-allocation?date=${nextDate}`)
  }

  /** Runs `action` immediately when the draft is clean; when dirty, holds it behind the unsaved-changes confirmation instead. */
  function guardedNavigate(action: () => void) {
    if (isDirty) {
      setConfirmDiscardAction(() => action)
      return
    }
    action()
  }

  function navigate(nextDate: string) {
    guardedNavigate(() => navigateNow(nextDate))
  }

  /**
   * Stages a move locally only -- never calls the server. `board` is
   * updated the same optimistic way it always was; the only change is
   * that allocateFixture (and the notification/revalidation it triggers)
   * no longer runs until Save Changes.
   */
  function handleMove(fixtureId: string, pitchId: string, kickoffTime: string) {
    setError(null)
    setBoard((b) => {
      const existing = b.fixtures.find((f) => f.fixtureId === fixtureId) ?? b.unallocated.find((f) => f.fixtureId === fixtureId)
      if (!existing) return b
      const updated = { ...existing, pitchId, kickoffTime }
      return {
        ...b,
        fixtures: [...b.fixtures.filter((f) => f.fixtureId !== fixtureId), updated],
        unallocated: b.unallocated.filter((f) => f.fixtureId !== fixtureId),
      }
    })
    setPendingChanges((prev) => new Map(prev).set(fixtureId, { pitchId, kickoffTime }))
    setToast("Staged -- press Save Changes to apply.")
    setTimeout(() => setToast(null), 3000)
  }

  /** Merges an applied auto-allocate proposal's items into the same draft a manual drag lands in -- see the ProposalReview comment above handleApply. */
  function stageProposalItems(items: ProposalItemView[]) {
    setPendingChanges((prev) => {
      const next = new Map(prev)
      for (const it of items) next.set(it.fixtureId, { pitchId: it.proposedPitchId, kickoffTime: it.proposedKickoffTime ?? "" })
      return next
    })
    setBoard((b) => {
      const changedIds = new Set(items.map((i) => i.fixtureId))
      const newlyAllocated: AllocationFixture[] = []
      const unallocated = b.unallocated.filter((f) => {
        if (!changedIds.has(f.fixtureId)) return true
        const item = items.find((i) => i.fixtureId === f.fixtureId)!
        newlyAllocated.push({ ...f, pitchId: item.proposedPitchId, kickoffTime: item.proposedKickoffTime })
        return false
      })
      const fixtures = [
        ...b.fixtures.map((f) => {
          if (!changedIds.has(f.fixtureId)) return f
          const item = items.find((i) => i.fixtureId === f.fixtureId)!
          return { ...f, pitchId: item.proposedPitchId, kickoffTime: item.proposedKickoffTime }
        }),
        ...newlyAllocated,
      ]
      return { ...b, fixtures, unallocated }
    })
    setToast(`${items.length} fixture(s) added to your draft -- press Save Changes to apply.`)
    setTimeout(() => setToast(null), 3000)
  }

  /** The ONE point every staged change actually reaches the database -- one allocateFixture call per changed fixture, so each gets exactly one real mutation (and one notification) no matter how many times it was dragged first. */
  async function handleSaveChanges() {
    setSaving(true)
    setError(null)
    const entries = Array.from(pendingChanges.entries())
    const failures: string[] = []
    let proposedCount = 0
    const succeededIds: string[] = []
    for (const [fixtureId, change] of entries) {
      const result = await allocateFixture(clubId, fixtureId, { pitchId: change.pitchId, kickoffTime: change.kickoffTime })
      if (!result.ok) {
        failures.push(`${result.error ?? "Could not save that change."}`)
      } else {
        succeededIds.push(fixtureId)
        if (result.kickoffProposed) proposedCount++
      }
    }
    setSaving(false)
    setPendingChanges((prev) => {
      const next = new Map(prev)
      for (const id of succeededIds) next.delete(id)
      return next
    })
    router.refresh()
    if (failures.length > 0) {
      setError(`${succeededIds.length} change(s) saved. ${failures.length} could not be saved: ${failures.join(" ")}`)
      return
    }
    setToast(proposedCount > 0 ? `Saved. ${proposedCount} kick-off change(s) sent to the opposing club for confirmation.` : "Changes saved.")
    setTimeout(() => setToast(null), 4000)
  }

  /** Reverts every staged-but-unsaved change back to the last real server state -- nothing was ever written, so this is a pure client-side reset. */
  function handleDiscardChanges() {
    setBoard(lastSeenInitialBoard)
    setPendingChanges(new Map())
    setError(null)
    setToast(null)
  }

  useEffect(() => {
    if (!isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  /**
   * Section 13-17: which pitch row (if any) is under a given viewport Y,
   * and the 15-min-snapped time under a given viewport X, hit-tested
   * against the row's OWN live bounding rect (see the coordinate-math
   * comment this replaced -- getBoundingClientRect already reflects
   * horizontal scroll, so no manual scrollLeft adjustment is needed here
   * either).
   */
  function hitTest(clientX: number, clientY: number): { pitchId: string | null; minutes: number } {
    let hitPitchId: string | null = null
    let refRect: DOMRect | null = null
    for (const [pitchId, el] of rowRefs.current) {
      const rect = el.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        hitPitchId = pitchId
        refRect = rect
        break
      }
    }
    // Off the bottom/top of every row -- still compute a time preview
    // against the nearest row so the ghost has something sane to show,
    // but hitPitchId stays null so a drop there is refused.
    if (!refRect) refRect = rowRefs.current.values().next().value?.getBoundingClientRect() ?? null
    const offsetX = refRect ? clientX - refRect.left : 0
    const rawMinutes = START_MINUTES + Math.round(offsetX / PX_PER_SLOT) * SLOT_MINUTES
    const minutes = Math.min(Math.max(rawMinutes, START_MINUTES), END_MINUTES - SLOT_MINUTES)
    return { pitchId: hitPitchId, minutes }
  }

  function handlePointerDown(e: React.PointerEvent, fixture: AllocationFixture) {
    if (e.button !== undefined && e.button !== 0) return
    const { pitchId, minutes } = hitTest(e.clientX, e.clientY)
    setDrag({
      fixtureId: fixture.fixtureId,
      pointerId: e.pointerId,
      pitchId: fixture.pitchId ?? pitchId,
      minutes: fixture.kickoffTime ? timeToMinutes(fixture.kickoffTime) : minutes,
    })
    try {
      // Real browsers can throw here in edge cases (the pointer already
      // released between the event dispatching and this handler running,
      // certain Safari/Firefox quirks) -- caught live while testing this
      // pass. Losing capture only means pointermove/pointerup might not
      // keep firing on this exact element if the pointer leaves it, not
      // that the drag itself is broken, so this is never fatal.
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Non-fatal -- see comment above.
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { pitchId, minutes } = hitTest(e.clientX, e.clientY)
    setDrag((d) => (d ? { ...d, pitchId, minutes } : d))
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { fixtureId, pitchId, minutes } = drag
    setDrag(null)
    if (!pitchId) return // released off every row -- treated as a cancel, not a move
    handleMove(fixtureId, pitchId, minutesToTime(minutes))
  }

  async function handleAutoAllocate(recalculateAll = false) {
    setAutoAllocating(true)
    setError(null)
    const result = await createPitchAllocationProposal(clubId, dateIso, recalculateAll)
    setAutoAllocating(false)
    if (!result.ok || !result.proposalId) {
      setError(result.error ?? "Could not build a proposal.")
      return
    }
    setProposalId(result.proposalId)
  }

  /**
   * Section 5-7: when the club has opted in (Club Settings toggle), a
   * proposal is generated automatically for REVIEW ONLY the first time
   * this date is opened with unallocated home fixtures on it -- never
   * auto-applied (that stays a deliberate click in ProposalReview), and
   * never re-triggered on this same page view once a proposal already
   * exists or the user has already discarded/applied one (proposalId
   * having been set at all is enough of a guard -- re-running after a
   * discard would silently regenerate the exact proposal the user just
   * dismissed). autoTriggeredForDate guards against re-firing on every
   * board state update (e.g. after a manual drag) for the same date.
   */
  useEffect(() => {
    if (!board.policy.autoAllocateHomeFixtures) return
    if (board.unallocated.length === 0) return
    if (proposalId) return
    if (autoTriggeredForDate.current === dateIso) return
    autoTriggeredForDate.current = dateIso
    handleAutoAllocate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleAutoAllocate reads clubId/dateIso props (stable for this mount), not board state; including it would re-run on every board change.
  }, [dateIso, board.policy.autoAllocateHomeFixtures, board.unallocated.length, proposalId])

  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNowLine = dateIso === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` && nowMinutes >= START_MINUTES && nowMinutes <= END_MINUTES

  return (
    <div className="mt-6">
      {/* Restrained return path to the normal Calendar view -- carries the
          selected date through as the week anchor (the only canonical state
          this club-wide board has to preserve); Calendar's own season/phase
          resolver already defaults sensibly with no explicit param. Never a
          second Calendar route -- this is the existing week view. */}
      <button
        type="button"
        onClick={() => guardedNavigate(() => router.push(`/calendar?week=${dateIso}`))}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ArrowLeft className="size-3.5" />
        Back to Calendar View
      </button>

      {/* Sticky controls -- Section 54. Save Changes/Discard sit at the far
          right per live request: every drag, move and applied proposal on
          this board only stages a change (see handleMove/stageProposalItems
          above) -- this is the one control that actually writes to the
          database, so it stays the visually loudest thing in the bar. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white/95 p-3 backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(addDaysIso(dateIso, -1))}
            aria-label="Previous day"
            className="flex size-9 items-center justify-center rounded-lg text-ink/50 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronLeft className="size-4" />
          </button>
          <PitchAllocationDatePicker dateIso={dateIso} onChange={navigate} />
          <button
            type="button"
            onClick={() => navigate(addDaysIso(dateIso, 1))}
            aria-label="Next day"
            className="flex size-9 items-center justify-center rounded-lg text-ink/50 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="h-9 gap-1.5"
            onClick={() => handleAutoAllocate(false)}
            disabled={autoAllocating || isDirty || board.unallocated.length === 0}
            title={isDirty ? "Save or discard your current changes before running Auto Allocate again." : board.unallocated.length === 0 ? "Every home fixture for this day already has a pitch and kick-off time -- nothing to auto-allocate." : undefined}
          >
            <Sparkles className="size-3.5" />
            {autoAllocating ? "Allocating…" : "Auto Allocate"}
          </Button>
          {/* Section 48: the ONLY path that ever re-plans an already-allocated fixture -- Auto Allocate above never touches one, by design. */}
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={() => handleAutoAllocate(true)}
            disabled={autoAllocating || isDirty || board.fixtures.length + board.unallocated.length === 0}
            title={isDirty ? "Save or discard your current changes before running Recalculate All." : "Re-plan every home fixture for this day from scratch, including ones already on a pitch. Still just a proposal -- nothing changes until you apply it."}
          >
            Recalculate All
          </Button>
          <div className="mx-1 h-6 w-px bg-ink/10" aria-hidden="true" />
          <Button type="button" variant="ghost" className="h-9" onClick={handleDiscardChanges} disabled={!isDirty || saving}>
            Discard changes
          </Button>
          <Button
            type="button"
            size="lg"
            className={cn("h-9 gap-1.5 font-semibold", isDirty && "shadow-md shadow-pitch-600/40")}
            onClick={handleSaveChanges}
            disabled={!isDirty || saving}
            title={isDirty ? `${pendingChanges.size} unsaved change${pendingChanges.size === 1 ? "" : "s"}` : "No changes to save"}
          >
            <Save className="size-3.5" />
            {saving ? "Saving…" : isDirty ? `Save Changes (${pendingChanges.size})` : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Section 68-70: at-a-glance board summary -- date's total home
          fixture count, how many are allocated vs. still need attention,
          and how many active pitches are available, so a Club Admin never
          has to count cards to know where the day stands. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-sm text-ink/60">
        <span>
          <span className="font-semibold text-ink">{board.fixtures.length + board.unallocated.length}</span> home fixture{board.fixtures.length + board.unallocated.length === 1 ? "" : "s"}
        </span>
        <span>
          <span className="font-semibold text-forest-800">{board.fixtures.length}</span> allocated
        </span>
        {board.unallocated.length > 0 && (
          <span className="flex items-center gap-1 text-amber-700">
            <AlertTriangle className="size-3.5" />
            <span className="font-semibold">{board.unallocated.length}</span> need{board.unallocated.length === 1 ? "s" : ""} attention
          </span>
        )}
        <span>
          <span className="font-semibold text-ink">{activePitches.length}</span> active pitch{activePitches.length === 1 ? "" : "es"}
        </span>
      </div>

      {/* Section 79: tournaments live outside `fixtures` entirely -- never
          silently invisible here, even though they don't appear as a
          timeline card. A pitch a tournament has claimed is also blocked
          from Auto Allocate/Recalculate All (see actions.ts) and flagged
          as a hard conflict if a fixture is already sitting on it. */}
      {board.tournaments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {board.tournaments.map((t) => (
            <p key={t.id} className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              <AlertTriangle className="mr-1.5 inline-block size-3.5 shrink-0 align-text-bottom" />
              Hosting a tournament today: <span className="font-medium">{t.hostTeamLabel}</span>
              {t.pitchDisplayName ? (
                <>
                  {" "}
                  -- <span className="font-medium">{t.pitchDisplayName}</span> is unavailable all day.
                </>
              ) : (
                <> -- no pitch recorded yet; confirm availability manually before allocating others.</>
              )}
            </p>
          ))}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{error}</p>}
      {toast && <p className="mt-3 rounded-lg bg-forest-800/10 px-3.5 py-2.5 text-sm text-forest-900">{toast}</p>}

      {/* Timeline board */}
      <div className="mt-4 overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div ref={scrollRef} className="overflow-x-auto">
          <div style={{ width: 160 + TIMELINE_WIDTH }}>
            {/* Hour header */}
            <div className="flex border-b border-ink/10 bg-chalk">
              <div className="sticky left-0 z-10 w-40 shrink-0 border-r border-ink/10 bg-chalk px-3 py-2 text-xs font-medium tracking-wide text-ink/40 uppercase">Pitch</div>
              <div className="relative" style={{ width: TIMELINE_WIDTH, height: 32 }}>
                {hourMarks.map((m) => (
                  <span key={m} className="absolute top-1.5 text-[11px] font-medium text-ink/50" style={{ left: ((m - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT }}>
                    {formatHour(m)}
                  </span>
                ))}
              </div>
            </div>

            {activePitches.length === 0 && <p className="px-4 py-8 text-sm text-ink/45">No active pitches configured for this club yet -- add pitches in Club Settings.</p>}

            {activePitches.map((pitch) => {
              const fixturesOnPitch = board.fixtures.filter((f) => f.pitchId === pitch.id)
              const isDropTarget = drag !== null && drag.pitchId === pitch.id
              const draggedFixture = drag ? (board.fixtures.find((f) => f.fixtureId === drag.fixtureId) ?? board.unallocated.find((f) => f.fixtureId === drag.fixtureId)) : undefined
              // Section 41-47: a pitch with real concurrent capacity
              // (lane_count > 1, e.g. a full pitch marked out for several
              // simultaneous mini games) renders as that many shorter
              // lanes instead of one single-booking row. An ordinary
              // lane_count=1 pitch (every pitch in this app until this
              // pass) is completely unaffected -- same ROW_HEIGHT, same
              // full-height card, same everything.
              const laneCount = Math.max(1, pitch.laneCount)
              const isMultiLane = laneCount > 1
              const rowHeight = isMultiLane ? LANE_HEIGHT * laneCount : ROW_HEIGHT
              const laneByFixtureId = isMultiLane ? assignLanes(fixturesOnPitch, laneCount) : null
              return (
                <div key={pitch.id} className="flex border-b border-ink/5 last:border-0" style={{ height: rowHeight }}>
                  <div
                    className={cn(
                      "sticky left-0 z-10 flex w-40 shrink-0 flex-col items-center justify-center border-r px-3 text-center transition-colors",
                      isDropTarget ? "border-pitch-400 bg-pitch-50" : "border-ink/10 bg-white"
                    )}
                  >
                    <p className="line-clamp-2 text-sm leading-tight font-medium break-words text-ink">{pitch.displayName}</p>
                    {isMultiLane && <p className="text-[10px] text-ink/40">{laneCount} lanes</p>}
                  </div>
                  <div
                    ref={(el) => {
                      if (el) rowRefs.current.set(pitch.id, el)
                      else rowRefs.current.delete(pitch.id)
                    }}
                    className={cn("relative transition-colors", isDropTarget && "bg-pitch-50/60")}
                    style={{ width: TIMELINE_WIDTH }}
                  >
                    {/* 15-min grid lines, hour lines emphasized */}
                    {slots.map((m) => (
                      <div
                        key={m}
                        className={cn("absolute top-0 bottom-0 border-r", m % 60 === 0 ? "border-ink/10" : "border-ink/[0.04]")}
                        style={{ left: ((m - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT }}
                      />
                    ))}
                    {/* Lane divider lines -- purely visual, so a multi-lane pitch reads as N distinct rows under one physical pitch, not one tall ambiguous strip. */}
                    {isMultiLane &&
                      Array.from({ length: laneCount - 1 }, (_, i) => (
                        <div key={`lane-${i}`} className="absolute right-0 left-0 border-b border-dashed border-ink/10" style={{ top: (i + 1) * LANE_HEIGHT }} />
                      ))}
                    {showNowLine && (
                      <div className="absolute top-0 bottom-0 z-10 w-0.5 bg-destructive/70" style={{ left: ((nowMinutes - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT }} />
                    )}
                    {/* Section 13-17: live drop preview -- a ghost outline plus the proposed time, shown BEFORE release so the user can see exactly where the fixture will land. */}
                    {isDropTarget && draggedFixture && (
                      <div
                        className="pointer-events-none absolute top-1 bottom-1 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-pitch-600 bg-pitch-100/70"
                        style={{
                          left: ((drag!.minutes - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT,
                          width: Math.max(((draggedFixture.durationMinutes ?? 60) / SLOT_MINUTES) * PX_PER_SLOT, 90),
                        }}
                      >
                        <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">{minutesToTime(drag!.minutes)}</span>
                      </div>
                    )}
                    {fixturesOnPitch.map((f) => {
                      const startOffset = ((timeToMinutes(f.kickoffTime!) - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT
                      const width = ((f.durationMinutes ?? 60) / SLOT_MINUTES) * PX_PER_SLOT
                      // FixtureCard enforces a 90px minimum width for very
                      // short fixtures (Math.max(width, 90) in its own
                      // style calc) -- the pack-up band must start at
                      // wherever the card ACTUALLY ends, not the raw
                      // pre-clamp duration width, or it renders partway
                      // through the visible card instead of after it.
                      const cardWidth = Math.max(width, 90)
                      const warmUpWidth = (board.policy.warmUpMinutes / SLOT_MINUTES) * PX_PER_SLOT
                      const packUpWidth = (board.policy.packUpMinutes / SLOT_MINUTES) * PX_PER_SLOT
                      const lane = laneByFixtureId?.get(f.fixtureId) ?? 0
                      const laneTop = isMultiLane ? lane * LANE_HEIGHT + 3 : undefined
                      const laneHeight = isMultiLane ? LANE_HEIGHT - 6 : undefined
                      return (
                        <Fragment key={f.fixtureId}>
                          {/* Section 31-40: warm-up/pack-up buffer bands -- orange, with real text (never color-only) so the reason for the reserved time is legible, not just implied by a tint. */}
                          {warmUpWidth > 0 && (
                            <div
                              key={`${f.fixtureId}-warmup`}
                              role="group"
                              aria-label={`${board.policy.warmUpMinutes}-minute warm-up before ${f.homeTeamLabel} v ${f.opponentLabel}`}
                              title={`Warm-up: ${board.policy.warmUpMinutes} min`}
                              className="absolute flex items-center justify-center overflow-hidden rounded-l-md border border-r-0 border-amber-300 bg-amber-100/70"
                              style={isMultiLane ? { left: startOffset - warmUpWidth, width: warmUpWidth, top: laneTop, height: laneHeight } : { left: startOffset - warmUpWidth, width: warmUpWidth, top: 4, bottom: 4 }}
                            >
                              {warmUpWidth >= 16 && <span className="rotate-90 truncate text-[8px] font-semibold tracking-wide whitespace-nowrap text-amber-800 uppercase">Warm-up</span>}
                            </div>
                          )}
                          <FixtureCard
                            key={f.fixtureId}
                            fixture={f}
                            conflict={conflictFor(f.fixtureId, liveConflicts)}
                            left={startOffset}
                            width={width}
                            top={laneTop}
                            height={laneHeight}
                            draggable
                            isDragSource={drag?.fixtureId === f.fixtureId}
                            onPointerDownCard={(e) => handlePointerDown(e, f)}
                            onPointerMoveCard={handlePointerMove}
                            onPointerUpCard={handlePointerUp}
                            onOpenMove={() => setMoving(f)}
                          />
                          {packUpWidth > 0 && (
                            <div
                              key={`${f.fixtureId}-packup`}
                              role="group"
                              aria-label={`${board.policy.packUpMinutes}-minute pack-up after ${f.homeTeamLabel} v ${f.opponentLabel}`}
                              title={`Pack-up: ${board.policy.packUpMinutes} min`}
                              className="absolute flex items-center justify-center overflow-hidden rounded-r-md border border-l-0 border-amber-300 bg-amber-100/70"
                              style={isMultiLane ? { left: startOffset + cardWidth, width: packUpWidth, top: laneTop, height: laneHeight } : { left: startOffset + cardWidth, width: packUpWidth, top: 4, bottom: 4 }}
                            >
                              {packUpWidth >= 16 && <span className="rotate-90 truncate text-[8px] font-semibold tracking-wide whitespace-nowrap text-amber-800 uppercase">Pack-up</span>}
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {inactivePitches.length > 0 && (
        <p className="mt-2 text-xs text-ink/40">{inactivePitches.length} inactive pitch(es) hidden from allocation (historical fixture references are preserved).</p>
      )}

      {/* Unallocated tray -- Section 13 */}
      <div className="mt-6">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Unallocated fixtures ({board.unallocated.length})</p>
        {board.unallocated.length === 0 ? (
          <p className="mt-2 text-sm text-ink/45">Every home fixture for this day has a pitch and kick-off time.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {board.unallocated.map((f) => (
              <div key={f.fixtureId} className="w-56">
                <FixtureCard
                  fixture={f}
                  conflict={conflictFor(f.fixtureId, liveConflicts)}
                  draggable={false}
                  onOpenMove={() => setMoving(f)}
                  reason={unallocatedReason(f, board.pitches)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {moving && (
        <MoveFixtureDialog
          fixture={moving}
          pitches={board.pitches}
          onClose={() => setMoving(null)}
          onMove={async (pitchId, time) => {
            await handleMove(moving.fixtureId, pitchId, time)
            setMoving(null)
          }}
        />
      )}

      {proposalId && (
        <ProposalReview
          clubId={clubId}
          proposalId={proposalId}
          onClose={() => setProposalId(null)}
          onStage={(items) => {
            setProposalId(null)
            stageProposalItems(items)
          }}
        />
      )}

      {/* Live save-gating request: leaving with a staged-but-unsaved change
          (date nav, the day arrows, or the calendar-view link above) is
          blocked behind this, never silently discarded. Tab close/refresh
          is covered separately by the beforeunload listener above, which
          the browser's own native prompt handles. */}
      {confirmDiscardAction && (
        <div role="dialog" aria-modal="true" aria-label="Unsaved changes" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="font-display text-lg text-ink">Unsaved changes</p>
            <p className="mt-1.5 text-sm text-ink/60">
              You have {pendingChanges.size} unsaved change{pendingChanges.size === 1 ? "" : "s"} on this board. Leaving now discards {pendingChanges.size === 1 ? "it" : "them"} -- nothing has been saved yet.
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button type="button" variant="outline" className="h-9" onClick={() => setConfirmDiscardAction(null)}>
                Keep editing
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-9"
                onClick={() => {
                  const action = confirmDiscardAction
                  handleDiscardChanges()
                  setConfirmDiscardAction(null)
                  action?.()
                }}
              >
                Discard changes and leave
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
