import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppContexts } from "../context/contexts"
import { ClubCrest } from "../components/identity"
import { ChevronLeft } from "../components/icons"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * THE TEAM WORKSPACE'S INNER SCREENS share one shell: Back, the CLUB crest beside the TEAM's name, and
 * the section. The crest is the club's -- the identity the team belongs to -- resolved once in the
 * context provider so it is the same picture on every screen; the team is named in words, because a
 * team has no crest of its own and a kit is not an identity. Nothing here is decided by the shell.
 */
export function TeamScreen({
  section,
  children,
  refreshing = false,
  onRefresh,
  footer,
  padded = true,
}: {
  section: string
  children: React.ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  footer?: React.ReactNode
  padded?: boolean
}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { club, active } = useAppContexts()
  const teamName = active?.kind === "team" ? active.label : club.name ?? "Team"
  const back = () => (router.canGoBack() ? router.back() : router.dismissTo("/"))
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.xs,
          paddingBottom: space.xs,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          backgroundColor: colour.chalk,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          hitSlop={6}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent" })}
        >
          <ChevronLeft size={24} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
        <ClubCrest clubName={club.name} url={club.crestUrl} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.forest800, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {teamName}
          </Text>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {section}
          </Text>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: padded ? space.lg : 0, paddingTop: space.lg, paddingBottom: insets.bottom + space.xxl + (footer ? 72 : 0), gap: space.lg }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

/** A quiet, dashed "not for you" that says what is missing, rather than an empty list. */
export function NotForYou({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colour.lineStrong, padding: space.xl, gap: space.xs }}>
      <Text style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
      <Text style={[type.small, { color: colour.inkMuted }]}>{body}</Text>
    </View>
  )
}
