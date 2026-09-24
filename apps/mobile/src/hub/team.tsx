import { useState } from "react"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Check, ChevronDown, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { CODE_LABEL } from "./bundles"
import { hubTeamLabel, useHubIdentity } from "./identity"

/**
 * "VIEWING" — which of your own teams the personal parts of the Hub are about.
 *
 * Only drawn when the viewer has MORE THAN ONE real team relationship, exactly
 * as the website's TeamSwitcher is. A guardian of two children sees both
 * children by name; a coach of two sides sees both sides; a parent of one
 * child sees nothing to choose and nothing is drawn. The list is the server's
 * list. Choosing changes which rugby the Rules, Safeguarding, Player Welfare,
 * Positions and Skills pages are answering for -- and nothing else.
 */
export function HubTeamSwitch() {
  const { options, team, choose } = useHubIdentity()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  if (options.length < 2 || !team) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Viewing ${hubTeamLabel(team)}. Change team`}
        accessibilityHint="Chooses which of your teams the rules and guidance are for"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: pressed ? "rgba(16,21,18,0.04)" : colour.surface,
        })}
      >
        <Text style={[type.caption, { color: colour.inkMuted, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "Inter_500Medium" }]}>Viewing</Text>
        <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
          {hubTeamLabel(team)}
        </Text>
        <ChevronDown size={18} color={colour.inkMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)" }} />
        <View style={{ backgroundColor: colour.chalk, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + space.md, maxHeight: "70%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink, flex: 1 }]}>
              Whose Rugby?
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>
          <Text style={[type.small, { color: colour.inkMuted, paddingHorizontal: space.lg, paddingBottom: space.md }]}>
            Rules, safeguarding and welfare guidance follow the team you choose. Everything else in the Hub is the same for everyone.
          </Text>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
            {options.map((o) => {
              const selected = o.teamId === team.teamId
              return (
                <Pressable
                  key={o.teamId}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, selected }}
                  accessibilityLabel={hubTeamLabel(o)}
                  onPress={() => {
                    void choose(o.teamId)
                    setOpen(false)
                  }}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET + 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: selected ? colour.pitch600 : colour.line,
                    backgroundColor: pressed ? "rgba(220,247,229,0.5)" : colour.surface,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>{o.childName ?? o.teamDisplayName}</Text>
                    <Text style={[type.small, { color: colour.inkMuted }]}>{o.childName ? `${o.clubName} · ${o.teamDisplayName}` : o.clubName}</Text>
                  </View>
                  {selected && <Check size={20} color={colour.forest800} />}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

/** "Playing rules for Ovalball UAT RUFC's Under 12 Boys." -- the possessive the web pages use. */
export function hubTeamPossessive(team: { clubName: string; teamDisplayName: string } | null): string {
  return team ? `${team.clubName}'s ${team.teamDisplayName}` : "your team"
}

/**
 * "FOR UNDER 8 MIXED · RUGBY UNION" -- the one line that says which rugby a
 * contextual screen is answering for, drawn only on screens whose content
 * genuinely varies by team (Rules, Safeguarding, Player Welfare, Skills) and
 * never over universal material. The team's canonical display name carries the
 * age grade; the code comes from the identity RPC. Nothing is parsed from a
 * name. When the team was not the viewer's own choice (a club admin's first
 * team, or "All Children"), the line says so and points at the switch.
 */
export function HubContextLine({ subject }: { subject: string }) {
  const { team, identity, source, options, loading } = useHubIdentity()
  if (loading || !team) return null
  const code = identity?.rugbyCode ? CODE_LABEL[identity.rugbyCode] : null
  const who = team.childName ? `${team.childName}'s ${team.teamDisplayName}` : team.teamDisplayName
  const qualifier = source === "first" && options.length > 1 ? " — your first team; change it under Viewing" : ""
  return (
    <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest900 }]}>
      {subject} for <Text style={{ fontFamily: "Inter_600SemiBold" }}>{who}</Text>
      {code ? ` · ${code}` : ""}
      {qualifier}
    </Text>
  )
}
