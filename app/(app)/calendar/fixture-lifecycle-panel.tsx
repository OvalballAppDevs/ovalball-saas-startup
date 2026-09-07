"use client"

import { useState } from "react"
import { Info, MessageSquare } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

import { FIXTURE_ACTION_BUTTON_DESTRUCTIVE, FIXTURE_ACTION_BUTTON_SECONDARY } from "./fixture-action-button-styles"
import { cancelFixtureWithReason, deleteFixtureWithReason } from "./fixture-lifecycle-actions"

export interface FixtureLifecycleFixture {
  id: string
  opposition: string
  date: string
  time: string | null
  status: string
  cancelledAt: string | null
  cancelledByName: string | null
  cancellationReason: string | null
}

/** Section E: cancellation reason/actor/timestamp behind a small info button -- "Cancelled" itself is already always visible via the status badge (Section E: "Back-office Calendar rendering should make cancellation visually obvious"), this is only the detail. Same pattern as Training's own CancellationInfoDialog. */
function FixtureCancellationInfoDialog({ fixture, onClose }: { fixture: FixtureLifecycleFixture; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Cancellation details" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Cancellation Details</p>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-ink-muted">Reason</dt>
            <dd className="mt-0.5 text-ink">{fixture.cancellationReason ?? "--"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-muted">Cancelled by</dt>
            <dd className="mt-0.5 text-ink">{fixture.cancelledByName ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-muted">Cancelled</dt>
            <dd className="mt-0.5 text-ink">{fixture.cancelledAt ? new Date(fixture.cancelledAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }) : "--"}</dd>
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

/** Section E: destructive, RED, reason required -- same visual language and wording shape as Training's CancelSessionDialog, adapted for a fixture's two-sided consequence (mirror sync, mentioned explicitly so the actor understands the opposing club sees it too). */
function CancelFixtureDialog({ fixture, onClose, onCancelled }: { fixture: FixtureLifecycleFixture; onClose: () => void; onCancelled: () => void }) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedReason = reason.trim()

  async function handleConfirm() {
    if (trimmedReason === "") {
      setError("A reason is required to cancel this fixture.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await cancelFixtureWithReason(fixture.id, trimmedReason)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCancelled()
  }

  const dateLabel = new Date(`${fixture.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div role="dialog" aria-modal="true" aria-label="Cancel Fixture" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Cancel this fixture?</p>
        <p className="mt-2 text-sm text-ink/70">
          This will cancel the fixture against <strong>{fixture.opposition}</strong> on <strong>{dateLabel}</strong>
          {fixture.time ? ` at ${fixture.time.slice(0, 5)}` : ""}.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          This will remove the fixture from Parent and Player calendars, but it will remain visible to authorised back-office
          staff for operational records. If the opposition is also on Ovalball, their own record of this fixture is cancelled too.
        </p>
        <p className="mt-2 text-sm text-ink/70">The pitch is freed up immediately, and any messages or history stay attached for audit.</p>

        <label htmlFor="cancel-fixture-reason" className="mt-4 block text-sm font-medium text-ink/70">
          Reason for cancellation
        </label>
        <textarea
          id="cancel-fixture-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Opposition unable to field a team, pitch closed because of weather"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Keep Fixture
          </Button>
          <Button type="button" variant="destructive" className="h-9" onClick={handleConfirm} disabled={saving || trimmedReason === ""}>
            {saving ? "Cancelling…" : "Confirm Cancellation"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Section G: a STRONGER confirmation than Cancel -- archives the fixture off every normal operational surface entirely, distinct from Cancel (which stays visible to back-office). Never a physical delete. */
function DeleteFixtureDialog({ fixture, onClose, onDeleted }: { fixture: FixtureLifecycleFixture; onClose: () => void; onDeleted: () => void }) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedReason = reason.trim()

  async function handleConfirm() {
    if (trimmedReason === "") {
      setError("A reason is required to delete this fixture.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await deleteFixtureWithReason(fixture.id, trimmedReason)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDeleted()
  }

  const dateLabel = new Date(`${fixture.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div role="dialog" aria-modal="true" aria-label="Delete Fixture" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-destructive-text">Delete this fixture?</p>
        <p className="mt-2 text-sm text-ink/70">
          The fixture against <strong>{fixture.opposition}</strong> on <strong>{dateLabel}</strong> will be removed from normal
          Calendar and Fixture Management views for everyone, including your own back-office staff.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          The record is archived, not deleted -- it stays retrievable in Deleted Calendar Events for authorised administrative
          records, and can be restored later if needed. This is stronger and different from Cancel, which keeps a fixture
          visible to back-office staff.
        </p>

        <label htmlFor="delete-fixture-reason" className="mt-4 block text-sm font-medium text-ink/70">
          Reason for deleting this fixture
        </label>
        <textarea
          id="delete-fixture-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Duplicate entry, created in error"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Keep Fixture
          </Button>
          <Button type="button" variant="destructive" className="h-9" onClick={handleConfirm} disabled={saving || trimmedReason === ""}>
            {saving ? "Deleting…" : "Delete Fixture"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Section C/T: the new Calendar fixture lifecycle actions -- Message Club
 * (only when the opposition genuinely resolves to a claimed, active
 * Ovalball club), Cancel Fixture, Delete Fixture. Inserted alongside the
 * EXISTING Edit/Open Fixture/Directions actions in each of week-board.tsx/
 * month-view.tsx/mobile-agenda.tsx's own fixture Sheet -- deliberately not
 * a redesign of that Sheet, just the missing safe actions plumbed in.
 */
export function FixtureLifecycleActions({
  fixture,
  canCancel,
  canDelete,
  canMessageClub,
  onChanged,
}: {
  fixture: FixtureLifecycleFixture
  canCancel: boolean
  canDelete: boolean
  canMessageClub: boolean
  onChanged: () => void
}) {
  const [dialog, setDialog] = useState<"cancel" | "delete" | "info" | null>(null)
  const isCancelled = fixture.status === "Cancelled"

  return (
    <>
      {canMessageClub && (
        <Link href={`/messages/fixture/${fixture.id}`} className={FIXTURE_ACTION_BUTTON_SECONDARY}>
          <MessageSquare className="size-3.5" />
          Message Club
        </Link>
      )}
      {canCancel && !isCancelled && (
        <button type="button" onClick={() => setDialog("cancel")} className={FIXTURE_ACTION_BUTTON_DESTRUCTIVE}>
          Cancel Fixture
        </button>
      )}
      {canDelete && (
        <button type="button" onClick={() => setDialog("delete")} className={FIXTURE_ACTION_BUTTON_DESTRUCTIVE}>
          Delete Fixture
        </button>
      )}
      {isCancelled && (
        <button type="button" onClick={() => setDialog("info")} className={FIXTURE_ACTION_BUTTON_SECONDARY}>
          <Info className="size-3.5" />
          Cancellation Details
        </button>
      )}

      {dialog === "info" && <FixtureCancellationInfoDialog fixture={fixture} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && (
        <CancelFixtureDialog
          fixture={fixture}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null)
            onChanged()
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteFixtureDialog
          fixture={fixture}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}
