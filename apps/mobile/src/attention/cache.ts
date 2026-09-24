import type { AttentionRead } from "@ovalball/contracts/attention"

/**
 * A MODEST, SHORT-LIVED CACHE for the attention projection and the first page of the feed (CA-M8).
 *
 * Why anything at all: Home, the Notifications screen and the Team workspace each ask the same question
 * on focus, and a context switch or a tab change should not cost three round trips for one answer.
 *
 * Why so little: an attention item is a claim that a job is still open, and a stale claim is worse
 * than a slow one. So the cache is keyed by CONTEXT, lives sixty seconds, and is thrown away on every
 * read mutation, on every answer given from a screen, on a context switch and on sign-out. Nothing
 * here is persisted -- a cache that survives sign-out is the previous person's work on the next
 * person's phone.
 */
const TTL_MS = 60_000

const attention = new Map<string, { at: number; read: AttentionRead }>()

export function rememberAttention(contextKey: string, read: AttentionRead): void {
  attention.set(contextKey, { at: Date.now(), read })
}

export function recallAttention(contextKey: string): AttentionRead | null {
  const hit = attention.get(contextKey)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    attention.delete(contextKey)
    return null
  }
  return hit.read
}

/** After anything that could change what is open: an answer, a decision, a read mutation, a switch. */
export function invalidateAttention(contextKey?: string): void {
  if (contextKey) attention.delete(contextKey)
  else attention.clear()
}

/** Sign-out. Everything, unconditionally. */
export function forgetAttentionCache(): void {
  attention.clear()
}
