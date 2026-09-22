import { ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { useSession } from "../../src/auth/session"
import { useAppContexts, forgetSelectedContext } from "../../src/context/contexts"
import { environment, webUrl } from "../../src/config/environment"
import { isSecure, sessionStorageDescription } from "../../src/auth/session-store"
import { PersonAvatar } from "../../src/components/identity"
import { Button, Card, SectionHeading } from "../../src/components/ui"
import { colour, space, type } from "../../src/design/tokens"

/**
 * MORE — who you are, and the way out.
 *
 * SIGNING OUT CLEARS THIS DEVICE. The Supabase session goes from the platform's secure store, and the
 * selected context goes with it: a phone gets handed around a clubhouse, and the next person to sign
 * in must not land in the previous person's team. Nothing else sensitive is written to disk, which is
 * what makes that a complete answer rather than a partial one.
 *
 * The build tells you what it is. In development, where several backends exist and all of them look
 * the same from the outside, "which Ovalball is this" is a question worth answering on screen.
 */
export default function More() {
  const insets = useSafeAreaInsets()
  const { signOut, email } = useSession()
  const { person } = useAppContexts()

  async function leave() {
    await forgetSelectedContext()
    await signOut()
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.chalk }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <PersonAvatar name={person.firstName} url={person.avatarUrl} size={56} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]} numberOfLines={1}>
              {person.firstName ?? "Your account"}
            </Text>
            <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={1}>
              {email ?? ""}
            </Text>
          </View>
        </View>
      </Card>

      <View>
        <SectionHeading>On the Web for Now</SectionHeading>
        <Card>
          <Text style={[type.body, { color: colour.inkMuted }]}>
            Messages, Subscriptions, People, club administration and Site Admin are on the Ovalball
            website. They arrive in the app over the next mobile milestones.
          </Text>
          <Button
            label="Open Ovalball on the Web"
            variant="secondary"
            style={{ marginTop: space.md }}
            onPress={() => void Linking.openURL(webUrl)}
          />
        </Card>
      </View>

      <View>
        <SectionHeading>This Build</SectionHeading>
        <Card>
          <Row label="Environment" value={environment} />
          <Row label="Session stored in" value={sessionStorageDescription} />
          <Row label="Secure storage" value={isSecure ? "Yes" : "No — this platform has none"} />
        </Card>
      </View>

      <Button label="Sign Out" variant="secondary" onPress={() => void leave()} />
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 4 }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
