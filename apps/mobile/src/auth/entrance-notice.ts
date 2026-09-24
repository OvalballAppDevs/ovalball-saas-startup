/**
 * A SENTENCE FOR THE NEXT ENTRANCE SCREEN, held in memory.
 *
 * A recovery link that has lapsed, a session that was ended elsewhere, a context that was removed --
 * each produces one sentence the person should read on the screen they land on next, and that screen
 * is not the one that discovered the problem. This is the hand-off: set once, taken once, never stored.
 */
let notice: string | null = null

export function setEntranceNotice(message: string | null): void {
  notice = message
}

export function takeEntranceNotice(): string | null {
  const current = notice
  notice = null
  return current
}
