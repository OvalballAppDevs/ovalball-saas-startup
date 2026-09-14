/**
 * A sentence that survives the step remounting after a save.
 *
 * Each Creator step is keyed by the saved workspace, so a save that refreshes
 * the page mounts a fresh step -- and would drop its "4 draft matches
 * generated" notice at the moment the person needs to read it. The notice is
 * left here for the next mount of the same step to pick up, once.
 */
const pending = new Map<string, string>()

export function leaveNotice(key: string, message: string) {
  pending.set(key, message)
}

export function takeNotice(key: string): string | null {
  const message = pending.get(key) ?? null
  pending.delete(key)
  return message
}

/**
 * A choice on a step (such as which matches the Issue list shows) that should
 * still be chosen after that step remounts from a save. In memory only: a new
 * visit to the page starts from the default.
 */
const kept = new Map<string, string>()

export function keepChoice(key: string, value: string) {
  kept.set(key, value)
}

export function keptChoice<T extends string>(key: string, fallback: T): T {
  return (kept.get(key) as T | undefined) ?? fallback
}
