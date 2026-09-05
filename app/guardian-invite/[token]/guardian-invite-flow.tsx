"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toPublicGuardianInvitationError, toPublicPlayerCreationError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/client"

interface GuardianInviteFlowProps {
  token: string
  invitationId: string
  teamLabel: string
  /** True when THIS signed-in user already accepted this exact invitation (a return visit) -- skips straight to Add Player / Confirm Replacement. */
  alreadyAccepted: boolean
  /** Set only for a Club-Admin-initiated replacement invitation -- skips the ordinary "add a new child" form entirely and links to this EXISTING player instead. */
  replacementForPlayerId: string | null
  replacementForPlayerFirstName: string | null
}

type Step = "accept" | "add-player" | "confirm-replacement"

export function GuardianInviteFlow({ token, invitationId, teamLabel, alreadyAccepted, replacementForPlayerId, replacementForPlayerFirstName }: GuardianInviteFlowProps) {
  const nextStep: Step = replacementForPlayerId ? "confirm-replacement" : "add-player"
  const [step, setStep] = useState<Step>(alreadyAccepted ? nextStep : "accept")
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  async function handleAccept() {
    setAccepting(true)
    setAcceptError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc("accept_guardian_invitation", { p_token: token })
    setAccepting(false)
    if (error) {
      setAcceptError(toPublicGuardianInvitationError(error))
      return
    }
    setStep(nextStep)
  }

  if (step === "accept") {
    return (
      <div>
        <Button type="button" className="h-11 px-6" disabled={accepting} onClick={handleAccept}>
          {accepting ? "Accepting…" : "Accept invitation"}
        </Button>
        {acceptError && <p className="mt-3 text-sm text-destructive">{acceptError}</p>}
      </div>
    )
  }

  if (step === "confirm-replacement" && replacementForPlayerId) {
    return <ConfirmReplacementStep invitationId={invitationId} playerId={replacementForPlayerId} playerFirstName={replacementForPlayerFirstName ?? "this player"} />
  }

  return <AddPlayerForm invitationId={invitationId} teamLabel={teamLabel} />
}

function ConfirmReplacementStep({ invitationId, playerId, playerFirstName }: { invitationId: string; playerId: string; playerFirstName: string }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setStatus("saving")
    setError(null)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc("link_guardian_to_existing_player", {
      p_guardian_invitation_id: invitationId,
      p_player_id: playerId,
    })
    if (rpcError) {
      setStatus("error")
      setError("We couldn't link your account right now. Please try again.")
      return
    }
    setStatus("done")
  }

  if (status === "done") {
    return (
      <div className="rounded-lg border border-forest-200 bg-forest-50 p-5">
        <div className="flex items-center gap-2 text-forest-900">
          <CheckCircle2 className="size-5" />
          <p className="text-sm font-medium">You&apos;re now {playerFirstName}&apos;s guardian.</p>
        </div>
        <Link href="/dashboard" className="mt-4 inline-block">
          <Button type="button" className="h-10">
            Go to my dashboard
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Confirm you&apos;re {playerFirstName}&apos;s guardian</p>
      <p className="mt-1 text-sm text-ink/60">The club has linked this invitation to {playerFirstName}&apos;s existing player record.</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button type="button" className="mt-4 h-10" disabled={status === "saving"} onClick={handleConfirm}>
        {status === "saving" ? "Confirming…" : `Confirm — I'm ${playerFirstName}'s guardian`}
      </Button>
    </div>
  )
}

type AddPlayerStatus = "idle" | "saving" | "created" | "under_review" | "error"

function AddPlayerForm({ invitationId, teamLabel }: { invitationId: string; teamLabel: string }) {
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [dob, setDob] = useState("")
  const [status, setStatus] = useState<AddPlayerStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  const canSubmit = firstName.trim().length > 0 && surname.trim().length > 0 && dob.length > 0

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setStatus("saving")
    setError(null)
    const supabase = createClient()
    const { data, error: rpcError } = await supabase
      .rpc("create_player_for_guardian", {
        p_guardian_invitation_id: invitationId,
        p_first_name: firstName.trim(),
        p_surname: surname.trim(),
        p_date_of_birth: dob,
      })
      .single()
    if (rpcError || !data) {
      setStatus("error")
      setError(toPublicPlayerCreationError(rpcError ?? {}))
      return
    }
    setStatus(data.result === "under_review" ? "under_review" : "created")
  }

  function addAnother() {
    setFirstName("")
    setSurname("")
    setDob("")
    setStatus("idle")
    setError(null)
  }

  if (status === "created") {
    return (
      <div className="rounded-lg border border-forest-200 bg-forest-50 p-5">
        <div className="flex items-center gap-2 text-forest-900">
          <CheckCircle2 className="size-5" />
          <p className="text-sm font-medium">
            {firstName} has been added to {teamLabel}.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" variant="outline" className="h-10" onClick={addAnother}>
            Add another child
          </Button>
          <Link href="/dashboard">
            <Button type="button" className="h-10">
              Go to my dashboard
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (status === "under_review") {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm font-medium text-ink">Thanks — we&apos;re checking this</p>
        <p className="mt-1 text-sm text-ink/60">The club needs to confirm a detail before this player is linked to your account. They&apos;ll be in touch, or you can check back on your dashboard shortly.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" variant="outline" className="h-10" onClick={addAnother}>
            Add another child
          </Button>
          <Link href="/dashboard">
            <Button type="button" className="h-10">
              Go to my dashboard
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Add your child</p>
      <p className="mt-1 text-sm text-ink/60">Just enough to link them to {teamLabel} — you can add more later.</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="player-first-name" className="text-ink/80">
            First name
          </Label>
          <Input id="player-first-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="player-surname" className="text-ink/80">
            Surname
          </Label>
          <Input id="player-surname" required value={surname} onChange={(e) => setSurname(e.target.value)} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="player-dob" className="text-ink/80">
          Date of birth
        </Label>
        <Input id="player-dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="mt-1.5 h-11 w-full border-ink/15 bg-white sm:w-56" />
        <p className="mt-1.5 text-xs text-ink/45">Used only to determine age-appropriate access and eligibility rules.</p>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="mt-4 h-10" disabled={!canSubmit || status === "saving"}>
        {status === "saving" ? "Adding…" : "Add player"}
      </Button>
    </form>
  )
}
