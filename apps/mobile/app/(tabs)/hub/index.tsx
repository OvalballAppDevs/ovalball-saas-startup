import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { HUB_GROUPS, HUB_START_HERE } from "@ovalball/contracts/rugby-hub/ia"

import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { Search } from "../../../src/components/icons"
import { useHubIdentity } from "../../../src/hub/identity"
import { openHubHref } from "../../../src/hub/routes"
import { HubTeamSwitch } from "../../../src/hub/team"
import { HubContextStrip, HubHeading, HubLead, HubList, HubRow, Strong } from "../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * RUGBY HUB — the landing.
 *
 * THE SAME FIVE GROUPS AS THE WEBSITE, in the same order, from the same IA
 * module: Learn the Game, Play & Develop, Coach Rugby, Explore Rugby, Welfare &
 * Support. The mobile app does not have its own idea of where Glossary lives.
 * `HUB_GROUPS` is imported, not copied, so a destination added on the web
 * appears here on the next build -- and the parity map has one list to check.
 *
 * SEARCH FIRST. The website carries one Rugby Hub search in its header on every
 * page; here it is the first thing under the app header, because "what does
 * that word mean" is the question the Hub is opened for most.
 *
 * PERSONAL, NARROWLY. The strip only ever states what genuinely resolved -- a
 * real team, a real code, a real child's name -- and every destination stays
 * listed regardless. When nothing resolves, nothing is claimed.
 */
export default function HubLanding() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const { team, identity, loading } = useHubIdentity()
  const codeLabel = identity?.rugbyCode === "league" ? "Rugby League" : identity?.rugbyCode === "union" ? "Rugby Union" : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: colour.forest800, textTransform: "uppercase" }]}>Rugby Hub</Text>
          <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
            Rugby Hub
          </Text>
          <Text style={{ ...type.body, color: "rgba(16,21,18,0.8)" }}>
            Everything Ovalball knows about rugby, in one place — how the game works, how to play it, how to coach it, and where it all came from. Rules, safeguarding and player-welfare guidance
            comes directly from the governing bodies.
          </Text>
        </View>

        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search Rugby Hub"
          accessibilityHint="Opens search across every Rugby Hub article, law, position and term"
          onPress={() => router.push("/hub/search")}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET + 4,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: pressed ? colour.pitch600 : colour.lineStrong,
            backgroundColor: colour.surface,
          })}
        >
          <Search size={18} color={colour.inkMuted} />
          <Text style={[type.body, { color: colour.inkSubtle }]}>Search Rugby Hub</Text>
        </Pressable>

        {!loading && team && (
          <View style={{ gap: space.sm }}>
            <HubContextStrip>
              <Text style={[type.small, { color: colour.forest900 }]}>
                Showing what's relevant to <Strong>{team.childName ? `${team.childName}'s ${team.teamDisplayName}` : team.teamDisplayName}</Strong>
                {codeLabel ? ` (${codeLabel})` : ""} where it applies — every destination below stays open to explore.
              </Text>
            </HubContextStrip>
            <HubTeamSwitch />
          </View>
        )}

        <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: "rgba(90,203,131,0.5)", backgroundColor: "rgba(220,247,229,0.6)", padding: space.lg, gap: space.md }}>
          <View>
            <Text accessibilityRole="header" style={[type.displaySmall, { color: colour.forest900 }]}>
              New to Rugby? Start Here
            </Text>
            <Text style={[type.small, { color: "rgba(11,43,30,0.85)", marginTop: 4 }]}>Three places to begin if the sport is new to you. Read them in any order — nothing is tracked and there is nothing to complete.</Text>
          </View>
          <HubList>
            {HUB_START_HERE.map((item, i) => (
              <HubRow key={item.href} index={i + 1} title={item.label} description={item.description} onPress={() => openHubHref(router, item.href)} />
            ))}
          </HubList>
        </View>

        {HUB_GROUPS.map((group) => (
          <View key={group.key} style={{ gap: space.md }}>
            <View>
              <HubHeading>{group.label}</HubHeading>
              <HubLead>{group.blurb}</HubLead>
            </View>
            <HubList>
              {group.items.map((item) => (
                <HubRow key={item.href} title={item.label} description={item.description} onPress={() => openHubHref(router, item.href)} />
              ))}
            </HubList>
          </View>
        ))}
      </ScrollView>
      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}
