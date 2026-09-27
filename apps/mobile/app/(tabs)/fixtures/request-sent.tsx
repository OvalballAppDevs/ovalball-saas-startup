import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "../../../src/components/ui"
import { ClubCrest } from "../../../src/clubhouse/components"
import { Bell, Check, ChevronRight } from "../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"

/**
 * REQUEST SENT -- THE VISUAL/PRODUCT CONTRACT FOR A SUCCESSFUL MULTI-TEAM REQUEST (owner correction
 * pass, supplied mockup). Reached only via `router.replace` from the Request Fixtures composer, and
 * ONLY with `items` naming the requests the server itself actually created (Section 2) -- this screen
 * never fabricates a count and never runs before the mutation has genuinely succeeded.
 *
 * Each row's small badge is a plain age/gender-initial mark, the same style `TeamRow` already uses on
 * the Public Club Profile's own Teams tab -- never an invented per-team crest. Individual teams have no
 * canonical logo of their own; only the club does, and the club's real crest is shown once, at the top.
 */
export default function RequestSent() {
  const router = useRouter()

  const params = useLocalSearchParams<{
    clubName: string
    clubTown?: string
    clubCounty?: string
    clubLogoUrl?: string
    date: string
    items?: string
    groupId?: string
  }>()

  const items: { requestId: string; myTeamLabel: string; myTeamCategory: string; opponentTeamLabel: string; venue: "Home" | "Away" | "Either" }[] = (() => {
    try {
      return params.items ? JSON.parse(params.items) : []
    } catch {
      return []
    }
  })()

  const dateLabel = (() => {
    const d = new Date(`${params.date}T00:00:00`)
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
  })()

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <RequestSentHero onBack={() => router.back()} clubName={params.clubName} teamCount={items.length} />

        <View style={{ paddingHorizontal: space.lg, marginTop: -space.xl, gap: space.lg, paddingBottom: space.xl }}>
          <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, ...elevation.card }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
              <ClubCrest url={params.clubLogoUrl || null} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                  {params.clubName}
                </Text>
                {(params.clubTown || params.clubCounty) && (
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                    {[params.clubTown, params.clubCounty].filter(Boolean).join(", ")}
                  </Text>
                )}
              </View>
            </View>

            <View style={{ borderTopWidth: 1, borderTopColor: colour.line, padding: space.md, gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Requested teams</Text>
              {items.map((item, i) => (
                <View key={item.requestId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: i === 0 ? 0 : space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                    <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{item.myTeamLabel.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>
                      {item.myTeamLabel}
                    </Text>
                    <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>
                      {item.myTeamCategory}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                    {dateLabel} · {item.venue}
                  </Text>
                </View>
              ))}
              {items.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No requests to show.</Text>}
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.md, borderTopWidth: 1, borderTopColor: colour.line }}>
              <Bell size={16} color={colour.pitch600} />
              {/* TRUTHFUL WORDING (Section 5): this refers to Ovalball's own notification/action-centre
                  behaviour, which already fires on a fixture request's response -- never a promise of
                  OS push delivery this app has not configured. */}
              <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>You&apos;ll be notified when they respond.</Text>
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Button
              label="View Request"
              style={{ backgroundColor: colour.pitch600, borderColor: colour.pitch600 }}
              // ROUTES TO THE EXACT GROUP JUST CREATED (Section 21), never a generic list -- the group id
              // the server itself returned when this batch was created.
              onPress={() => router.replace({ pathname: "/fixtures/request/[groupId]", params: { groupId: params.groupId ?? "" } } as never)}
            />
            <Button label="Find More Clubs" variant="secondary" onPress={() => router.replace({ pathname: "/clubhouse/find-fixture" } as never)} />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

function RequestSentHero({ onBack, clubName, teamCount }: { onBack: () => void; clubName: string; teamCount: number }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ backgroundColor: colour.forest950, paddingBottom: space.xxl * 2, paddingHorizontal: space.lg }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.onForest} />
          </View>
        </Pressable>
        <Text numberOfLines={1} accessibilityRole="header" style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>
          Request Sent
        </Text>
      </View>

      <View style={{ alignItems: "center", gap: space.md, paddingTop: space.lg }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(50,166,101,0.22)", alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colour.pitch600, alignItems: "center", justifyContent: "center" }}>
            <Check size={30} color={colour.onForest} strokeWidth={3} />
          </View>
        </View>
        <Text style={[type.title, { color: colour.onForest, textAlign: "center" }]}>Fixture request sent!</Text>
        <Text style={[type.small, { color: colour.onForestMuted, textAlign: "center" }]}>
          {/* CORRECT SINGULAR/PLURAL (Section 3), never hardcoded to any one club -- both the club name
              and the team count come from what the server actually created. */}
          Your request has been sent to{"\n"}
          {clubName} for {teamCount} {teamCount === 1 ? "team" : "teams"}.
        </Text>
      </View>
    </View>
  )
}
