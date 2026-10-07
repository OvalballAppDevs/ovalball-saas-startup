import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * HAS THIS ACCOUNT ALREADY BEEN ASKED, on this device.
 *
 * Keyed per user id rather than globally, exactly like `src/requests/dismissed-groups.ts`'s own
 * per-device view preference -- a shared family handset must ask each account once, not once ever.
 * Recorded whether the answer was "Enable" or "Not Now": a decline is a decision too, and re-showing
 * Ovalball's own pre-prompt every launch after somebody has already said no would be the nag the OS
 * permission dialog itself already refuses to be.
 */
const KEY = "ovalball.pushPrePrompt.decidedUserIds"

export async function hasDecided(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) && ids.includes(userId)
  } catch {
    return false
  }
}

export async function markDecided(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    const set = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [])
    set.add(userId)
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]))
  } catch {
    // Worst case the prompt is offered again next launch -- recoverable, and not worth surfacing.
  }
}
