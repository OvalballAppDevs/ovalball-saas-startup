import { UserCog } from "lucide-react"

import { stopActingAs } from "./impersonation-actions"

export interface ActiveImpersonation {
  sessionId: string
  targetName: string | null
  viewOnly: boolean
  expiresAt: string
}

/**
 * CONVERGENCE STEP 13 / SLICE 9 -- the banner AD's contract requires.
 *
 * Deliberately the same shape as the diagnostic strip and deliberately NOT the brand green: acting
 * as somebody must never look like ordinary use of the product. It says three things, because those
 * are the three a person needs to stop and think: WHOSE account this is, whether anything can be
 * changed, and when it ends by itself.
 *
 * The end time is real. The session stops working at that moment whether or not anybody presses the
 * button, because expiry is evaluated every time authority is read.
 */
export function ImpersonationBanner({ session }: { session: ActiveImpersonation }) {
  const ends = new Date(session.expiresAt)
  const endsLabel = Number.isNaN(ends.getTime())
    ? null
    : ends.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-900/30 bg-rose-500 px-4 py-2 text-sm font-medium text-rose-950">
      <span className="flex items-center gap-2">
        <UserCog className="size-4 shrink-0" aria-hidden="true" />
        You are acting as {session.targetName ?? "another person"}
        {" · "}
        {session.viewOnly ? "you can look, not change" : "you can make changes as them"}
        {endsLabel ? ` · ends at ${endsLabel}` : ""}
        {" · "}both of you are named in the audit
      </span>
      <form action={stopActingAs}>
        <button
          type="submit"
          className="rounded-md border border-rose-950/25 bg-rose-950/10 px-3 py-1 text-sm font-medium text-rose-950 outline-none transition-colors hover:bg-rose-950/20 focus-visible:ring-2 focus-visible:ring-rose-950/50"
        >
          Stop Acting as Them
        </button>
      </form>
    </div>
  )
}
