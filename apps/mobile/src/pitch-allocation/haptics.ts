import { Platform } from "react-native"
import * as Haptics from "expo-haptics"

/**
 * RESTRAINED HAPTICS for the board (CA-M11.2): a press that lifts a card, a snap into a new pitch or
 * slot, a refused target, a staged drop. Nothing buzzes continuously; nothing fires on the web, which
 * has no haptic engine and would throw.
 */
const native = Platform.OS === "ios" || Platform.OS === "android"
const quiet = async (run: () => Promise<void>) => {
  if (!native) return
  try {
    await run()
  } catch {
    // A device without an engine, or a simulator: silence is the right answer.
  }
}

export const haptic = {
  lift: () => quiet(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  snap: () => quiet(() => Haptics.selectionAsync()),
  refuse: () => quiet(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  staged: () => quiet(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
}
