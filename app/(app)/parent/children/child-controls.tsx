"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ImageUp, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { addAnotherGuardian, cancelChildLinkRequest, removeChildAvatar, setChildAvatar } from "./actions"

/**
 * Per-child controls: a picture, and inviting another parent or guardian.
 *
 * Both are deliberately small and local to the child they act on. The
 * picture is optional everywhere it appears -- a child with none renders
 * initials, and nothing in the product asks twice.
 */
export function ChildAvatarControl({ playerId, hasAvatar }: { playerId: string; hasAvatar: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    const result = await setChildAvatar(playerId, file)
    setBusy(false)
    if (!result.ok) setError(result.error)
    else router.refresh()
  }

  async function clear() {
    setBusy(true)
    setError(null)
    const result = await removeChildAvatar(playerId)
    setBusy(false)
    if (!result.ok) setError(result.error)
    else router.refresh()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ""
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 disabled:opacity-60"
        >
          <ImageUp className="size-3.5" aria-hidden="true" />
          {busy ? "Saving…" : hasAvatar ? "Change picture" : "Add a picture"}
        </button>
        {hasAvatar && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-60"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive-text">{error}</p>}
    </div>
  )
}

export function AddGuardianControl({ playerId, childFirstName }: { playerId: string; childFirstName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [state, setState] = useState<{ kind: "idle" | "sent" | "linked" } | { kind: "error"; message: string }>({ kind: "idle" })
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    const result = await addAnotherGuardian(playerId, email.trim())
    setBusy(false)
    if (!result.ok) {
      setState({ kind: "error", message: result.error })
      return
    }
    setState({ kind: result.status === "ALREADY_LINKED" ? "linked" : "sent" })
    setEmail("")
    router.refresh()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
      >
        <UserPlus className="size-3.5" aria-hidden="true" />
        Add another guardian
      </button>
    )
  }

  return (
    <div className="w-full rounded-md border border-ink/10 bg-chalk px-3 py-3">
      {state.kind === "sent" ? (
        <p className="text-sm text-ink">
          Request sent. {childFirstName}&rsquo;s other guardian will get access once the request is approved — until then nothing changes.
        </p>
      ) : state.kind === "linked" ? (
        <p className="text-sm text-ink">That person is already a guardian for {childFirstName}.</p>
      ) : (
        <>
          <Label htmlFor={`guardian-email-${playerId}`}>Their Email Address</Label>
          <p className="mt-1 text-xs text-ink-muted">
            They&rsquo;ll be asked to confirm, and a guardian or your club will approve the relationship before they can see anything.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`guardian-email-${playerId}`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="max-w-xs"
            />
            <Button type="button" className="h-9" disabled={busy || email.trim().length === 0} onClick={() => void submit()}>
              {busy ? "Sending…" : "Send request"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {state.kind === "error" && <p className="mt-2 text-sm text-destructive-text">{state.message}</p>}
        </>
      )}
    </div>
  )
}

export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await cancelChildLinkRequest(requestId)
          router.refresh()
        })
      }
      className="inline-flex min-h-11 items-center text-sm font-medium text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-60"
    >
      {pending ? "Withdrawing…" : "Withdraw"}
    </button>
  )
}
