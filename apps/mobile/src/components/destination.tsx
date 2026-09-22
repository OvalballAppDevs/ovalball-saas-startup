import { ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { webUrl } from "../config/environment"
import { AppHeader } from "./app-header"
import { ContextSheet } from "./context-sheet"
import { Button, Card } from "./ui"
import { colour, radius, space, type } from "../design/tokens"
import { useState } from "react"

/**
 * A DESTINATION THAT IS NOT BUILT YET, BUILT PROPERLY.
 *
 * The instruction is not to pretend functionality exists, and the temptation is to answer that with an
 * empty list -- which is worse, because an empty list says "you have no fixtures" rather than "this is
 * not finished". The honest version is a real screen: the same header, the same context, the brand's
 * own furniture, a clear statement of what will be here and where the job can be done today.
 *
 * IT IS NOT A DEAD END. The person arrived wanting something, so the screen names what it will hold,
 * says which milestone brings it, and offers the web where the work actually is. That is a foundation
 * these surfaces can be built INTO, rather than a placeholder that has to be torn out.
 *
 * AND IT IS NOT A WEBVIEW. Opening the website happens in the system browser, deliberately: an
 * embedded browser pretending to be the app is the thing a native product must never become.
 */
export function DestinationFoundation({
  title,
  intro,
  willHold,
  webPath,
  webLabel = "Open on the Web",
  icon,
}: {
  title: string
  intro: string
  /** The jobs this destination will actually do, named rather than gestured at. */
  willHold: string[]
  webPath?: string
  webLabel?: string
  icon?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: "center", paddingTop: space.xl, paddingBottom: space.sm, gap: space.md }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.xl,
              backgroundColor: colour.mint100,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </View>
          <Text accessibilityRole="header" style={[type.display, { color: colour.ink, textAlign: "center" }]}>
            {title}
          </Text>
          <Text style={[type.body, { color: colour.inkMuted, textAlign: "center", maxWidth: 300 }]}>{intro}</Text>
        </View>

        <Card>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>WHAT WILL BE HERE</Text>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            {willHold.map((item) => (
              <View key={item} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colour.pitch600, marginTop: 8 }} />
                <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{item}</Text>
              </View>
            ))}
          </View>
        </Card>

        {webPath !== undefined && (
          <Button label={webLabel} variant="secondary" onPress={() => void Linking.openURL(`${webUrl}${webPath}`)} />
        )}
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}
