"use client"

import { useRouter } from "next/navigation"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createMinimalProfile } from "./actions"

/**
 * Shown only when a Site Admin invitee has no profiles row yet (a
 * genuinely new person, or an account created purely to hold this
 * invitation). Collects the minimum a personal identity needs -- first and
 * last name, the two NOT NULL columns on profiles -- then hands off to the
 * ordinary accept flow. Everything else about their profile (photo,
 * address, phone) is filled in later from /account, at their own pace, not
 * gated on accepting this invitation.
 */
export function CompleteProfileForm() {
  const router = useRouter()
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const firstId = useId()
  const surnameId = useId()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !surname.trim() || status === "submitting") return

    setStatus("submitting")
    setError(null)
    const result = await createMinimalProfile(firstName, surname)
    if (result.ok) {
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
      <div>
        <p className="text-sm font-medium text-ink">First, tell us who you are</p>
        <p className="mt-1 text-sm text-ink/60">
          A Site Admin account is still a person -- your name here is separate from any club and never shown to
          members.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={firstId} className="text-ink/80">
            First name
          </Label>
          <Input
            id={firstId}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
            autoFocus
            className="h-11 border-ink/15 bg-white px-3.5 text-base text-ink"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={surnameId} className="text-ink/80">
            Surname
          </Label>
          <Input
            id={surnameId}
            value={surname}
            onChange={(event) => setSurname(event.target.value)}
            required
            className="h-11 border-ink/15 bg-white px-3.5 text-base text-ink"
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        className="h-11 self-start px-6"
        disabled={!firstName.trim() || !surname.trim() || status === "submitting"}
      >
        {status === "submitting" ? "Saving…" : "Continue"}
      </Button>
    </form>
  )
}
