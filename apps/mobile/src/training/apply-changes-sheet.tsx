import { Pressable, Text, View } from "react-native"

import { Sheet } from "../pitch-allocation/sheets"
import { Button } from "../components/ui"
import { CalendarDays } from "../components/icons"
import { colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE SCOPE CHOICE, as its own proper sheet (Step 7 correction) rather than the native `Alert.alert`
 * the Step 6 pass used -- that worked, but looked like OS chrome rather than Ovalball. Same two
 * destinations underneath (`overrideTrainingSession` / `applyToAllFutureSessions`,
 * `training-operations.tsx`), only the presentation changed.
 */
export function ApplyChangesSheet({
  visible,
  dateLabel,
  onClose,
  onSessionOnly,
  onAllFuture,
}: {
  visible: boolean
  /** "Mon 5 Oct 2026" -- the exact occurrence being edited, named in the first option's own copy. */
  dateLabel: string
  onClose: () => void
  onSessionOnly: () => void
  onAllFuture: () => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Apply Changes">
      <View style={{ gap: space.lg }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
            <CalendarDays size={22} color={colour.forest800} />
          </View>
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>
            Do you want to apply these changes to just this session or to this and all future sessions in this training plan?
          </Text>
        </View>

        <ScopeOption title="This Session Only" subtitle={`Only update ${dateLabel}`} onPress={onSessionOnly} />
        <ScopeOption title="This and All Future Sessions" subtitle="Update this and all future sessions in this training plan" onPress={onAllFuture} />

        <Button label="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  )
}

function ScopeOption({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        padding: space.md,
        gap: 2,
        opacity: pressed ? 0.92 : 1,
        ...elevation.card,
      })}
    >
      <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{subtitle}</Text>
    </Pressable>
  )
}
