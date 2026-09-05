"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { cancelFixture, deleteFixture } from "../actions"

/** Two-tier hierarchy, matching Club/User Management's own pattern: Cancel is the normal reversible-in-spirit administrative action (preserves history, messages, audit); Permanent delete is blocked whenever any message or fixture request references this fixture. */
export function FixtureDangerZone({ fixtureId, status, hasHistory }: { fixtureId: string; status: string; hasHistory: boolean }) {
  const router = useRouter()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    setCancelling(true)
    setError(null)
    const result = await cancelFixture(fixtureId, reason)
    setCancelling(false)
    if (result.ok) {
      setShowCancelForm(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    const result = await deleteFixture(fixtureId)
    setDeleting(false)
    if (result.ok) {
      router.push("/admin/fixtures")
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {status !== "Cancelled" && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-sm font-medium text-ink">Cancel this fixture</p>
          <p className="mt-0.5 text-sm text-ink/55">
            Marks it cancelled. History, messages, and audit stay intact -- this is the normal way to remove a
            fixture from play.
          </p>
          {!showCancelForm ? (
            <Button type="button" variant="outline" className="mt-3 h-9" onClick={() => setShowCancelForm(true)}>
              Cancel fixture
            </Button>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional, shown in audit history)"
                rows={2}
                className="w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="destructive" className="h-9" disabled={cancelling} onClick={handleCancel}>
                  {cancelling ? "Cancelling…" : "Confirm cancel"}
                </Button>
                <Button type="button" variant="ghost" className="h-9" disabled={cancelling} onClick={() => setShowCancelForm(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-destructive/25 bg-destructive/[0.03] p-4">
        <p className="text-sm font-medium text-destructive">Permanently delete this fixture</p>
        <p className="mt-0.5 text-sm text-ink/55">Only possible when nothing else references it. This cannot be undone.</p>
        {!deleteOpen ? (
          <Button type="button" variant="destructive" className="mt-3 h-9" onClick={() => setDeleteOpen(true)}>
            Permanently delete&hellip;
          </Button>
        ) : hasHistory ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            This fixture cannot be permanently deleted because it has messages or a fixture request linked to it. Cancel it instead.
          </p>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="destructive" className="h-9" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Confirm permanent delete"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
