import { useEffect, useRef } from "react"
import { Animated, Easing, Modal, PanResponder, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { SwitchableContext } from "@ovalball/contracts"

import { useAppContexts } from "../context/contexts"
import { ClubCrest, PersonAvatar } from "./identity"
import { Check } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * ONE PERSON, EVERY HAT THEY WEAR — as a bottom sheet, because that is what a phone does.
 *
 * WHY A SHEET RATHER THAN A SCREEN. Switching context is a glance and a tap, not a journey: you are
 * checking which side you are looking at, not going somewhere. A sheet keeps the page you were on
 * visible behind it, so the switch reads as adjusting your view rather than leaving it, and it is
 * dismissible by dragging down -- the gesture people already try.
 *
 * WHAT IT SHOWS, IN THIS ORDER: the person, then their rugby. A list of roles with no name at the top
 * is an administrative report; naming Peter first and then what Peter is, is how a person thinks about
 * it. The rows are `listSwitchableContexts` -- the website's own function, from the shared package --
 * so the contexts, their order and their labels are the same on both clients because it is the same
 * code, not because two implementations currently agree.
 *
 * A CHILD ROW IS THE CHILD. It carries `switcherLabel` and the subject's own picture, which is exactly
 * why those fields exist apart from `label`: two children on the same team must read as two rows, not
 * as one duplicated team name.
 *
 * A CREST IS A CREST. Club and team rows draw `logoUrl` from the canonical resolver, and the component
 * they hand it to has no fallback prop and no concept of a kit.
 */
export function ContextSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { contexts, active, select, person } = useAppContexts()
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(600)).current
  const backdrop = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      translate.setValue(600)
      Animated.parallel([
        // A spring, lightly damped: a sheet that eases linearly reads as a web modal, and one that
        // bounces reads as a toy. This settles once.
        Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start()
    }
  }, [visible, translate, backdrop])

  function dismiss() {
    Animated.parallel([
      Animated.timing(translate, { toValue: 600, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onClose()
    })
  }

  // Drag to dismiss, downward only, and only past a real threshold -- a sheet that closes on a
  // twitch is a sheet you cannot scroll.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) translate.setValue(gesture.dy)
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > 110 || gesture.vy > 0.9) dismiss()
        else Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, useNativeDriver: true }).start()
      },
    })
  ).current

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={dismiss} style={{ flex: 1 }} />
      </Animated.View>

      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "82%",
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl + 6,
          borderTopRightRadius: radius.xl + 6,
          paddingBottom: insets.bottom + space.lg,
          transform: [{ translateY: translate }],
          ...elevation.sheet,
        }}
      >
        <View {...pan.panHandlers} style={{ paddingTop: space.sm, paddingBottom: space.xs, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>

        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, flexDirection: "row", alignItems: "center", gap: space.md }}>
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

        <Text style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: space.lg, marginTop: space.lg, marginBottom: space.sm }]}>
          YOUR RUGBY
        </Text>

        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }} showsVerticalScrollIndicator={false}>
          {contexts.map((context) => (
            <ContextRow
              key={context.key}
              context={context}
              selected={context.key === active?.key}
              onPress={async () => {
                await select(context.key)
                dismiss()
              }}
            />
          ))}
          {contexts.length === 0 && (
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Your account is not connected to a club or team yet.
            </Text>
          )}
        </ScrollView>
      </Animated.View>
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
  const caption = context.subjectName
    ? [context.subjectClubName, context.label].filter(Boolean).join(" · ")
    : context.roleLabel

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${context.switcherLabel}, ${caption}${selected ? ", current" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 14,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        borderRadius: radius.lg,
        backgroundColor: selected ? colour.mint100 : colour.surface,
        borderWidth: 1,
        borderColor: selected ? colour.pitch600 : colour.line,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      {context.subjectName ? (
        <PersonAvatar name={context.subjectName} url={null} size={42} />
      ) : (
        <ClubCrest clubName={context.label} url={context.logoUrl} size={42} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={1}>
          {context.switcherLabel}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {/* The tick is not colour alone: a filled disc plus a mark, so the selected row survives being
          seen in bright sun or by somebody who does not separate the greens. */}
      {selected && (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center" }}>
          <Check size={15} color={colour.onForest} strokeWidth={3} />
        </View>
      )}
    </Pressable>
  )
}
