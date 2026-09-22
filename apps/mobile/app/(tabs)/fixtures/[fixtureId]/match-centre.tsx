import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { webUrl } from "../../../../src/config/environment"
import { ChevronRight, ExternalLink, Users } from "../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * MATCH CENTRE — A DOOR, NOT A SECOND BUILDING.
 *
 * Match Centre is ONE shared role-aware surface. The whole point of that architecture is that a
 * redesign reaches every viewer because they all consume the same components; a native reimplementation
 * would be precisely the drift it exists to prevent, and M6 owns building it properly.
 *
 * So this is an intentional foundation route. It exists now because Fixture Detail needs somewhere
 * honest to send somebody, and because M7's deep links need the destination to be addressable before
 * they can point at it. It says what is coming, and offers the web surface -- which is finished, is
 * role-aware, and is the same fixture.
 *
 * ONE FIXTURE, ONE ROUTE. The id here is the same `fixtureId` the canonical route uses, so when the
 * native surface lands it replaces this file and every link into it still resolves.
 */
export default function MatchCentreFoundation() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { fixtureId, teamId } = useLocalSearchParams<{ fixtureId: string; teamId?: string }>()
  const id = String(fixtureId ?? "")
  // THE TEAM TRAVELS WITH THE FIXTURE. A fixture has two sides and a person may be connected to
  // either; availability belongs to ONE of them, and a Match Centre that did not know which would
  // aggregate two squads into a number that describes neither. M6 builds on this parameter rather
  // than having to add it later.
  const team = String(teamId ?? "")

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the fixture"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Match Centre
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        <View style={{ padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, gap: space.sm }}>
          <Users size={24} color={colour.forest800} strokeWidth={1.8} />
          <Text style={[type.heading, { color: colour.ink }]}>Coming in the next build</Text>
          <Text style={[type.body, { color: colour.inkMuted }]}>
            Match Centre is one shared surface — the same team sheet, availability and match day for
            everyone, filtered to what each person may see. It is being brought to the app as a whole
            rather than in pieces, so that a change to it reaches every viewer at once.
          </Text>
          <Text style={[type.body, { color: colour.inkMuted }]}>
            Availability lives here rather than on the fixture itself — alongside the team sheet and the
            match-day preparation it belongs with.
          </Text>
          <Text style={[type.body, { color: colour.inkMuted }]}>
            The full version is on the website now, and it is the same fixture.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Match Centre on the web"
          onPress={() => void Linking.openURL(`${webUrl}/fixtures/${id}`)}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            borderRadius: radius.md,
            backgroundColor: colour.forest800,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <ExternalLink size={17} color={colour.onForest} />
          <Text style={[type.smallMedium, { color: colour.onForest }]}>Open Match Centre on the Web</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
