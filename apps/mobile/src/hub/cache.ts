import { useCallback, useEffect, useRef, useState } from "react"

import { friendly, logDetail, type FriendlyError } from "../errors/translate"
import { forgetHubExplanations } from "./experience/explain"

/**
 * ONE SMALL CACHE FOR THE HUB'S BUNDLES.
 *
 * A Hub domain is read as a BUNDLE -- every published glossary term, or every
 * game concept with its positions, skills and relationships -- exactly as the
 * website reads it, through the same contracts reader and the same RLS. A
 * bundle is a few hundred rows of public educational content that changes when
 * an editor publishes, not when a person taps. So it is held in memory for the
 * life of the app process, keyed by what it depends on (the domain, and for the
 * two identity-aware bundles the viewer's regulatory identity), and re-read in
 * the background once it is old. A second screen in the same domain opens
 * instantly; a detail page does not re-fetch the list it was opened from.
 *
 * NOT A CONTENT STORE. Nothing here is written to disk and nothing survives a
 * relaunch: the database stays the one copy of every article, and a cache that
 * outlives the process is how a corrected law stays wrong on somebody's phone.
 *
 * STALE WHILE REVALIDATING, NEVER STALE INSTEAD OF WRONG. A refresh keeps the
 * bundle on screen while the new one loads; a failed refresh keeps the bundle
 * and reports the failure; a failed FIRST load reports the failure and offers
 * a retry, because there is nothing honest to show instead.
 */

const FRESH_FOR_MS = 10 * 60 * 1000

interface Entry {
  value: unknown
  at: number
  inflight: Promise<unknown> | null
}

const store = new Map<string, Entry>()

/** Drop everything. Called on sign-out so the next person on a shared handset starts cold. */
export function forgetHubCache(): void {
  forgetHubExplanations()
  store.clear()
}

export interface HubData<T> {
  data: T | null
  /** True only while there is nothing to show yet. A background refresh is not "loading". */
  loading: boolean
  refreshing: boolean
  error: FriendlyError | null
  refresh: () => Promise<void>
}

/**
 * Read a bundle through the cache.
 *
 * `key` is null while the inputs it depends on are still resolving (the viewer's
 * identity, for instance); the hook then reports loading and does nothing until
 * the key is real. `load` must be stable for a given key.
 */
export function useHubData<T>(key: string | null, load: () => Promise<T>): HubData<T> {
  const cached = key ? (store.get(key) as Entry | undefined) : undefined
  const [data, setData] = useState<T | null>((cached?.value as T | undefined) ?? null)
  const [loading, setLoading] = useState(!cached)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const alive = useRef(true)

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!key) return
      const existing = store.get(key)
      if (mode === "initial") setLoading(!existing)
      else setRefreshing(true)
      setError(null)
      try {
        let promise = existing?.inflight
        if (!promise) {
          promise = loadRef.current()
          store.set(key, { value: existing?.value, at: existing?.at ?? 0, inflight: promise })
        }
        const value = (await promise) as T
        store.set(key, { value, at: Date.now(), inflight: null })
        if (alive.current) setData(value)
      } catch (cause) {
        const current = store.get(key)
        if (current) store.set(key, { ...current, inflight: null })
        const translated = friendly(cause, "the Rugby Hub")
        logDetail(`hub:${key}`, translated)
        if (alive.current) setError(translated)
      } finally {
        if (alive.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [key]
  )

  useEffect(() => {
    alive.current = true
    if (!key) {
      setLoading(true)
      return
    }
    const entry = store.get(key)
    if (entry?.value !== undefined) {
      setData(entry.value as T)
      setLoading(false)
      if (Date.now() - entry.at > FRESH_FOR_MS) void run("refresh")
    } else {
      setData(null)
      void run("initial")
    }
    return () => {
      alive.current = false
    }
  }, [key, run])

  const refresh = useCallback(() => run("refresh"), [run])

  return { data, loading, refreshing, error, refresh }
}
