"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { acceptInvitation, recordOwnDateOfBirth } from "./actions"

/** What the person should be looking at once the invitation has done its work. */
const DESTINATION: Record<string, string> = {
  MEMBERSHIP_ACTIVE: "/dashboard",
  PENDING_CONFIRMATION: "/dashboard",
  JOIN_REQUEST_PENDING: "/dashboard",
  SITE_ADMIN_ACTIVE: "/admin",
  ACCOUNT_SETUP_CONFIRMED: "/account",
  ACCEPTED: "/dashboard",
  ALREADY_REDEEMED: "/dashboard",
}

export function JoinPanel({
  token,
  signedIn,
  hasInvitation,
  needsName,
}: {
  token: string | null
  signedIn: boolean
  hasInvitation: boolean
  needsName: boolean
}) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // The age gate is a prompt, not a dead end. When redemption refuses because Ovalball cannot
  // establish that this person is an adult, the invitation is deliberately NOT spent -- so the right
  // thing to show is the question, and then the same invitation again.
  const [askAge, setAskAge] = useState(false)
  const [dob, setDob] = useState("")
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [lastInput, setLastInput] = useState<{ token?: string | null; code?: string | null }>({})

  function submit(input: { token?: string | null; code?: string | null }) {
    setError(null)
    setLastInput(input)
    start(async () => {
      const result = await acceptInvitation(input)
      if (result.ok) {
        router.push(DESTINATION[result.outcome] ?? "/dashboard")
        router.refresh()
        return
      }
      if (result.reason === "AGE_ELIGIBILITY_REQUIRED") {
        setAskAge(true)
        return
      }
      setError(result.message)
    })
  }

  function submitAge(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const recorded = await recordOwnDateOfBirth({ dateOfBirth: dob, firstName, surname })
      if (!recorded.ok) {
        setError(recorded.error)
        return
      }
      setAskAge(false)
      const result = await acceptInvitation(lastInput)
      if (result.ok) {
        router.push(DESTINATION[result.outcome] ?? "/dashboard")
        router.refresh()
        return
      }
      setError(result.message)
    })
  }

  if (!signedIn) {
    const next = token ? `/join?t=${encodeURIComponent(token)}` : "/join"
    return (
      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm text-ink/70">
          Sign in to accept this invitation. Ovalball checks that the invitation was sent to the address you
          sign in with, so an invitation cannot be accepted by anyone else.
        </p>
        <Button type="button" className="mt-4 h-11 px-6" onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}>
          Sign In
        </Button>
      </div>
    )
  }

  if (askAge) {
    return (
      <form className="mt-8 rounded-lg border border-ink/10 bg-white p-5" onSubmit={submitAge}>
        <p className="text-sm text-ink/70">
          This role is for adults, so Ovalball needs your date of birth before you can accept it. You give
          it once and it is not shown to your club.
        </p>
        {needsName && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="join-first-name">First Name</Label>
              <Input id="join-first-name" className="mt-2" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="join-surname">Last Name</Label>
              <Input id="join-surname" className="mt-2" value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>
          </div>
        )}
        <div className="mt-4 sm:max-w-xs">
          <Label htmlFor="join-dob">Date of Birth</Label>
          <Input id="join-dob" type="date" className="mt-2" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        <Button type="submit" className="mt-4 h-11 px-6" disabled={pending || dob.length === 0}>
          {pending ? "Saving…" : "Save & Accept"}
        </Button>
        {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
      </form>
    )
  }

  // A link that previewed is accepted with one control. Everything else asks for the code.
  if (hasInvitation && token) {
    return (
      <div className="mt-8">
        <Button type="button" className="h-11 px-6" disabled={pending} onClick={() => submit({ token })}>
          {pending ? "Accepting…" : "Accept Invitation"}
        </Button>
        {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
      </div>
    )
  }

  return (
    <form
      className="mt-8 rounded-lg border border-ink/10 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault()
        submit({ code })
      }}
    >
      <Label htmlFor="invite-code">Invite Code</Label>
      <Input
        id="invite-code"
        name="code"
        autoComplete="one-time-code"
        placeholder="XXXXX-XXXXX"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="mt-2 font-mono tracking-[0.18em] uppercase"
      />
      <p className="mt-2 text-sm text-ink/60">
        Ten characters, as they appear in your invitation. Capitals and dashes do not matter.
      </p>
      <Button type="submit" className="mt-4 h-11 px-6" disabled={pending || code.trim().length === 0}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
    </form>
  )
}
