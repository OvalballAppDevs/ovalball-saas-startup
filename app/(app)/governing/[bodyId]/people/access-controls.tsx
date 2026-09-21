"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserPlus } from "lucide-react"

import { grantBodyAccess, revokeBodyAccess } from "@/app/(app)/governing/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BODY_ROLE_ALLOWS, BODY_ROLE_LABEL, BODY_ROLES, type BodyPerson, type BodyRole } from "@/lib/governing/body"

/**
 * CONVERGENCE STEP 15 — giving somebody access.
 *
 * BY EMAIL, AND DELIBERATELY NOT BY SEARCH. There is no people picker here and there must not be: a
 * governing-body administrator has no business receiving a searchable directory of everybody on
 * Ovalball. The address is resolved inside the RPC, so this form never receives a user id it did not
 * already have, and you cannot go fishing for one.
 *
 * THE ROLE IS CHOSEN WITH ITS CONSEQUENCE ON SCREEN. Naming a role without saying what it allows is how
 * somebody is handed administration when they were meant to be given a look at the fixtures.
 */
export function GrantAccess({ bodyId }: { bodyId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<BodyRole>("BODY_VIEWER")
  const [error, setError] = useState<string | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    setNoAccount(false)
    start(async () => {
      const res = await grantBodyAccess(bodyId, email.trim(), role, null)
      if ("noAccount" in res) {
        setNoAccount(true)
        return
      }
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEmail("")
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Give Access
      </Button>
    )
  }

  return (
    <form
      className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-line bg-surface-muted p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gb-grant-email">Email Address</Label>
        <Input
          id="gb-grant-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their Ovalball account address"
          autoFocus
          required
          aria-describedby="gb-grant-help"
        />
        <p id="gb-grant-help" className="text-xs text-ink-muted">
          The address on their existing Ovalball account.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">Role</legend>
        {BODY_ROLES.map((r) => (
          <label key={r} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface">
            <input
              type="radio"
              name="gb-grant-role"
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              /* The accessible name is the ROLE. Letting the wrapping label supply it folded the whole
                 description into the name, so the control announced as a paragraph -- and the
                 consequence belongs in the description, which is what aria-describedby is for. */
              aria-label={BODY_ROLE_LABEL[r]}
              aria-describedby={`gb-role-${r}`}
              className="mt-1 size-4 accent-forest-800"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{BODY_ROLE_LABEL[r]}</span>
              <span id={`gb-role-${r}`} className="block text-xs text-ink-muted">
                {BODY_ROLE_ALLOWS[r]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {noAccount && (
        <p className="text-sm text-amber-800" role="status">
          No Ovalball account uses that address. Inviting somebody who is not on Ovalball yet is not built for
          organisations yet — for now, they need an account first.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || email.trim().length === 0}>
          {pending ? "Giving access…" : "Give Access"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setError(null)
            setNoAccount(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Taking access away.
 *
 * TWO STEPS, NO BROWSER DIALOG. A `confirm()` blocks the page and reads as a warning about the product
 * rather than about the decision; an inline second press says what will happen in the product's own
 * words and can be abandoned without answering anything.
 */
export function RevokeAccess({ bodyId, person }: { bodyId: string; person: BodyPerson }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const who = person.fullName ?? person.email ?? "this person"

  if (!confirming) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <p className="text-xs text-ink-muted">Remove {who}&apos;s access?</p>
      <div className="flex gap-1.5">
        <Button
          size="xs"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await revokeBodyAccess(bodyId, person.userId, null)
              if (!res.ok) {
                setError(res.error)
                return
              }
              setConfirming(false)
              router.refresh()
            })
          }
        >
          {pending ? "Removing…" : "Yes, Remove"}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
