import { useCallback, useMemo, useState } from "react"
import { Image, Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  EMPTY_TOURNAMENT_FILTERS,
  activeFilterCount,
  filterTournaments,
  readClubTournaments,
  readTournamentCapabilities,
  teamCountLabel,
  tournamentDateLine,
  type TournamentCapabilities,
  type TournamentFilter,
  type TournamentFilters,
  type TournamentListItem,
} from "@ovalball/contracts/club/tournaments"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { resolveTournamentCover } from "@ovalball/contracts/tournament-cover"
import { coverPhotoSource } from "../../../../src/media/stock-assets"
import { CalendarDays, ChevronRight, MapPin, Search, SlidersHorizontal, Users } from "../../../../src/components/icons"
import { TournamentFilterSheet } from "../../../../src/tournaments/filter-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

// The tournament-day hero. Photographic, dark-treated, the same shape Venue Detail and Training
// Planning already use.
const TOURNAMENT_HERO = require("../../../../assets/tournaments/tournament-hero-01.jpg")

const FILTERS: { key: TournamentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hosting", label: "Hosting" },
  { key: "attending", label: "Attending" },
  { key: "past", label: "Past" },
]

/**
 * TOURNAMENTS -- the club's festivals and cup days, natively.
 *
 * One occasion per card: what it is called, whether we are running it or turning up to it, when,
 * where, which age groups it runs and how many sides are in it altogether. Everything on the card is
 * canonical -- the age groups come from the tournament's own `tournament_age_groups`, the count from
 * the real entries and participants. Nothing is illustrative.
 *
 * `Hosting / Attending / Past` is deliberately the vocabulary here rather than home/away: home and
 * away describe one fixture between two sides and say nothing useful about a festival of fourteen
 * teams across three age groups.
 *
 * Create appears only when the server says `tournament.tournament.manage`. That is a reflection of
 * the server's answer, never the boundary -- every write re-checks.
 */
