"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { endGuardianRelationship, holdGuardianRelationship, liftGuardianRelationshipHold } from "./family-actions"

export interface FamilyRelationshipRow {
  guardianId: string
  childName: string
  relationshipType: string
  state: "ACTIVE" | "SUSPENDED"
  confidential: boolean
  holdReason: string | null
}

type Mode = "hold" | "lift" | "end"

const MODE_BUTTON: Record<Mode, string> = { hold: "Put on Hold", lift: "Lift Hold", end: "End Relationship" }

/**
 * Site Admin control over one person's guardian relationships (Phase 2 AN-7). A hold stops everything the
 * relationship allows until it is lifted; ending it is permanent (linking again creates a new relationship).
 * Every change needs a reason and is recorded as a security event.
 */
export function FamilyRelationshipsPanel({ userId, rows }: { userId: string; rows: FamilyRelationshipRow[] }) {
  const [openFor, setOpenFor] = useState<{ guardianId: string; mode: Mode } | null>(null)
  const [reason, setReason] = useState("")
  const [confidential, setConfidential] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
        This person is not a parent or guardian of any child in Ovalball.
      </p>
    )
  }

  function open(guardianId: string, mode: Mode) {
    setOpenFor({ guardianId, mode })
    setReason("")
    setConfidential(false)
    setError(null)
  }

  async function confirm() {
    if (!openFor) return
    setWorking(true)
    setError(null)
    const result =
      openFor.mode === "hold"
        ? await holdGuardianRelationship(userId, openFor.guardianId, reason, confidential)
        : openFor.mode === "lift"
          ? await liftGuardianRelationshipHold(userId, openFor.guardianId, reason)
          : await endGuardianRelationship(userId, openFor.guardianId, reason)
    setWorking(false)
    if (result.ok) setOpenFor(null)
    else setError(result.error)
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const isOpen = openFor?.guardianId === row.guardianId
        return (
          <li key={row.guardianId} className={`rounded-lg border p-4 ${row.state === "SUSPENDED" ? "border-amber-500/30 bg-amber-500/5" : "border-ink/10 bg-white"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{row.childName}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {row.relationshipType === "other_with_parental_responsibility" ? "Parental responsibility" : row.relationshipType.charAt(0).toUpperCase() + row.relationshipType.slice(1)}
                  {row.state === "SUSPENDED" ? ` · On hold${row.confidential ? " (confidential)" : ""}` : " · Active"}
                </p>
                {row.state === "SUSPENDED" && row.holdReason && <p className="mt-1 text-sm text-ink/70">Reason: {row.holdReason}</p>}
              </div>
              {!isOpen && (
                <div className="flex flex-wrap gap-2">
                  {row.state === "ACTIVE" ? (
                    <Button type="button" variant="outline" className="h-9" onClick={() => open(row.guardianId, "hold")}>
                      Put on Hold
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" className="h-9" onClick={() => open(row.guardianId, "lift")}>
                      Lift Hold
                    </Button>
                  )}
                  <Button type="button" variant="ghost" className="h-9 text-destructive-text hover:bg-destructive/10" onClick={() => open(row.guardianId, "end")}>
                    End Relationship
                  </Button>
                </div>
              )}
            </div>

            {isOpen && openFor && (
              <div className="mt-3 flex flex-col gap-3 border-t border-ink/8 pt-3">
                <label className="flex flex-col gap-1.5 text-sm text-ink">
                  <span className="font-medium">Reason</span>
                  <textarea
                    className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {openFor.mode === "hold" && (
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input type="checkbox" className="mt-0.5 size-4" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
                    <span>
                      <span className="font-medium">Confidential Hold</span>
                      <span className="block text-ink-muted">Only the club&apos;s Safeguarding Officers are told. The child&apos;s other guardians are not.</span>
                    </span>
                  </label>
                )}
                {openFor.mode === "end" && (
                  <p className="text-sm text-ink-muted">Ending a relationship is permanent. Linking this adult again creates a new relationship.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={openFor.mode === "end" ? "destructive" : "default"} className="h-9" disabled={working || reason.trim() === ""} onClick={confirm}>
                    {working ? "Saving…" : MODE_BUTTON[openFor.mode]}
                  </Button>
                  <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={() => setOpenFor(null)}>
                    Cancel
                  </Button>
                </div>
                {error && <p className="text-sm text-destructive-text">{error}</p>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
