"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createUser } from "./actions"

const MIN_REASON = 10

/**
 * Deliberately plain. Creating an identity is a rare, consequential act, and
 * the interesting decisions are all on the server: the capability, the
 * duplicate refusal, and the fact that nothing about a password or a setup
 * link ever comes back to this screen.
 *
 * The one thing the form insists on is the reason. It is what the audit line
 * says to whoever reads it later, and "created" is not an explanation.
 */
export function CreateUserForm() {
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingUserId, setExistingUserId] = useState<string | null>(null)
  const [createdUserId, setCreatedUserId] = useState<string | null>(null)

  const ready = email.includes("@") && firstName.trim() && surname.trim() && reason.trim().length >= MIN_REASON

  async function submit() {
    if (!ready) return
    setWorking(true)
    setError(null)
    setExistingUserId(null)
    const result = await createUser({ email, firstName, surname, dateOfBirth: dateOfBirth || null, reason })
    setWorking(false)
    if (result.ok) {
      setCreatedUserId(result.userId)
    } else {
      setError(result.error)
      setExistingUserId(result.existingUserId ?? null)
    }
  }

  if (createdUserId) {
    return (
      <div className="mt-8 rounded-lg border border-pitch-600/25 bg-pitch-50/40 p-5">
        <p className="text-sm font-medium text-ink">Account created</p>
        <p className="mt-1 text-sm text-ink-muted">
          {firstName} {surname} has been emailed a setup link. They choose their own password and set up an
          authenticator before the account becomes active; until then it shows as Setup Incomplete.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            className="h-9"
            nativeButton={false}
            render={<a href={`/admin/users/${createdUserId}`} />}
          >
            Open Their Record
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9"
            onClick={() => {
              setCreatedUserId(null)
              setEmail("")
              setFirstName("")
              setSurname("")
              setDateOfBirth("")
              setReason("")
            }}
          >
            Create Another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cu-email">Email Address</Label>
        <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <p className="text-xs text-ink-muted">The setup link goes here. It is how they prove the address is theirs.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cu-first">First Name</Label>
          <Input id="cu-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cu-surname">Surname</Label>
          <Input id="cu-surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cu-dob">Date of Birth</Label>
        <Input id="cu-dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        <p className="text-xs text-ink-muted">
          Optional here, but needed before they can hold any role — Ovalball does not guess somebody&apos;s age.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-ink">
        <span className="font-medium">Reason</span>
        <span className="text-xs font-normal text-ink-muted">
          Why this account is being made for them rather than by them. Read later by somebody who was not here.
        </span>
        <textarea
          className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          value={reason}
          maxLength={500}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          placeholder="Their club asked us to set them up; they cannot receive the self-signup email at work."
        />
      </label>

      {error && (
        <div className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2">
          <p className="text-sm text-destructive-text">{error}</p>
          {existingUserId && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-9"
              nativeButton={false}
              render={<a href={`/admin/users/${existingUserId}`} />}
            >
              Open Existing User
            </Button>
          )}
        </div>
      )}

      <div>
        <Button type="button" className="h-10" disabled={!ready || working} onClick={submit}>
          {working ? "Creating…" : "Create User"}
        </Button>
      </div>
    </div>
  )
}
