"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import { CLAIMABLE_ROLES, type ClaimableRole } from "@ovalball/contracts/clubhouse"

import { submitClubClaim } from "./claim-actions"

const MIN_DECLARATION_LENGTH = 20

/**
 * SECTION 14 (CLUBHOUSE): "Claim This Club" -- reachable for ANY signed-in Ovalball user, never gated
 * on club.partners.manage or any other authority, because submit_club_claim itself checks only
 * `session_ok()`. Claiming is how someone GETS authority, not something that requires it already; that
 * is the real difference from Invite (which needs an existing club admin's authority to send) and
 * Message (which needs existing club-fixture authority).
 *
 * A REAL DECISION, NEVER A TAP. Both fields are required and the declaration must be a genuine written
 * statement (a minimum length, not just a non-empty string) -- the standing "do not make claiming a
 * casual one-tap action" instruction, since a wrong grant here is authority over a real club, including
 * over children's data. The claimed role is one of the database's own eligible-role allow-list
 * (`club_claims_claimed_role_eligible`) and is a SUGGESTION only -- `decide_club_claim` lets the
 * reviewer choose different roles entirely; the title itself grants nothing.
 */
export function ClaimClubDialog({
  open,
  onOpenChange,
  clubDirectoryId,
  clubName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clubDirectoryId: string
  clubName: string
}) {
  const [role, setRole] = useState<ClaimableRole | "">("")
  const [declaration, setDeclaration] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function reset() {
    setRole("")
    setDeclaration("")
    setError(null)
    setSubmitted(false)
  }

  async function handleSubmit() {
    if (!role) {
      setError("Choose the role you hold at this club.")
      return
    }
    if (declaration.trim().length < MIN_DECLARATION_LENGTH) {
      setError(`Say more about why you're able to act for ${clubName} (at least ${MIN_DECLARATION_LENGTH} characters).`)
      return
    }
    setSending(true)
    setError(null)
    const result = await submitClubClaim(clubDirectoryId, role, declaration)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSubmitted(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim {clubName}</DialogTitle>
          <DialogDescription>
            {submitted
              ? "A Site Admin reviews every claim by hand before any account or role is created."
              : "Tell Ovalball who you are at this club. A Site Admin reviews every claim by hand -- this is not an automatic sign-up."}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <p className="rounded-lg border border-pitch-600/30 bg-pitch-600/5 px-4 py-3 text-sm text-forest-800">
            Claim sent. Ovalball will contact you once it has been reviewed, and may ask a question first if
            anything needs clarifying.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="claim-role" className="text-ink/80">
                Your Role at This Club
              </Label>
              <select
                id="claim-role"
                value={role}
                onChange={(e) => setRole(e.target.value as ClaimableRole)}
                className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                <option value="">Choose a role…</option>
                {CLAIMABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="claim-declaration" className="text-ink/80">
                Why You Can Act for {clubName}
              </Label>
              <textarea
                id="claim-declaration"
                value={declaration}
                onChange={(e) => setDeclaration(e.target.value)}
                rows={4}
                placeholder="For example: I was elected Club Secretary at the AGM in [month/year] and I'm the point of contact for fixtures and membership."
                className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
              />
            </div>
            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>{submitted ? "Close" : "Cancel"}</DialogClose>
          {!submitted && (
            <Button type="button" className="h-10" disabled={sending} onClick={handleSubmit}>
              {sending ? "Sending…" : "Submit Claim"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
