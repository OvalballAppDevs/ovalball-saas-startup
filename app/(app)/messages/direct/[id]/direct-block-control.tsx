"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { blockUser, unblockUser } from "../../[kind]/[id]/participants"

/**
 * BLOCKING, FROM THE ONE PLACE IT IS ACTUALLY NEEDED.
 *
 * Blocking already existed, but only from a conversation's people list --
 * and a direct conversation has no people list, so the single surface where
 * somebody is most likely to want to decline contact was the one surface
 * that could not do it. The Blocked People screen even told them to go and
 * find a shared conversation instead.
 *
 * WHAT IT SAYS IS THE VIEWER'S OWN DECISION, NEVER THE OTHER PERSON'S.
 * "Unblock" appears only because THIS viewer holds the block; a person who
 * has been blocked sees an ordinary unavailable composer with the same
 * neutral sentence used for every other reason, so the control never becomes
 * a way of finding out that somebody blocked you.
 */
export function DirectBlockControl({
  otherUserId,
  otherName,
  blockedByMe,
}: {
  otherUserId: string
  otherName: string
  blockedByMe: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  /**
   * FOCUS BELONGS TO THE DIALOG WHILE IT IS OPEN, AND COMES BACK AFTERWARDS.
   *
   * Opening a dialog and leaving focus on the button behind it means a
   * keyboard or screen-reader user is told nothing happened and can Tab
   * straight out into a page they cannot see. Moving focus in, keeping Tab
   * inside, honouring Escape, and returning focus to the control that
   * opened it are the four halves of the same promise.
   */
  useEffect(() => {
    if (!confirming) return
    const opener = triggerRef.current
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>("button")?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setConfirming(false)
        return
      }
      if (event.key !== "Tab" || !dialog) return

      const focusable = dialog.querySelectorAll<HTMLElement>("button:not([disabled])")
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      opener?.focus()
    }
  }, [confirming])

  function act() {
    setError(null)
    startTransition(async () => {
      const result = blockedByMe ? await unblockUser(otherUserId) : await blockUser(otherUserId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (blockedByMe ? act() : setConfirming(true))}
        disabled={pending}
        className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-chalk/85 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
      >
        {blockedByMe ? "Unblock" : "Block"}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/40 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Block ${otherName}`}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-[0_24px_60px_-20px_rgba(7,28,20,0.5)]"
          >
            <p className="font-display text-[1.0625rem] text-ink">Block {otherName}?</p>
            {/* Says what actually happens, including the part people get
                wrong: blocking is not leaving the club. */}
            <p className="mt-2 text-sm text-ink-muted">
              They won&rsquo;t be able to message you privately, and you won&rsquo;t be able to message them. This
              conversation stays readable. You&rsquo;ll still see each other in team conversations, and
              announcements from a team or club still reach you both. They aren&rsquo;t told.
            </p>

            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={act}
                disabled={pending}
                className="min-h-11 rounded-lg bg-forest-900 px-3 text-sm font-medium text-chalk outline-none hover:bg-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                {pending ? "Blocking…" : "Block"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
