import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * CLEARING A WITHDRAWN CARD FROM MY REQUESTS is a view preference, not a change to canonical data --
 * exactly the reasoning the selected-context store already documents for the same reason. Withdrawing a
 * request writes `status: 'cancelled'` on the real row, which stays there for ever (audit, the other
 * club's own view, history); "clear" only stops THIS viewer's list showing that card again, remembered
 * per device, never synced, never mistaken for a second copy of the request record.
 */
const KEY = "ovalball.dismissedFixtureRequestGroups"

export async function readDismissedGroupIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set()
  } catch {
    return new Set()
  }
}

export async function dismissGroup(groupId: string): Promise<Set<string>> {
  const current = await readDismissedGroupIds()
  current.add(groupId)
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify([...current]))
  } catch {
    // A view preference that fails to save is not worth surfacing an error over -- worst case the
    // card reappears next launch, which is recoverable by swiping again.
  }
  return current
}
