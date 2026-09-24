import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../../src/auth/supabase"
import { webUrl } from "../../../../src/config/environment"
import { exactDate } from "../../../../src/agenda/presentation"
import { ChevronRight, ExternalLink, MapPin, Users } from "../../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, space, type } from "../../../../src/design/tokens"

/**
 * A CLUB EVENT (CA-M10): the canonical card, read by `get_club_event_card` -- the one operation the
 * website's Event Centre reads -- and drawn in the calendar's own words. Who it is for, when, where.
 * Responding for a child and the register stay on the website's Event Centre for now: the answer
 * path and its notification semantics are H29's open question, and this screen does not pre-empt it.
 */
interface EventCard {
  id: string
  name: string
  description: string | null
  starts_on: string
  ends_on: string
  start_time: string | null
  end_time: string | null
  is_club_wide: boolean
  status: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  club_name: string | null
  teams: { display_name: string | null }[] | null
  venue: { name: string | null; address_line_1?: string | null; town?: string | null; postcode?: string | null } | null
  external_location: { name?: string | null; town?: string | null; postcode?: string | null } | null
  can_manage: boolean
  can_view_register: boolean
}

export default function ClubEventScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { eventId } = useLocalSearchParams<{ eventId: string }>()
  const [card, setCard] = useState<EventCard | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!eventId) return
    setProblem(null)
    try {
      const { data, error } = await supabase.rpc("get_club_event_card", { p_event_id: eventId })
      if (error) throw error
      const payload = data as unknown as (EventCard & { success?: boolean }) | null
      setCard(payload && payload.success !== false && payload.id ? payload : null)
    } catch (caught) {
      const failure = friendly(caught, "this event")
      logDetail("club event", failure)
      setProblem(failure.message)
    }
  }, [eventId])
  useEffect(() => {
    void load()
  }, [load])

  const when = card ? `${exactDate(card.starts_on)}${card.ends_on !== card.starts_on ? ` – ${exactDate(card.ends_on)}` : ""}${card.start_time ? ` · ${card.start_time.slice(0, 5)}${card.end_time ? `–${card.end_time.slice(0, 5)}` : ""}` : ""}` : ""
  const where = card ? (card.venue?.name ?? [card.external_location?.name, card.external_location?.town].filter(Boolean).join(", ")) : ""
  const audience = card ? (card.is_club_wide ? "Whole club" : (card.teams ?? []).map((t) => t.display_name).filter(Boolean).join(", ") || "Selected sides") : ""

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink, flex: 1 }]}>Club Event</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {card === undefined && !problem && <CardSkeleton lines={3} />}
        {card === null && <EmptyState title="This event is not available" body="It may have been removed, or it may belong to a club you are not part of." />}
        {card && (
          <>
            <View style={{ gap: 4 }}>
              <Text style={[type.overline, { color: colour.warning }]}>{card.cancelled_at ? "CANCELLED" : "CLUB EVENT"}</Text>
              <Text style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 34 }]}>{card.name}</Text>
              {!!card.club_name && <Text style={[type.small, { color: colour.inkMuted }]}>{card.club_name}</Text>}
            </View>
            {!!card.cancelled_at && <Text style={[type.small, { color: colour.danger }]}>{card.cancellation_reason ?? "This event is not going ahead."}</Text>}
            <Card style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{when}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Users size={16} color={colour.forest800} />
                <Text style={[type.small, { color: colour.ink }]}>{audience}</Text>
              </View>
              {!!where && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <MapPin size={16} color={colour.forest800} />
                  <Text style={[type.small, { color: colour.ink }]}>{where}</Text>
                </View>
              )}
            </Card>
            {!!card.description && <Text style={[type.body, { color: colour.ink }]}>{card.description}</Text>}
            <Card onPress={() => void Linking.openURL(`${webUrl}/events/${card.id}`)} accessibilityLabel="Attendance and the register are on the Ovalball website">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{card.can_view_register ? "Register and attendance" : "Attendance"}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Answering for a player, and the register, are on the website for now.</Text>
                </View>
                <ExternalLink size={16} color={colour.inkSubtle} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}
