"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, UserPlus } from "lucide-react"

import { inviteBodyOfficer, resendBodyInvitation, revokeBodyAccess, revokeBodyInvitation } from "@/app/(app)/governing/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BODY_ROLE_ALLOWS, BODY_ROLE_LABEL, BODY_ROLES, type BodyInvitation, type BodyPerson, type BodyRole } from "@/lib/governing/body"

/**
 * CONVERGENCE STEP 16 — INVITING SOMEBODY, RATHER THAN SEARCHING FOR THEM.
 *
 * There is no people picker here and there must not be: a governing-body administrator has no business
 * receiving a searchable directory of everybody on Ovalball.
 *
 * AND THE FORM NO LONGER CARES WHETHER THEY HAVE AN ACCOUNT. Step 15 granted a role to an existing
 * account and said "no Ovalball account uses that address" otherwise — which answered a question the
 * administrator was not entitled to ask. One invitation now covers both, so the product never
 * distinguishes, and the confirmation says the same thing either way.
 *
 * THE ROLE IS CHOSEN WITH ITS CONSEQUENCE ON SCREEN, and offered least-authority-first, so
 * Administrator is never the accidental pick.
 */
export function InviteOfficer({ bodyId }: { bodyId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<BodyRole>("BODY_VIEWER")
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ email: string; joinUrl: string | null; alreadyExisted: boolean } | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = await inviteBodyOfficer(bodyId, email.trim(), role)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSent({ email: email.trim(), joinUrl: res.joinUrl, alreadyExisted: res.alreadyExisted })
      setEmail("")
      setOpen(false)
      router.refresh()
    })
  }

  if (sent) {
    return (
      <div className="w-full max-w-md rounded-xl border border-line bg-surface-muted p-3">
        <p className="text-sm font-medium text-ink">
          {sent.alreadyExisted ? "That invitation was already waiting" : "Invitation created"}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {sent.alreadyExisted
            ? `${sent.email} already has an open invitation to this organisation. Use Send Again below to issue a fresh link.`
            : `${sent.email} can accept it and act for this organisation. Only that address can use the link.`}
        </p>
        {sent.joinUrl && <CopyLink url={sent.joinUrl} />}
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSent(null)}>
          Done
        </Button>
      </div>
    )
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Invite Somebody
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
        <Label htmlFor="gb-invite-email">Email Address</Label>
        <Input
          id="gb-invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their email address"
          autoFocus
          required
          aria-describedby="gb-invite-help"
        />
        <p id="gb-invite-help" className="text-xs text-ink-muted">
          They do not need an Ovalball account yet. Only this address can accept the invitation.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">Role</legend>
        {BODY_ROLES.map((r) => (
          <label key={r} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface">
            <input
              type="radio"
              name="gb-invite-role"
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              /* The accessible name is the ROLE; the consequence belongs in the description. */
              aria-label={BODY_ROLE_LABEL[r]}
              aria-describedby={`gb-invite-role-${r}`}
              className="mt-1 size-4 accent-forest-800"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{BODY_ROLE_LABEL[r]}</span>
              <span id={`gb-invite-role-${r}`} className="block text-xs text-ink-muted">
                {BODY_ROLE_ALLOWS[r]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || email.trim().length === 0}>
          {pending ? "Creating…" : "Send Invitation"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * The invitation link, to send however this organisation actually talks to its volunteers.
 *
 * A link rather than an email BECAUSE OVALBALL DOES NOT YET HAVE A GOVERNING-BODY EMAIL EVENT, and
 * saying "we have emailed them" when nothing was sent would be the dishonest version. The invitation
 * itself is fully canonical — expiring, revocable, resendable, single-use and bound to the address —
 * so this is a delivery gap, not a workflow gap, and it is recorded as one.
 */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-2 py-1 text-xs text-ink-muted">{url}</code>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            },
            () => setCopied(false)
          )
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy Link"}
      </Button>
    </div>
  )
}

/** An invitation that is still waiting: send a fresh link, or withdraw it. */
export function PendingInvitation({ bodyId, invitation }: { bodyId: string; invitation: BodyInvitation }) {
  const router = useRouter()
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await resendBodyInvitation(bodyId, invitation.invitationId)
              if (!res.ok) {
                setError(res.error)
                return
              }
              setLink(res.joinUrl)
              router.refresh()
            })
          }
        >
          Send Again
        </Button>
        {confirming ? (
          <>
            <Button
              size="xs"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await revokeBodyInvitation(
                    bodyId,
                    invitation.invitationId,
                    "Withdrawn by the organisation's administrator"
                  )
                  if (!res.ok) {
                    setError(res.error)
                    return
                  }
                  setConfirming(false)
                  router.refresh()
                })
              }
            >
              Yes, Withdraw
            </Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
            Withdraw
          </Button>
        )}
      </div>
      {link && <CopyLink url={link} />}
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive-text" role="alert">
          {error}
        </p>
      )}
    </div>
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
