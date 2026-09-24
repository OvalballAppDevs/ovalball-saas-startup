import AsyncStorage from "@react-native-async-storage/async-storage"

/** The remembered child. A view preference, never authority: the projection normalises it on every render. */
export const SELECTED_CHILD_KEY = "ovalball.selected-child"

/** Cleared on sign-out, so the next person on this handset does not open on somebody else's child. */
export async function forgetSelectedChild(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SELECTED_CHILD_KEY)
  } catch {
    // Nothing stored is the outcome wanted.
  }
}
