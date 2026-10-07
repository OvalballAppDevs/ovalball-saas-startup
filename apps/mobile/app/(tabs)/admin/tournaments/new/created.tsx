import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { FORMAT_ICON } from "../../../../../src/tournaments/format-icon"
import { TOURNAMENT_FORMAT_LABELS, type TournamentFormat } from "@ovalball/contracts/club/tournaments"

import { supabase } from "../../../../../src/auth/supabase"
import { TournamentCreatedClip } from "../../../../../src/tournaments/tournament-created-clip"
import { useTournamentDraft } from "../../../../../src/tournaments/create-context"
import { ageGroupsLabel, daysLabel, tournamentDayCount } from "../../../../../src/tournaments/create-payload"
import { teamsLabel } from "../../../../../src/tournaments/teams-selection"
import { CalendarDays, Check, Globe, Layers, ListOrdered, Lock, MapPin, Shirt, Trophy, Users } from "../../../../../src/components/icons"
import { colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * TOURNAMENT CREATED.
 *
 * REACHED ONLY AFTER THE ROW EXISTS. Review navigates here with the id the transaction returned, so
 * this screen can never be a promise: it reads the tournament back from the database and shows what
 * was actually saved. A success screen built from the draft would look identical whether the write
 * landed or not, which is precisely the thing worth being certain about.
 *
 * THE DRAFT IS ALREADY GONE by the time this renders -- Review clears it the moment creation succeeds
 * -- so Create Another Tournament starts genuinely empty rather than with the last festival's venue
 * and teams still in it.
 */
export default function TournamentCreatedScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { reset } = useTournamentDraft()

  /**
   * THE CONVERSION PLAYS OVER THIS SCREEN, not before it.
   *
   * The row already exists by the time we get here, so the animation is never a promise -- and running
   * it on top means the screen has loaded and settled underneath while the ball is in the air. When the
   * animation lifts there is nothing to wait for and no cut: the mark it leaves behind is in the same
   * place as the mark this screen draws.
   */
  const [celebrating, setCelebrating] = useState(true)

  const [row, setRow] = useState<{
    name: string
    visibility: string
    format: string
    startsOn: string
    endsOn: string | null
    venueName: string | null
    venueAddress: string | null
    ageGroups: string[]
    teams: number
  } | null>(null)

  useEffect(() => {
    if (!id) return
    let live = true
    void supabase
      .from("tournaments")
      .select("name, visibility, format, event_date, ends_on, venues(name, address_line_1, town, postcode), tournament_age_groups(age_group), tournament_team_entries(id), tournament_participants(id)")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return
        const venue = data.venues as unknown as { name: string; address_line_1: string | null; town: string | null; postcode: string | null } | null
        setRow({
          name: data.name,
          visibility: data.visibility ?? "private",
          format: data.format ?? "league",
          startsOn: data.event_date,
          endsOn: data.ends_on,
          venueName: venue?.name ?? null,
          venueAddress: [venue?.address_line_1, venue?.town, venue?.postcode].filter(Boolean).join(", ") || null,
          ageGroups: (data.tournament_age_groups ?? []).map((a: { age_group: string }) => a.age_group),
          // TEAMS, NOT CLUBS: our own entries plus every other club's sides.
          teams: (data.tournament_team_entries ?? []).length + (data.tournament_participants ?? []).length,
        })
      })
    return () => {
      live = false
    }
  }, [id])

  if (!row) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center" }}>
        {/* The spinner only ever shows if the read is slower than the kick. */}
        {celebrating ? <TournamentCreatedClip onDone={() => setCelebrating(false)} /> : <ActivityIndicator color={colour.forest800} />}
      </View>
    )
  }

  const days = tournamentDayCount(row.startsOn, row.endsOn)
  const isPublic = row.visibility === "public"
  const FormatIcon = FORMAT_ICON[row.format as TournamentFormat]

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}>
        {/* THE ONE MOMENT OF CELEBRATION IN THE WIZARD, and it stays a single mark on a pale ground
            rather than a full-bleed green panel -- the tournament is the subject, not the tick. */}
        <View style={{ alignItems: "center", paddingTop: insets.top + space.xl, paddingBottom: space.lg, backgroundColor: colour.successSurface }}>
          <View style={{ width: 86, height: 86, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colour.forest800 }}>
            <Check size={40} color={colour.onForest} strokeWidth={3} />
          </View>
          {/* The display face is all-caps by design, which suits GOOD EVENING and a club name and
              shouts here. The heading keeps the body family, scaled up, so it stays a sentence. */}
          <Text style={[type.title, { fontSize: 26, lineHeight: 32, color: colour.ink, marginTop: space.lg, textAlign: "center" }]}>Tournament Created!</Text>
          <Text numberOfLines={2} style={[type.body, { color: colour.ink, marginTop: space.xs, textAlign: "center", paddingHorizontal: space.lg }]}>
            {row.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line }}>
            {isPublic ? <Globe size={12} color={colour.inkMuted} strokeWidth={2} /> : <Lock size={12} color={colour.inkMuted} strokeWidth={2} />}
            <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{isPublic ? "Public" : "Private"}</Text>
          </View>
        </View>

        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ gap: space.sm }}>
            <Row icon={<CalendarDays size={17} color={colour.rugby700} strokeWidth={1.9} />} value={dateRange(row.startsOn, row.endsOn)} />
            <Row icon={<MapPin size={17} color={colour.rugby700} strokeWidth={1.9} />} value={row.venueName ?? "No venue"} secondary={row.venueAddress} />
          </View>

          {/* READ BACK FROM THE DATABASE, not from the draft -- these are the rows that exist. */}
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            <Summary icon={<Users size={17} color={colour.rugby700} strokeWidth={1.9} />} title={ageGroupsLabel(row.ageGroups.length)} detail={row.ageGroups.join("  ·  ")} />
            <Summary icon={<Shirt size={17} color={colour.rugby700} strokeWidth={1.9} />} title={teamsLabel(row.teams)} />
            <Summary icon={<CalendarDays size={17} color={colour.rugby700} strokeWidth={1.9} />} title={daysLabel(days)} />
            <Summary icon={<FormatIcon size={17} color={colour.rugby700} strokeWidth={1.9} />} title={TOURNAMENT_FORMAT_LABELS[row.format as TournamentFormat]?.label ?? row.format} last />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View Tournament"
            onPress={() => router.replace(`/admin/tournaments/${id}` as never)}
            style={({ pressed }) => ({ minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colour.forest800, opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.onForest }]}>View Tournament</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create Another Tournament"
            onPress={() => {
              // Belt and braces: Review already cleared the draft, and this guarantees it even if this
              // screen was reached some other way.
              reset()
              router.replace("/admin/tournaments/new" as never)
            }}
            style={({ pressed }) => ({ minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.ink }]}>Create Another Tournament</Text>
          </Pressable>
        </View>
      </ScrollView>

      {celebrating && <TournamentCreatedClip onDone={() => setCelebrating(false)} />}
    </View>
  )
}

function Row({ icon, value, secondary }: { icon: React.ReactNode; value: string; secondary?: string | null }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <View style={{ width: 20, alignItems: "center", paddingTop: 1 }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: colour.ink }]}>{value}</Text>
        {!!secondary && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{secondary}</Text>}
      </View>
    </View>
  )
}

function Summary({ icon, title, detail, last }: { icon: React.ReactNode; title: string; detail?: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colour.line }}>
      <View style={{ width: 20, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: colour.ink }]}>{title}</Text>
        {!!detail && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {detail}
          </Text>
        )}
      </View>
    </View>
  )
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function one(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso
}

/** "30 Sep 2026" for one day, "30 Sep 2026 – 2 Oct 2026" for more. A range that is really one day
 * reads as a mistake, so it is never printed twice. */
function dateRange(startsOn: string, endsOn: string | null): string {
  if (!endsOn || endsOn === startsOn) return one(startsOn)
  return `${one(startsOn)} – ${one(endsOn)}`
}
