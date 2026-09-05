"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Info, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  cancelTrainingSessionWithReason,
  deleteTrainingPlan,
  editTrainingSession,
  getMyPlayersForTrainingSession,
  getTrainingPlanDeletionImpact,
  getTrainingRegister,
  getTrainingSessionCard,
  respondToTrainingAttendance,
  type MyTrainingPlayer,
  type TrainingRegisterRow,
  type TrainingSessionCard,
} from "./training-session-actions"

const ATTENDANCE_LABEL: Record<string, string> = {
  ATTENDING: "Attending",
  CANNOT_ATTEND: "Cannot attend",
  UNSURE: "Unsure",
}

/**
 * Section 12: cancellation details behind a small accessible info button --
 * "CANCELLED" itself is always visible outside this (Section 45), this is
 * only the reason/actor/timestamp detail.
 */
function CancellationInfoDialog({ card, onClose }: { card: TrainingSessionCard; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Cancellation details" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Cancellation Details</p>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-ink/50">Reason</dt>
            <dd className="mt-0.5 text-ink">{card.cancellationReason}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink/50">Cancelled by</dt>
            <dd className="mt-0.5 text-ink">{card.cancelledByName ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink/50">Cancelled</dt>
            <dd className="mt-0.5 text-ink">{card.cancelledAt ? new Date(card.cancelledAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }) : "--"}</dd>
          </div>
        </dl>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Section 8: destructive, RED, reason required, exact impact stated up front. */
function CancelSessionDialog({ card, onClose, onCancelled }: { card: TrainingSessionCard; onClose: () => void; onCancelled: () => void }) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedReason = reason.trim()

  async function handleConfirm() {
    if (trimmedReason === "") {
      setError("A reason is required to cancel this training session.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await cancelTrainingSessionWithReason(card.id, trimmedReason)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCancelled()
  }

  const dateLabel = new Date(`${card.sessionDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div role="dialog" aria-modal="true" aria-label="Cancel Training Session" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Cancel Training Session</p>
        <p className="mt-2 text-sm text-ink/70">
          This will cancel this training session for <strong>{card.teamLabel}</strong> on <strong>{dateLabel}</strong>
          {card.startTime ? ` at ${card.startTime.slice(0, 5)}` : ""}.
        </p>
        <p className="mt-2 text-sm text-ink/70">Parents, players and authorised staff will see that the session has been cancelled.</p>
        <p className="mt-2 text-sm text-ink/70">Any existing attendance responses will remain attached to the cancelled record for historical/audit purposes.</p>

        <label htmlFor="cancel-reason" className="mt-4 block text-sm font-medium text-ink/70">
          Reason for cancellation
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Coach unavailable, pitch closed because of weather"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Keep Training
          </Button>
          <Button type="button" variant="destructive" className="h-9" onClick={handleConfirm} disabled={saving || trimmedReason === ""}>
            {saving ? "Cancelling…" : "Confirm Cancellation"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Section 16: RED destructive confirmation, exact impact (team/schedule/venue/pitch/future count) shown before the action, reason required. */
function DeleteTrainingPlanDialog({ card, onClose, onDeleted }: { card: TrainingSessionCard; onClose: () => void; onDeleted: () => void }) {
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof getTrainingPlanDeletionImpact>> | null>(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedReason = reason.trim()

  useEffect(() => {
    if (!card.trainingPlanId) return
    getTrainingPlanDeletionImpact(card.trainingPlanId).then(setImpact)
  }, [card.trainingPlanId])

  async function handleConfirm() {
    if (!card.trainingPlanId) return
    if (trimmedReason === "") {
      setError("A reason is required to delete this Training Plan.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await deleteTrainingPlan(card.trainingPlanId, trimmedReason)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDeleted()
  }

  const impactData = impact?.ok ? impact.data : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Delete Training Plan" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Delete Training Plan</p>
        <p className="mt-2 text-sm text-ink/70">This training session is part of a recurring plan.</p>
        {!impact ? (
          <p className="mt-3 text-sm text-ink/45">Loading impact…</p>
        ) : !impactData ? (
          <p className="mt-3 text-sm text-destructive">{impact.ok ? "" : impact.error}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink/70">
              Deleting the plan will stop future training from this plan and cancel <strong>{impactData.futureSessionCount}</strong> future scheduled session{impactData.futureSessionCount === 1 ? "" : "s"}.
            </p>
            <p className="mt-2 text-sm text-ink/70">Past training records and registers will be kept.</p>
            <dl className="mt-3 flex flex-col gap-1 rounded-lg bg-chalk px-3 py-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink/50">Team</dt>
                <dd className="text-ink">{impactData.teamLabel}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/50">Schedule</dt>
                <dd className="text-ink">{impactData.scheduleMode}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/50">Venue</dt>
                <dd className="text-ink">{impactData.venueName ?? "--"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/50">Preferred Pitch</dt>
                <dd className="text-ink">{impactData.pitchName ?? "--"}</dd>
              </div>
            </dl>
          </>
        )}

        <label htmlFor="delete-plan-reason" className="mt-4 block text-sm font-medium text-ink/70">
          Reason for deleting training plan
        </label>
        <textarea
          id="delete-plan-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Keep Plan
          </Button>
          <Button type="button" variant="destructive" className="h-9" onClick={handleConfirm} disabled={saving || trimmedReason === "" || !impactData}>
            {saving ? "Deleting…" : "Delete Plan & Cancel Future Training"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function EditSessionDialog({ card, onClose, onSaved }: { card: TrainingSessionCard; onClose: () => void; onSaved: () => void }) {
  const [agenda, setAgenda] = useState(card.agenda)
  const [furtherNotes, setFurtherNotes] = useState(card.furtherNotes ?? "")
  const [startTime, setStartTime] = useState(card.startTime?.slice(0, 5) ?? "")
  const [durationMinutes, setDurationMinutes] = useState(card.durationMinutes ?? 60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (agenda.trim() === "") {
      setError("Agenda cannot be blank.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await editTrainingSession(card.id, {
      agenda: agenda.trim(),
      furtherNotes: furtherNotes.trim(),
      startTime: startTime || undefined,
      durationMinutes,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit Training Details" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Edit Training Details</p>
        <p className="mt-1 text-xs text-ink/50">Changes apply to this session only -- the recurring plan&apos;s own defaults are unaffected.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-start-time" className="text-xs font-medium text-ink/60">
              Start time
            </label>
            <input
              id="edit-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            />
          </div>
          <div>
            <label htmlFor="edit-duration" className="text-xs font-medium text-ink/60">
              Duration (minutes)
            </label>
            <input
              id="edit-duration"
              type="number"
              min={15}
              max={240}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            />
          </div>
        </div>

        <label htmlFor="edit-agenda" className="mt-4 block text-sm font-medium text-ink/70">
          Agenda
        </label>
        <textarea
          id="edit-agenda"
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          maxLength={4000}
          rows={4}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        <label htmlFor="edit-notes" className="mt-4 block text-sm font-medium text-ink/70">
          Notes for players and families
        </label>
        <textarea
          id="edit-notes"
          value={furtherNotes}
          onChange={(e) => setFurtherNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="e.g. Please bring gum shields."
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="h-9" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RegisterView({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [rows, setRows] = useState<TrainingRegisterRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTrainingRegister(sessionId).then((r) => (r.ok ? setRows(r.data) : setError(r.error)))
  }, [sessionId])

  const counts = rows
    ? {
        attending: rows.filter((r) => r.status === "ATTENDING").length,
        cannotAttend: rows.filter((r) => r.status === "CANNOT_ATTEND").length,
        unsure: rows.filter((r) => r.status === "UNSURE").length,
        noResponse: rows.filter((r) => !r.status).length,
      }
    : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Training register" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-ink/10 px-5 py-4">
          <p className="font-display text-lg text-ink">Register</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!rows && !error && <p className="text-sm text-ink/45">Loading…</p>}
          {counts && (
            <p className="mb-3 text-sm text-ink/60">
              <span className="font-medium text-forest-900">{counts.attending} Attending</span> · {counts.cannotAttend} Cannot Attend · {counts.unsure} Unsure · {counts.noResponse} No Response
            </p>
          )}
          {rows && (
            <ul className="flex flex-col divide-y divide-ink/5">
              {rows.map((r) => (
                <li key={r.playerId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">
                    {r.firstName} {r.surname}
                  </span>
                  <span className={cn("text-xs font-medium", r.status === "ATTENDING" ? "text-forest-800" : r.status === "CANNOT_ATTEND" ? "text-destructive" : r.status === "UNSURE" ? "text-amber-700" : "text-ink/40")}>
                    {r.status ? ATTENDANCE_LABEL[r.status] : "No response"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end border-t border-ink/10 px-5 py-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: the ONE canonical
 * Training Session card (Section 26-27, 63, 98) -- fetches
 * get_training_session_card fresh by training_session_id every time it
 * opens, so Calendar/Dashboard/Training Management/Team Admin all show
 * the exact same live record, never a cached copy.
 */
export function TrainingSessionDetail({ sessionId, fallbackLabel, onChanged, onClose }: { sessionId: string; fallbackLabel: string; onChanged: () => void; onClose: () => void }) {
  const [card, setCard] = useState<TrainingSessionCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [myPlayers, setMyPlayers] = useState<MyTrainingPlayer[] | null>(null)
  const [respondingPlayerId, setRespondingPlayerId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"cancel" | "delete-plan" | "edit" | "cancellation-info" | "register" | null>(null)

  function reload() {
    getTrainingSessionCard(sessionId).then((r) => (r.ok ? setCard(r.data) : setError(r.error)))
    getMyPlayersForTrainingSession(sessionId).then((r) => (r.ok ? setMyPlayers(r.data) : setMyPlayers([])))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is stable for this sessionId's lifetime; re-running on sessionId change only is intentional.
  }, [sessionId])

  async function handleRespond(playerId: string, status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE") {
    setRespondingPlayerId(playerId)
    const result = await respondToTrainingAttendance(sessionId, playerId, status)
    setRespondingPlayerId(null)
    if (result.ok) reload()
  }

  if (error) return <p className="px-4 text-sm text-destructive">{error}</p>
  if (!card) return <p className="px-4 text-sm text-ink/45">Loading {fallbackLabel}…</p>

  const isCancelled = card.status === "CANCELLED"
  const dateLabel = new Date(`${card.sessionDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", isCancelled ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-sky-400/40 bg-sky-50 text-sky-900")}>
          {isCancelled ? "CANCELLED" : card.status}
        </span>
        {isCancelled && (
          <button
            type="button"
            aria-label="View cancellation details"
            onClick={() => setDialog("cancellation-info")}
            className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-2 py-1 text-xs font-medium text-ink/60 outline-none hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Info className="size-3" />
            Cancellation details
          </button>
        )}
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Date</dt>
          <dd className="text-ink">
            {dateLabel}
            {card.startTime ? ` · ${card.startTime.slice(0, 5)}${card.endTime ? `–${card.endTime.slice(0, 5)}` : ""}` : ""}
          </dd>
        </div>
        {card.venueName && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink/50">Venue</dt>
            <dd className="text-ink">{card.venueName}</dd>
          </div>
        )}
        {card.pitchName && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink/50">Pitch</dt>
            <dd className="text-ink">{card.pitchName}</dd>
          </div>
        )}
      </dl>

      <div className="rounded-lg border border-ink/10 bg-chalk px-3 py-2.5">
        <p className="text-xs font-medium tracking-wide text-ink/50 uppercase">Agenda</p>
        <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{card.agenda}</p>
      </div>
      {card.furtherNotes && (
        <div className="rounded-lg border border-ink/10 px-3 py-2.5">
          <p className="text-xs font-medium tracking-wide text-ink/50 uppercase">Notes for players and families</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{card.furtherNotes}</p>
        </div>
      )}

      {!isCancelled && myPlayers && myPlayers.length > 0 && (
        <div className="border-t border-ink/10 pt-3">
          <p className="text-xs font-medium tracking-wide text-ink/50 uppercase">Attendance</p>
          {myPlayers.map((mp) => (
            <div key={mp.playerId} className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink">
                {mp.firstName} {mp.surname}
              </span>
              <div className="flex gap-1.5" role="group" aria-label={`Attendance for ${mp.firstName}`}>
                {(["ATTENDING", "UNSURE", "CANNOT_ATTEND"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={mp.currentStatus === status}
                    disabled={respondingPlayerId === mp.playerId}
                    onClick={() => handleRespond(mp.playerId, status)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                      mp.currentStatus === status ? "border-pitch-600 bg-pitch-600 text-white" : "border-ink/15 bg-white text-ink/70 hover:border-ink/30"
                    )}
                  >
                    {ATTENDANCE_LABEL[status]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {isCancelled && myPlayers && myPlayers.some((p) => p.currentStatus) && (
        <div className="border-t border-ink/10 pt-3">
          <p className="text-xs font-medium tracking-wide text-ink/50 uppercase">Attendance (historical -- session cancelled)</p>
          {myPlayers
            .filter((p) => p.currentStatus)
            .map((mp) => (
              <p key={mp.playerId} className="mt-1 text-sm text-ink/60">
                {mp.firstName} {mp.surname}: {ATTENDANCE_LABEL[mp.currentStatus!]}
              </p>
            ))}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
        {card.canViewRegister && (
          <button
            type="button"
            onClick={() => setDialog("register")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Users className="size-3.5" />
            View Register
          </button>
        )}
        {card.canManage && !isCancelled && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Edit Training Details
          </button>
        )}
        {card.canManage && !isCancelled && (
          <button
            type="button"
            onClick={() => setDialog("cancel")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-white px-3 py-2 text-sm font-medium text-destructive outline-none hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <AlertTriangle className="size-3.5" />
            Cancel This Training Session
          </button>
        )}
        {card.canManage && card.trainingPlanId && (
          <button
            type="button"
            onClick={() => setDialog("delete-plan")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-white px-3 py-2 text-sm font-medium text-destructive outline-none hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Delete Training Plan
          </button>
        )}
      </div>

      {dialog === "cancellation-info" && <CancellationInfoDialog card={card} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && (
        <CancelSessionDialog
          card={card}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null)
            reload()
            onChanged()
          }}
        />
      )}
      {dialog === "delete-plan" && (
        <DeleteTrainingPlanDialog
          card={card}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null)
            onChanged()
            onClose()
          }}
        />
      )}
      {dialog === "edit" && (
        <EditSessionDialog
          card={card}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reload()
            onChanged()
          }}
        />
      )}
      {dialog === "register" && <RegisterView sessionId={sessionId} onClose={() => setDialog(null)} />}
    </div>
  )
}
