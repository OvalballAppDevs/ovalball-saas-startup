import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"

import { useSession } from "../auth/session"
import {
  dismissAnyOpenAuthSession,
  enabledSocialProviders,
  nativeAppleAuthAvailable,
  signInWithAppleNative,
  signInWithProvider,
  type SocialProvider,
} from "../auth/oauth"
import { AppleMark, FacebookMark, GoogleMark } from "./provider-marks"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../design/tokens"

/**
 * THE PROVIDER BUTTONS, AS A SET -- the native equivalent of the website's `SocialAuthButtons`.
 *
 * Renders nothing when no provider is enabled, exactly like the web component, so a screen that
 * includes this unconditionally never has to ask first. Ovalball's own surface stays neutral (white
 * card, ink text) so the provider marks are the only colour in the group, matching the website's own
 * restraint and each provider's brand guidance (never recoloured to Ovalball's palette).
 *
 * ONE ATTEMPT AT A TIME. Tapping a provider disables every other provider button and this component's
 * own retry until the attempt resolves, so a second tap cannot start a second flow underneath the first.
 */
export function SocialAuthButtons({ onError }: { onError?: (message: string) => void }) {
  const { refreshAssurance } = useSession()
  const [pending, setPending] = useState<SocialProvider | null>(null)
  const providers = enabledSocialProviders()

  if (providers.length === 0) return null

  async function start(provider: SocialProvider) {
    if (pending) return
    setPending(provider)
    onError?.("")
    const outcome =
      provider === "apple" && (await nativeAppleAuthAvailable())
        ? await signInWithAppleNative()
        : await signInWithProvider(provider)
    if (outcome.kind === "success") {
      await refreshAssurance()
      // Left pending through the reclassify: the Gate navigates away the instant `status` changes, so
      // there is no frame where the button shows itself as idle again before the screen changes under it.
      return
    }
    setPending(null)
    if (outcome.kind === "error") onError?.(outcome.problem.message)
    // `cancelled`: back to the entrance exactly as it was, no message -- the person already knows they
    // just backed out of a sign-in screen.
  }

  return (
    <View style={{ gap: space.sm }}>
      {providers.map((provider) => {
        const isPending = pending === provider.id
        const Mark = provider.id === "google" ? GoogleMark : provider.id === "apple" ? AppleMark : FacebookMark
        return (
          <Pressable
            key={provider.id}
            accessibilityRole="button"
            accessibilityLabel={provider.label}
            accessibilityState={{ disabled: pending !== null, busy: isPending }}
            disabled={pending !== null}
            onPress={() => void start(provider.id)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 4,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              backgroundColor: colour.surface,
              opacity: pending !== null && !isPending ? 0.5 : pressed ? 0.85 : 1,
              ...elevation.card,
            })}
          >
            <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
              {isPending ? <ActivityIndicator size="small" color={colour.inkMuted} /> : <Mark size={18} />}
            </View>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{isPending ? "Redirecting…" : provider.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The "or" rule between provider buttons and the email form, the same wording and treatment as web. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <View accessibilityElementsHidden style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginVertical: space.xs }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colour.line }} />
      <Text style={[type.caption, { color: colour.inkSubtle, textTransform: "uppercase", letterSpacing: 1 }]}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colour.line }} />
    </View>
  )
}

/** Call from a screen's own unmount/background handling if it navigates away mid-attempt; a no-op
 * otherwise. Exported so `sign-in.tsx` and `get-started.tsx` do not each need their own import of
 * `expo-web-browser` just to clean up a session neither of them opened directly. */
export { dismissAnyOpenAuthSession }
