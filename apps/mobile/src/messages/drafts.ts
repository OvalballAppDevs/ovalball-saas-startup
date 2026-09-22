import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * A HALF-TYPED MESSAGE IS NOT DISPOSABLE.
 *
 * Somebody types three sentences at a touchline, the app backgrounds while they look something up,
 * and the text is gone. That is a small thing that feels like the product losing your work, so a
 * draft survives the keyboard closing, the app backgrounding and a failed send.
 *
 * SCOPED TO THE PERSON AND THE CONVERSATION, and cleared on sign-out with everything else: a phone
 * gets handed around a clubhouse, and the next person to sign in must not find somebody's unsent
 * message waiting in a box.
 *
 * NOT SECURE STORAGE, AND NOTHING ELSE GOES HERE. A draft is text this person is about to send
 * themselves, not received message history -- caching a conversation on disk would put other
 * people's words in ordinary storage, which is a different and much worse decision. Only the one
 * unsent line is kept.
 */

const PREFIX = "ovalball.draft"

function key(userId: string, conversationKey: string): string {
  return `${PREFIX}:${userId}:${conversationKey}`
}

export async function readDraft(userId: string, conversationKey: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(key(userId, conversationKey))) ?? ""
  } catch {
    // A draft is a convenience. Storage being unavailable must never stop somebody writing.
    return ""
  }
}

export async function writeDraft(userId: string, conversationKey: string, value: string): Promise<void> {
  try {
    if (value.trim().length === 0) await AsyncStorage.removeItem(key(userId, conversationKey))
    else await AsyncStorage.setItem(key(userId, conversationKey), value)
  } catch {
    // Ignored on purpose, for the same reason.
  }
}

export async function clearDraft(userId: string, conversationKey: string): Promise<void> {
  await writeDraft(userId, conversationKey, "")
}

/** Every draft this device holds. Called on sign-out, so nothing of one person's is left for the next. */
export async function clearAllDrafts(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const drafts = keys.filter((k) => k.startsWith(`${PREFIX}:`))
    if (drafts.length > 0) await AsyncStorage.multiRemove(drafts)
  } catch {
    // Ignored: the session itself is already gone, which is what actually protects the account.
  }
}
