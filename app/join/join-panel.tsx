"use client"

import { useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { entranceLanding, type EntranceLanding } from "@/lib/invitations/entrance-landing"

import { acceptInvitation, adoptEntranceContext, recordOwnDateOfBirth, signOutAndReturnToInvitation } from "./actions"

export function JoinPanel({
  token,
  code: previewedCode,
  signedIn,
  hasInvitation,
  needsName,
}: {
  token: string | null
  /** A code already in the URL, which the page has previewed. */
  code: string | null
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

  // WHAT JUST HAPPENED, WHEN IT IS WORTH SAYING. An outcome that established access can simply take the
  // person there; an outcome that established a REQUEST must not, because a silent redirect into the
  // application reads as "you are in" -- which is the thing UX-8 §16 forbids and the old destination map
  // did. So a landing that carries a sentence stops here and shows it.
  const [arrived, setArrived] = useState<EntranceLanding | null>(null)

  /**
   * Leaves for the destination the accepted relationship implies.
   *
   * The context is adopted BEFORE navigating, and that ordering is the point: the active context comes
   * from a cookie rather than from the URL, so arriving at a newly granted workspace without setting it
   * first shows the new page wrapped in the navigation of whatever the person was in before.
   */
  const go = useCallback(
    (landing: EntranceLanding) => {
      start(async () => {
        if (landing.contextKey) await adoptEntranceContext(landing.contextKey)
        router.push(landing.href)
        router.refresh()
      })
    },
    [router],
  )

  function arrive(outcome: Parameters<typeof entranceLanding>[0], detail: Record<string, unknown>) {
    const landing = entranceLanding(outcome, detail)
    if (landing.note) {
      setArrived(landing)
      return
    }
    go(landing)
  }

  function submit(input: { token?: string | null; code?: string | null }) {
    setError(null)
    setLastInput(input)
    start(async () => {
      const result = await acceptInvitation(input)
      if (result.ok) {
        arrive(result.outcome, result.detail)
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
        arrive(result.outcome, result.detail)
        return
      }
      setError(result.message)
    })
  }

  // The confirmation stop. One sentence about what actually happened, and one button onward -- the
  // "confirmation / next destination" end of the entrance anatomy in UX-8 §6.
  if (arrived) {
    return (
      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-base text-ink">{arrived.note}</p>
        <Button type="button" className="mt-4 h-11 px-6" disabled={pending} onClick={() => go(arrived)}>
          {pending ? "Taking you there…" : "Continue"}
        </Button>
      </div>
    )
  }

  if (!signedIn) {
    // THE CODE TRAVELS TOO. This named only the token, so somebody who arrived with a human code and
    // was not signed in came back from login to an empty /join and had to find the code again.
    const next = token
      ? `/join?t=${encodeURIComponent(token)}`
      : previewedCode
        ? `/join?c=${encodeURIComponent(previewedCode)}`
        : "/join"
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

  // ANYTHING THAT PREVIEWED IS ACCEPTED WITH ONE CONTROL -- a link or a code.
  // The code used to go straight from the box to redemption, so the person
  // typing it never saw which club they were joining or what they were being
  // given, while somebody clicking a link saw both. The box now takes them to
  // the same previewed page the link produces.
  if (hasInvitation && (token || previewedCode)) {
    return (
      <div className="mt-8">
        <Button
          type="button"
          className="h-11 px-6"
          disabled={pending}
          onClick={() => submit(token ? { token } : { code: previewedCode })}
        >
          {pending ? "Accepting…" : "Accept Invitation"}
        </Button>
        {error && (
          <div className="mt-3">
            <p className="text-sm text-destructive-text">{error}</p>
            {/*
              THE WAY OUT OF THE WRONG ACCOUNT -- §26.
              The refusal is deliberately generic: it does not say whether the invitation was expired,
              withdrawn, or simply made out to somebody else, because saying so would tell a prober
              which. That leaves one case looking like a dead end when it is not -- a person signed in
              as one of their own two addresses. So the escape is offered on any refusal, phrased so it
              reveals nothing about the invitation, and it comes straight back here.
            */}
            <p className="mt-2 text-sm text-ink-muted">
              If you have more than one Ovalball account, this invitation may have been sent to the
              other one.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-10"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await signOutAndReturnToInvitation(token ? { token } : { code: previewedCode })
                })
              }
            >
              Sign In As Somebody Else
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <form
      className="mt-8 rounded-lg border border-ink/10 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault()
        // To the previewed page, not straight to redemption. The code is
        // normalised by the database, so it travels exactly as typed.
        router.push(`/join?c=${encodeURIComponent(code.trim())}`)
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
