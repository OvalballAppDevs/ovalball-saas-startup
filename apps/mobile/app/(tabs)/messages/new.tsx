import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useNewMessage, type ContactEntry } from "../../../src/messages/new-message"
import { routeForRow } from "../../../src/messages/inbox"
import { OvalballDetailHeader } from "../../../src/components/app-header"
import { ContactRow, ContactSection } from "../../../src/components/messenger/contact-row"
import { Search, Users, X } from "../../../src/components/icons"
import { Skeleton } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../../../src/design/tokens"

/**
 * NEW MESSAGE.
 *
 * Who you can write to, as a messenger lists people -- not a member directory. Every row comes from the canonical
 * recipient authority through `useNewMessage` (shared with the compact messenger's New Message); search narrows that
 * set and never looks anybody else up; an absence is never explained, because the reasons (a block, a child, the
 * other side of a fixture for a parent) are exactly what must not be disclosed.
 */
export default function NewMessage() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const model = useNewMessage()

  async function choose(entry: ContactEntry) {
    const target = await model.open(entry)
    if (!target) return
    if (target.row) {
      const route = routeForRow(target.row)
      if (route) router.replace({ pathname: route.pathname as never, params: route.params as never })
      return
    }
    router.replace({ pathname: "/messages/[kind]/[id]", params: { kind: "direct", id: target.id } })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="New Message" onBack={() => router.back()} />

      {/* THE SEARCH SITS ON THE FOREST, one continuous top surface with the header above it. */}
      <View style={{ backgroundColor: surface.forest, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: surface.forestRaised, borderWidth: 1, borderColor: onForest.line }}>
          <Search size={18} color={onForest.secondary} strokeWidth={2} />
          <TextInput
            accessibilityLabel="Search people, teams or groups you can message"
            value={model.search}
            onChangeText={model.setSearch}
            placeholder="Search people, teams or groups"
            placeholderTextColor={onForest.secondary}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1.6}
            selectionColor={colour.pitch400}
            style={[type.body, { flex: 1, color: onForest.primary, paddingVertical: 10 }]}
          />
          {!!model.search && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => model.setSearch("")} hitSlop={10}>
              <X size={17} color={onForest.secondary} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!!model.problem && (
          <View style={{ margin: space.lg, padding: space.md, borderRadius: radius.lg, backgroundColor: colour.dangerSurface, gap: space.xs }}>
            <Text style={[type.small, { color: colour.danger }]}>{model.problem}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try Again" onPress={() => void model.reload()} hitSlop={8}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {!model.loaded && !model.problem && (
          <View style={{ padding: space.lg, gap: space.lg }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Skeleton height={46} width={46} style={{ borderRadius: 23 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton height={14} width="45%" />
                  <Skeleton height={12} width="70%" />
                </View>
              </View>
            ))}
          </View>
        )}

        {model.nothingAtAll && (
          <EmptyNote title="Nobody to message yet" body="People appear here once you share a club or a team with them." />
        )}
        {model.loaded && model.searching && model.sections.length === 0 && (
          <EmptyNote title="No matching conversations or contacts" body="Try another name, team or group." search />
        )}

        {model.sections.map((section) => (
          <ContactSection key={section.title ?? "results"} title={section.title}>
            {section.entries.map((entry, index) => (
              <ContactRow
                key={entry.key}
                name={entry.name}
                context={entry.context}
                avatarUrl={entry.avatarUrl}
                presence={entry.presence}
                group={entry.kind === "group"}
                first={index === 0}
                busy={model.opening === entry.userId}
                dimmed={Boolean(model.opening) && model.opening !== entry.userId}
                onPress={() => void choose(entry)}
              />
            ))}
          </ContactSection>
        ))}
      </ScrollView>
    </View>
  )
}

function EmptyNote({ title, body, search = false }: { title: string; body: string; search?: boolean }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
        {search ? <Search size={24} color={colour.forest800} strokeWidth={1.9} /> : <Users size={24} color={colour.forest800} strokeWidth={1.9} />}
      </View>
      <Text style={[type.heading, { color: colour.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", maxWidth: 300 }]}>{body}</Text>
    </View>
  )
}
