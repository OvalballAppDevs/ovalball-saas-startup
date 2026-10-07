import { Pressable, Text, View } from "react-native"

import type { AttentionItem } from "@ovalball/contracts/attention"
import type { AttentionVerdict, FeedNotification } from "@ovalball/contracts/notifications/feed"

import { attentionFamily, notificationFamily } from "../notifications/family"
import { ChevronRight } from "./icons"
import { NotificationGlyph } from "./notification-glyph"
import { whenLabel } from "./notification-card"
import { deleteAccessibilityAction } from "./swipe-to-delete"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * ONE NOTIFICATION ROW, ONE JOB ROW, ONE TAB -- shared by the bell's quick view and the Notifications
 * Centre, so a notification looks the same wherever it is listed (approved notifications mock-up:
 * family icon, bold title when unread, time on the right, two lines of body, a green unread mark, a
 * restrained rose ground and red mark while it still needs this person).
 */
export function TabButton({
  label,
  count,
  badge,
  selected,
  onPress,
}: {
  label: string
  count: number | null
  badge: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={count ? `${label}, ${count}` : label}
      onPress={onPress}
      style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: 6, borderBottomWidth: 2, borderBottomColor: selected ? colour.pitch600 : "transparent", marginBottom: -1 }}
    >
      <Text style={[type.smallMedium, { color: selected ? colour.ink : colour.inkMuted, fontFamily: selected ? "Inter_600SemiBold" : "Inter_500Medium" }]}>{label}</Text>
      {!!count && (
        <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: badge, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colour.onForest, fontSize: 11, lineHeight: 13, fontFamily: "Inter_600SemiBold" }}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </Pressable>
  )
}

export function NotificationRow({
  item,
  verdict,
  divider,
  onPress,
  onDelete,
  onLongPress,
}: {
  item: FeedNotification
  verdict: AttentionVerdict
  divider: boolean
  onPress: () => void
  onDelete: () => void
  onLongPress?: () => void
}) {
  const unread = item.readAt === null
  const needsYou = verdict === "open"
  return (
    <PanelRow
      family={notificationFamily(item.type, item.data)}
      title={item.title}
      body={item.body}
      when={whenLabel(item.createdAt, new Date())}
      unread={unread}
      needsYou={needsYou}
      divider={divider}
      label={`${needsYou ? "Action required. " : ""}${unread ? "Unread. " : ""}${item.title}. ${item.body}`}
      onPress={onPress}
      onDelete={onDelete}
      onLongPress={onLongPress}
    />
  )
}

/** An open job from the live projection, drawn exactly like the notification about it would be. */
export function JobRow({ item, divider, onPress }: { item: AttentionItem; divider: boolean; onPress: () => void }) {
  const needsYou = item.priority !== "for_information"
  return (
    <PanelRow
      family={attentionFamily(item.sourceType)}
      title={item.title}
      body={item.summary ?? ""}
      when={null}
      unread={false}
      needsYou={needsYou}
      divider={divider}
      label={`${needsYou ? "Action required. " : ""}${item.title}${item.summary ? `. ${item.summary}` : ""}`}
      onPress={onPress}
    />
  )
}

function PanelRow({
  family,
  title,
  body,
  when,
  unread,
  needsYou,
  divider,
  label,
  onPress,
  onDelete,
  onLongPress,
}: {
  family: ReturnType<typeof notificationFamily>
  title: string
  body: string
  when: string | null
  unread: boolean
  needsYou: boolean
  divider: boolean
  label: string
  onPress: () => void
  onDelete?: () => void
  onLongPress?: () => void
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={when ? `${label}. ${when}` : label}
      accessibilityActions={onDelete ? deleteAccessibilityAction : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") onDelete?.()
      }}
      onPress={onPress}
    >
      {({ pressed }) => (
        <>
          {divider && <View style={{ height: 1, backgroundColor: colour.line, marginLeft: 76, marginRight: space.lg }} />}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.md,
              marginHorizontal: space.sm,
              marginVertical: needsYou ? 2 : 0,
              paddingVertical: space.md,
              paddingRight: space.sm,
              paddingLeft: space.xs,
              borderRadius: radius.lg,
              // ACTION REQUIRED reads at a glance: a quiet rose ground and a red mark, never a siren.
              backgroundColor: pressed ? (needsYou ? "#fbe6e6" : colour.chalk) : needsYou ? colour.dangerSurface : colour.surface,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            }}
          >
            <View style={{ width: 10, alignItems: "center", paddingTop: 15 }}>
              {(unread || needsYou) && (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: needsYou ? colour.danger : colour.pitch600 }} />
              )}
            </View>
            <NotificationGlyph family={family} size={40} shape="circle" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                <Text numberOfLines={body ? 1 : 2} style={[type.smallMedium, { color: colour.ink, flex: 1, fontSize: 15, fontFamily: unread || needsYou ? "Inter_600SemiBold" : "Inter_500Medium" }]}>
                  {title}
                </Text>
                {!!when && <Text style={[type.caption, { color: colour.inkSubtle }]}>{when}</Text>}
              </View>
              {!!body && (
                <Text numberOfLines={2} style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>
                  {body}
                </Text>
              )}
            </View>
            <View style={{ alignSelf: "center" }}>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </View>
          </View>
        </>
      )}
    </Pressable>
  )
}

export function SkeletonRow() {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: space.md, paddingLeft: space.lg + space.sm, paddingRight: space.lg }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.chalk }} />
      <View style={{ flex: 1, gap: 7, paddingTop: 4 }}>
        <View style={{ width: "62%", height: 12, borderRadius: 4, backgroundColor: colour.chalk }} />
        <View style={{ width: "88%", height: 10, borderRadius: 4, backgroundColor: colour.chalk }} />
      </View>
    </View>
  )
}
