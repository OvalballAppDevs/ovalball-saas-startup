import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { SwitchableContext } from "@ovalball/contracts"

import { useAppContexts } from "../context/contexts"
import { ClubCrest, PersonAvatar } from "./identity"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * ONE PERSON, EVERY HAT THEY WEAR.
 *
 * The same account may be a Club Admin, a coach of one side, a parent of two children and a county
 * officer, and Ovalball has never treated those as separate logins. The list here is
 * `listSwitchableContexts` -- the website's own function, from the shared package -- so the rows are
 * the same rows, in the same order, with the same labels.
 *
 * THE PERSON IS NAMED AT THE TOP, and it is the signed-in person: the identity block says who you ARE,
 * never the scope you happen to be viewing. Selecting a child does not turn the header into the child;
 * the CONTEXT row carries the child's name, in `switcherLabel`, which is exactly why that field exists
 * separately from `label`.
 *
 * A CREST IS A CREST. Club and team rows draw `logoUrl`, which the canonical resolver produced from the
 * club's own upload or the Club Directory's branding. Where there is none, initials. A kit is never
 * substituted -- the component this calls has nowhere to pass one.
 *
 * SELECTING CHANGES WHAT IS SHOWN. It does not change what may be done: capabilities are the server's
 * answer, asked again for the new scope.
 */
export function ContextSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { contexts, active, select, person } = useAppContexts()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }}
      />
      <View
        style={{
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingBottom: insets.bottom + space.lg,
          maxHeight: "80%",
        }}
      >
        <View style={{ padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }}>
          <PersonAvatar name={person.firstName} url={person.avatarUrl} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]} numberOfLines={1}>
              {person.firstName ?? "Your account"}
            </Text>
            <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
              {person.email ?? ""}
            </Text>
          </View>
        </View>

        <Text style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: space.lg, marginBottom: space.sm }]}>
          SWITCH TO
        </Text>

        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {contexts.map((context) => (
            <ContextRow
              key={context.key}
              context={context}
              selected={context.key === active?.key}
              onPress={async () => {
                await select(context.key)
                onClose()
              }}
            />
          ))}
          {contexts.length === 0 && (
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Your account is not connected to a club or team yet.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

function ContextRow({
  context,
  selected,
  onPress,
}: {
  context: SwitchableContext
  selected: boolean
  onPress: () => void
}) {
  // A child context is described by club and team; everything else by its role. The subject's own
  // picture belongs to a child row -- never the signed-in adult's.
  const caption = context.subjectName
    ? [context.subjectClubName, context.label].filter(Boolean).join(" · ")
    : context.roleLabel

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${context.switcherLabel}, ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: selected ? colour.mint100 : colour.surface,
        borderWidth: 1,
        borderColor: selected ? colour.pitch600 : colour.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {context.subjectName ? (
        <PersonAvatar name={context.subjectName} url={null} size={40} />
      ) : (
        <ClubCrest clubName={context.label} url={context.logoUrl} size={40} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={1}>
          {context.switcherLabel}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {selected && <Text style={[type.smallMedium, { color: colour.forest800 }]}>Current</Text>}
    </Pressable>
  )
}
