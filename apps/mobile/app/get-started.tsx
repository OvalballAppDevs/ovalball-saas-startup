import { Linking, Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import { ENTRY_PATHS, type EntryPath } from "@ovalball/contracts/onboarding"

import { webUrl } from "../src/config/environment"
import { holdJoinSecret } from "../src/onboarding/join-secret"
import { EntranceLink, EntranceScreen } from "../src/components/entrance"
import { ArrowRight, ExternalLink, KeyRound, Mail, Search, UserRound } from "../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../src/design/tokens"

/**
 * GET STARTED -- a decision, not a form.
 *
 * There is no open registration that ends in access and no role to pick. Somebody arrives holding an
 * invitation, a team's code, a club they want to bring in, or an account they already have. Each of
 * those has one canonical surface: the first two are the app's own invitation screen, the third is
 * the website's signup and claim journey (Turnstile, the Club Directory search, the claim review), the
 * fourth is the app's sign-in. This screen names them and sends each where it belongs. It grants
 * nothing and stores nothing.
 */
export default function GetStarted() {
  const router = useRouter()

  function choose(path: EntryPath) {
    switch (path.key) {
      case "INVITATION":
        // No secret yet: the invitation screen opens on its own code entry, and a pasted link is
        // handled by the deep-link router as it would be from an email.
        holdJoinSecret({ token: null, code: null })
        router.push("/join")
        return
      case "CODE":
        holdJoinSecret({ token: null, code: null })
        router.push({ pathname: "/join", params: { mode: "code" } } as never)
        return
      case "CLUB":
        if (webUrl) void Linking.openURL(`${webUrl}${path.webPath}`)
        return
      case "SIGN_IN":
        router.push("/sign-in")
        return
    }
  }

  return (
    <EntranceScreen
      title="How are you joining?"
      subtitle="Ovalball is invitation-led. Pick the one that describes you."
      footer={<EntranceLink label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))} />}
    >
      <View style={{ gap: space.sm }}>
        {ENTRY_PATHS.map((path) => (
          <Pressable
            key={path.key}
            accessibilityRole="button"
            accessibilityLabel={path.title}
            accessibilityHint={path.surface === "WEB" ? "Opens the Ovalball website" : path.body}
            onPress={() => choose(path)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 20,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.md,
              borderRadius: radius.lg,
              backgroundColor: pressed ? colour.mint100 : colour.surface,
              borderWidth: 1,
              borderColor: pressed ? colour.pitch600 : colour.line,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
              {ICONS[path.key]}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.bodyMedium, { color: colour.ink }]}>{path.title}</Text>
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{path.body}</Text>
            </View>
            {path.surface === "WEB" ? <ExternalLink size={16} color={colour.inkSubtle} /> : <ArrowRight size={18} color={colour.inkSubtle} />}
          </Pressable>
        ))}
      </View>
      <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.lg }]}>
        Nobody chooses their own role. Access always comes from a club, a team or Ovalball.
      </Text>
    </EntranceScreen>
  )
}

const ICONS: Record<EntryPath["key"], React.ReactNode> = {
  INVITATION: <Mail size={19} color={colour.forest800} />,
  CODE: <KeyRound size={19} color={colour.forest800} />,
  CLUB: <Search size={19} color={colour.forest800} />,
  SIGN_IN: <UserRound size={19} color={colour.forest800} />,
}
