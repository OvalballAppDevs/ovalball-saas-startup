import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * RECENT SEARCHES -- a convenience, on this handset only.
 *
 * The last few things somebody typed into Rugby Hub search, so the second time
 * they look up "knock-on" it is one tap. Stored locally and only locally: it is
 * not synced, not sent anywhere, holds nothing but the words typed, and is
 * cleared with the session so the next person on a shared phone does not
 * inherit it.
 */
const KEY = "ovalball.rugby-hub.recent-searches"
const LIMIT = 6

export async function readRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, LIMIT) : []
  } catch {
    return []
  }
}

export async function rememberSearch(query: string): Promise<string[]> {
  const q = query.trim()
  if (q.length < 2) return readRecentSearches()
  const existing = await readRecentSearches()
  const next = [q, ...existing.filter((e) => e.toLowerCase() !== q.toLowerCase())].slice(0, LIMIT)
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // A full or unavailable store loses a convenience, nothing more.
  }
  return next
}

export async function forgetRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
