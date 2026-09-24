import { useEffect, useRef } from "react"
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { FamilyMember } from "@ovalball/contracts"

import { useFamily } from "./family"
import { PersonAvatar } from "../components/identity"
import { Check, Users } from "../components/icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE CHILD SELECTOR (CA-M9): All Children, or one of them.
 *
 * A sheet, like the context switcher, because choosing whose rugby to read is a glance and a tap. Each
 * row is the child's own picture, their name, the sides they play for and the club those sides belong
 * to -- and nothing else: no age, no date of birth, no relationship record. Choosing a child is
 * PRESENTATION STATE: it narrows what the screens show, it grants nothing, and every read the app then
 * makes is still answered by the server for this signed-in person.
 */
export function ChildSelector({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { projection, selectedPlayerId, select } = useFamily()
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(600)).current
  const backdrop = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      translate.setValue(600)
      Animated.parallel([
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

  const children = distinctChildren(projection.members)
  const choose = (playerId: string | null) => {
    select(playerId)
    dismiss()
  }

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
          transform: [{ translateY: translate }],
          backgroundColor: colour.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingBottom: insets.bottom + space.md,
          maxHeight: "80%",
          ...elevation.sheet,
        }}
      >
        <View style={{ alignItems: "center", paddingTop: space.sm }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Whose rugby?
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>Everything on the app follows this choice.</Text>
        </View>
        <ScrollView accessibilityRole="radiogroup" accessibilityLabel="Show one child, or all of them">
          <Row
            selected={selectedPlayerId === null}
            label="All Children"
            caption={children.map((c) => c.firstName).join(", ")}
            leading={<StackedAvatars members={children} />}
            onPress={() => choose(null)}
          />
          {children.map((child) => {
            const teams = teamsFor(projection.members, child.playerId)
            return (
              <Row
                key={child.playerId}
                selected={selectedPlayerId === child.playerId}
                label={child.fullName}
                caption={teams.map((t) => `${t.teamName} · ${t.clubName}`).join("\n")}
                leading={<PersonAvatar name={child.fullName} url={child.avatarUrl} initials={child.initials} size={40} />}
                onPress={() => choose(child.playerId)}
              />
            )
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

function Row({ selected, label, caption, leading, onPress }: { selected: boolean; label: string; caption: string; leading: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${caption.replace(/\n/g, ", ")}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 16,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? colour.chalk : selected ? "rgba(50,166,101,0.06)" : "transparent",
      })}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{label}</Text>
        {!!caption && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>}
      </View>
      {selected && <Check size={20} color={colour.forest800} strokeWidth={2.4} />}
    </Pressable>
  )
}

export function StackedAvatars({ members, size = 34 }: { members: FamilyMember[]; size?: number }) {
  const shown = members.slice(0, 3)
  if (shown.length === 0) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Users size={size * 0.5} color={colour.forest800} />
      </View>
    )
  }
  const overlap = size * 0.55
  return (
    <View accessible={false} style={{ flexDirection: "row", width: size + overlap * (shown.length - 1), height: size }}>
      {shown.map((m, i) => (
        <View key={m.playerId} style={{ position: "absolute", left: i * overlap, borderWidth: 2, borderColor: colour.surface, borderRadius: size / 2 + 2 }}>
          <PersonAvatar name={m.fullName} url={m.avatarUrl} initials={m.initials} size={size} />
        </View>
      ))}
    </View>
  )
}

export function distinctChildren(members: FamilyMember[]): FamilyMember[] {
  const seen = new Set<string>()
  const out: FamilyMember[] = []
  for (const m of members) {
    if (seen.has(m.playerId)) continue
    seen.add(m.playerId)
    out.push(m)
  }
  return out
}

export function teamsFor(members: FamilyMember[], playerId: string): { teamId: string; teamName: string; clubName: string }[] {
  return members.filter((m) => m.playerId === playerId).map((m) => ({ teamId: m.teamId, teamName: m.teamName, clubName: m.clubName }))
}
