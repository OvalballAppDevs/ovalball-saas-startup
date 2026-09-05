"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { removeGuardian, sendReplacementGuardianInvite } from "./actions"

export interface PlayerGuardianData {
  playerId: string
  playerName: string
  teamId: string
  teamLabel: string
  guardians: { id: string; name: string; email: string }[]
  /** True only for a minor (or unknown-DOB youth-protected) player -- an adult with zero guardians is normal, never flagged. */
  needsGuardian: boolean
}

/**
 * Removing a Guardian is Club-Admin-only, requires a reason, and a
 * confirmation step -- never a bare delete icon. Removing the LAST active
 * guardian must show a real, un-missable warning, not complete silently --
 * the orphaned=true result from the RPC drives that, live, from the same
 * call that performed the removal.
 */
export function PlayerGuardianCard({ player, clubName }: { player: PlayerGuardianData; clubName: string }) {
  const router = useRouter()
  const [guardians, setGuardians] = useState(player.guardians)
  const [orphanWarning, setOrphanWarning] = useState(player.needsGuardian && guardians.length === 0)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove(guardianId: string, reason: string) {
    setError(null)
    const result = await removeGuardian(guardianId, reason)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setGuardians((prev) => prev.filter((g) => g.id !== guardianId))
    if (result.orphaned && player.needsGuardian) setOrphanWarning(true)
    router.refresh()
  }

  return (
    <li className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{player.playerName}</p>
        <span className="text-xs text-ink/45">{player.teamLabel}</span>
      </div>

      {orphanWarning && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-medium">Guardian required.</strong> This player has no active guardian, so their
            account has no consented access to anything. Send a replacement invitation below.
          </p>
        </div>
      )}

      {guardians.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {guardians.map((g) => (
            <GuardianRow key={g.id} guardian={g} onRemove={handleRemove} />
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <ReplacementInviteForm playerId={player.playerId} teamId={player.teamId} clubName={clubName} teamName={player.teamLabel} />
    </li>
  )
}

function GuardianRow({ guardian, onRemove }: { guardian: { id: string; name: string; email: string }; onRemove: (id: string, reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [removing, setRemoving] = useState(false)

  async function handleConfirm() {
    setRemoving(true)
    await onRemove(guardian.id, reason)
    setRemoving(false)
    setOpen(false)
    setReason("")
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-ink/5 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{guardian.name}</p>
        <p className="truncate text-xs text-ink/45">{guardian.email}</p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-destructive hover:text-destructive" />}>
          Remove
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {guardian.name} as guardian?</DialogTitle>
            <DialogDescription>
              This ends their access to this player&apos;s data and consent controls. This action is logged. If this
              was the player&apos;s only guardian, the player is flagged as needing a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <label htmlFor="remove-guardian-reason" className="text-sm font-medium text-ink/80">
              Reason
            </label>
            <textarea
              id="remove-guardian-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Requested by the family, incorrect relationship recorded"
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" className="h-10" disabled={removing || !reason.trim()} onClick={handleConfirm}>
              {removing ? "Removing…" : "Remove guardian"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function ReplacementInviteForm({ playerId, teamId, clubName, teamName }: { playerId: string; teamId: string; clubName: string; teamName: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setStatus("saving")
    setError(null)
    const result = await sendReplacementGuardianInvite(playerId, teamId, clubName, teamName, email.trim())
    if (result.ok) {
      setStatus("sent")
      setInviteLink(result.inviteLink)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "sent" && inviteLink) {
    return (
      <div className="mt-3 rounded-lg bg-forest-50 p-3.5 text-sm">
        <p className="font-medium text-ink">Replacement invitation created for {email}.</p>
        <code className="mt-1.5 block truncate rounded-md bg-white px-2.5 py-1.5 text-xs text-ink/70">{inviteLink}</code>
      </div>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="mt-3 h-8" onClick={() => setOpen(true)}>
        Send replacement guardian invitation
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-start gap-2">
      <Input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="new-guardian@example.com"
        className="h-9 min-w-0 flex-1 border-ink/15 bg-white sm:max-w-xs"
      />
      <Button type="submit" size="sm" className="h-9" disabled={!email.trim() || status === "saving"}>
        {status === "saving" ? "Sending…" : "Send invitation"}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  )
}
