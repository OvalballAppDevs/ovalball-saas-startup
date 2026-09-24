import { useCallback, useMemo } from "react"

import type { ReasonAsk } from "./reason-sheet"

/**
 * THE INTENT A STEP-UP INTERRUPTS, HELD IN MEMORY ONLY.
 *
 * A "code first" refusal closes the sheet and sends the person to `/step-up`. What they were about to
 * confirm is kept here -- in process memory, keyed by the screen that asked, never in storage and never
 * as a queue -- so the screen can re-open the same sheet with the reason put back when it comes into
 * focus again. The screen may have been re-mounted by the navigation in between, which is why this is
 * a module store rather than component state. The server is asked again on Confirm; nothing is ever
 * performed because a code was accepted.
 */
const store = new Map<string, unknown>()

export function holdIntent<T>(key: string, intent: T): void {
  store.set(key, intent)
}

/** A cancelled step-up drops whatever was held: nothing verified, nothing to resume. */
export function discardIntents(): void {
  store.clear()
}

export function takeIntent<T>(key: string): T | null {
  const v = (store.get(key) as T | undefined) ?? null
  store.delete(key)
  return v
}

export interface PendingIntent {
  ask: ReasonAsk
  reason: string
}

/** The reason-sheet flavour: hold and take one `{ ask, reason }` for this screen. */
export function usePendingIntent(key: string): { hold: (ask: ReasonAsk, reason: string) => void; take: () => PendingIntent | null } {
  const hold = useCallback((ask: ReasonAsk, reason: string) => holdIntent<PendingIntent>(key, { ask, reason }), [key])
  const take = useCallback(() => takeIntent<PendingIntent>(key), [key])
  return useMemo(() => ({ hold, take }), [hold, take])
}

/** The sheet question to re-open after a step-up: the same ask, the reason put back, and a note. */
export function resumedAsk(intent: PendingIntent): ReasonAsk {
  return { ...intent.ask, initialReason: intent.reason, note: "Verified. Confirm to continue." }
}