export default function TournamentsScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const [items, setItems] = useState<TournamentListItem[] | null>(null)
  const [caps, setCaps] = useState<TournamentCapabilities>({ view: false, manage: false })
  const [filter, setFilter] = useState<TournamentFilter>("all")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<TournamentFilters>(EMPTY_TOURNAMENT_FILTERS)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setItems(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [rows, capabilities] = await Promise.all([readClubTournaments(supabase, clubId, today), readTournamentCapabilities(supabase, clubId)])
      setItems(rows)
      setCaps(capabilities)
    } catch (e) {
      setError(friendly(e))
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const shown = useMemo(() => filterTournaments(items ?? [], filter, query, filters), [items, filter, query, filters])
  const agesPresent = useMemo(() => Array.from(new Set((items ?? []).flatMap((t) => t.ageGroups))).sort(), [items])
  const activeFilters = activeFilterCount(filters)

  return (
    <AdminScreen section="Tournaments">
      {/* THE COMPOSITION. AdminScreen pads its content and puts a large gap between direct children;
          the approved design wants a full-bleed banner with the filters, search and list tucked
          straight underneath it. So the whole screen is ONE child that manages its own spacing, and
          the hero cancels the container's padding with negative margins rather than sitting inside it
          as a floating card. */}
      <View>
        <View style={{ height: 210, marginHorizontal: -space.lg, marginTop: -space.xl, overflow: "hidden" }}>
          <Image source={TOURNAMENT_HERO} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" />
          {/* Dark forest treatment, heavier at the foot, so the white type stays legible over a busy
              photograph without flattening the picture itself. */}
          <View style={{ position: "absolute", width: "100%", height: "100%", backgroundColor: "rgba(9,26,18,0.42)" }} />
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, backgroundColor: "rgba(9,26,18,0.55)" }} />
          <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: space.lg, paddingBottom: space.lg }}>
            <Text accessibilityRole="header" accessibilityLabel="Tournaments" maxFontSizeMultiplier={1.3} style={[type.display, { color: "#FFFFFF", letterSpacing: 0.6 }]}>TOURNAMENTS</Text>
            <Text maxFontSizeMultiplier={1.3} style={[type.overline, { color: "rgba(255,255,255,0.86)", marginTop: 2 }]}>VIEW, MANAGE &amp; RUN TOURNAMENTS</Text>
          </View>
        </View>

        {/* FILTER NAVIGATION -- immediately under the hero, part of the same composition. */}
        <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.md }}>
          {FILTERS.map((f) => {
            const on = filter === f.key
            return (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${f.label} tournaments`}
                onPress={() => setFilter(f.key)}
                style={{
                  flex: 1,
                  minHeight: TOUCH_TARGET,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.pill,
                  backgroundColor: on ? colour.forest800 : colour.surface,
                  borderWidth: 1,
                  borderColor: on ? colour.forest800 : colour.line,
                }}
              >
                <Text style={[type.caption, { color: on ? "#FFFFFF" : colour.inkMuted, fontFamily: "Inter_600SemiBold" }]}>{f.label}</Text>
              </Pressable>
            )
          })}
        </View>

        {/* SEARCH + FILTER, directly beneath. */}
        <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.sm }}>
          <View
            style={{
              flex: 1,
              minHeight: TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
            }}
          >
            <Search size={17} color={colour.inkSubtle} strokeWidth={1.9} />
            <TextInput
              accessibilityLabel="Search tournaments"
              value={query}
              onChangeText={setQuery}
              placeholder="Search tournaments..."
              placeholderTextColor={colour.inkSubtle}
              autoCorrect={false}
              style={[type.body, { color: colour.ink, flex: 1, minHeight: TOUCH_TARGET }]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} applied` : "Filter tournaments"}
            onPress={() => setSheetOpen(true)}
            style={{
              width: TOUCH_TARGET,
              minHeight: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: activeFilters > 0 ? colour.forest800 : colour.line,
              backgroundColor: activeFilters > 0 ? colour.forest800 : colour.surface,
            }}
          >
            <SlidersHorizontal size={18} color={activeFilters > 0 ? "#FFFFFF" : colour.inkMuted} strokeWidth={1.9} />
          </Pressable>
        </View>

        {/* THE LIST, straight underneath. */}
        <View style={{ marginTop: space.md, gap: space.sm }}>
      {loading && (
        <View style={{ gap: space.sm }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </View>
      )}

      {!loading && error && <ErrorState message={error.message} onRetry={() => void load()} />}

      {!loading && !error && shown.length === 0 && (
        <EmptyState
          title={query.trim() || filter !== "all" ? "Nothing matches" : "No tournaments yet"}
          body={
            query.trim() || filter !== "all"
              ? "Try a different filter or search."
              : caps.manage
                ? "Create a festival or cup day and the teams taking part will appear here."
                : "The club has not recorded a tournament yet."
          }
        />
      )}

      {!loading && !error && shown.length > 0 && (
        <View style={{ gap: space.sm }}>
          {shown.map((t) => (
            <TournamentCard
              key={t.id}
              tournament={t}
              // The organiser's screen is for the tournaments this club runs; one it is attending opens the
              // Tournament Centre, in this stack, as it would from the Calendar.
              onPress={() => router.push((t.hostedByThisClub ? `/admin/tournaments/${t.id}` : `/admin/tournament/${t.id}`) as never)}
            />
          ))}
        </View>
      )}

        </View>

        {caps.manage && (
          <View style={{ marginTop: space.md }}>
            <Button label="Create New Tournament" onPress={() => router.push("/admin/tournaments/new" as never)} />
          </View>
        )}
      </View>

      <TournamentFilterSheet
        visible={sheetOpen}
        initial={filters}
        ageGroupsPresent={agesPresent}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => {
          setFilters(f)
          setSheetOpen(false)
        }}
      />
    </AdminScreen>
  )
}

/** One occasion. Every line is a real fact about it; nothing is decorative filler. */
function TournamentCard({ tournament, onPress }: { tournament: TournamentListItem; onPress: () => void }) {
  // Hosting is the club's own commitment, Attending is somebody else's occasion, Past is neither.
  const tone = tournament.relationship === "hosting" ? "positive" : "neutral"
  // A public tournament we neither host nor attend is a discovery result: say "Public", because that
  // is the fact that matters -- "Attending" would be untrue of a club that has not entered.
  const label =
    tournament.relationship === "hosting"
      ? "Hosting"
      : tournament.relationship === "past"
        ? "Past"
        : tournament.visibility === "public"
          ? "Public"
          : "Attending"

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tournament.name}, ${label}, ${tournamentDateLine(tournament.startsOn, tournament.endsOn)}${tournament.venueName ? `, ${tournament.venueName}` : ""}, ${teamCountLabel(tournament.teamCount)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {/* THE TOURNAMENT'S OWN PHOTOGRAPH, through the same resolver the detail hero uses -- one
          selection, both surfaces. `cover` crops rather than stretches, so a 16:9 photograph becomes a
          square by taking its middle, which is why the library's imagery is composed centred. */}
      <Image
        source={coverPhotoSource("TOURNAMENT", 
          resolveTournamentCover({ supabase, coverImagePath: tournament.coverImagePath, coverStockKey: tournament.coverStockKey }),
        )}
        style={{ width: 62, height: 62, borderRadius: radius.md }}
        resizeMode="cover"
      />

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
            {tournament.name}
          </Text>
          {/* One pill, restrained. A public tournament this club is not in is simply "Public" -- the
              thing a person needs to know is that they could apply, not a second colour. */}
          <StatusPill label={label} tone={tone} />
        </View>

        <Row icon={<CalendarDays size={13} color={colour.inkSubtle} strokeWidth={1.9} />} text={tournamentDateLine(tournament.startsOn, tournament.endsOn)} />
        {!!tournament.venueName && <Row icon={<MapPin size={13} color={colour.inkSubtle} strokeWidth={1.9} />} text={tournament.venueName} />}

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 1 }}>
          {tournament.ageGroups.length > 0 && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
              {tournament.ageGroups.join(", ")}
            </Text>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Users size={13} color={colour.inkSubtle} strokeWidth={1.9} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>{teamCountLabel(tournament.teamCount)}</Text>
          </View>
        </View>
      </View>

      <ChevronRight size={17} color={colour.inkSubtle} strokeWidth={1.9} />
    </Pressable>
  )
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {icon}
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
        {text}
      </Text>
    </View>
  )
}
