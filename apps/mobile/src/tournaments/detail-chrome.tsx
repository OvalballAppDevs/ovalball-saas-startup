import { Image, Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { TournamentDetail } from "@ovalball/contracts/club/tournament-detail"
import { resolveTournamentCover } from "@ovalball/contracts/tournament-cover"
import { formatHasStandings } from "@ovalball/contracts/tournaments/standings"
import { formatHasKnockoutStage } from "@ovalball/contracts/tournaments/knockout"

import { coverPhotoSource } from "../media/stock-assets"

import { supabase } from "../auth/supabase"
import { ChevronLeft, Globe, Lock, MapPin, Trophy } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * ONE HEADER FOR EVERY TAB, AND FOR BOTH AUDIENCES.
 *
 * Overview, Teams, Requests and Planning are four views of one tournament for its ORGANISER;
 * Overview, Teams, Agenda and Attendance are four views of the same tournament for somebody GOING to
 * it. They share one piece of chrome rather than each drawing its own. A header rebuilt per tab is a
 * header that drifts per tab, and one rebuilt per audience is how a participant comes to be looking
 * at a different-looking tournament from the club running it.
 *
 * SO THE TAB SET IS A PARAMETER, and the facts are passed in rather than taken from one caller's
 * shape. The organiser's screen holds a `TournamentDetail`; the participant's holds a
 * `TournamentParticipantCentre`. Both are the same tournament, and both draw this.
 *
 * THE HERO IS THE TOURNAMENT'S OWN COVER, through the canonical resolver the list card also uses. It
 * used to be the VENUE's cover, which read sensibly in isolation -- a tournament happens at a ground,
 * and that ground has a picture of itself -- but it meant every tournament a club ran at its own
 * ground looked identical, and a tournament could say nothing about itself that its venue had not
 * already said. The organiser now chooses.
 */

/** The ORGANISER'S tabs: building and running the day. */
export const TOURNAMENT_TABS = ["Overview", "Teams", "Requests", "Planning", "Results", "Tables", "Draw"] as const
export type TournamentTab = (typeof TOURNAMENT_TABS)[number]

/**
 * THE TABS A PARTICULAR TOURNAMENT ACTUALLY HAS.
 *
 * TABLES is not a universal tab. A Round Robin's whole point is its table; a Knockout has a bracket
 * and no table, and drawing an empty one would invent a structure the organiser did not choose. So the
 * format decides, through the one authority that answers that question.
 */
export function tournamentTabsFor(format: string | null | undefined, keepsStandings?: boolean): readonly TournamentTab[] {
  return TOURNAMENT_TABS.filter(
    (t) =>
      // THE SERVER'S ANSWER WHEN IT HAS ONE (tournament_keeps_standings): a Tri-Fixture keeps a table only
      // when the organiser asks for one. The format is only the fallback for a caller without it.
      (t !== "Tables" || (keepsStandings ?? formatHasStandings(format))) &&
      // A COMPETITION SHOWS ONLY THE SHAPES IT HAS: a league has a table, a cup has a draw, and a tab
      // offering the other is a tab that can only ever be empty. A Hybrid has both -- its group tables,
      // then a knockout stage -- so it shows both.
      (t !== "Draw" || formatHasKnockoutStage(format)),
  )
}

export function participantTournamentTabsFor(
  format: string | null | undefined,
  canRecordResults: boolean,
  keepsStandings?: boolean,
): readonly ParticipantTournamentTab[] {
  return PARTICIPANT_TOURNAMENT_TABS.filter(
    (t) =>
      (t !== "Tables" || (keepsStandings ?? formatHasStandings(format))) &&
      (t !== "Draw" || formatHasKnockoutStage(format)) &&
      // RESULTS IS AN ACTION LIST, offered only to somebody who can act. A parent has the Agenda.
      (t !== "Results" || canRecordResults),
  )
}

/**
 * The PARTICIPANT'S tabs: what is happening, who is coming, and are we going.
 *
 * Agenda is not Planning. Planning is the organiser's tool for building the programme; Agenda is the
 * published result of it, read-only. Requests has no participant equivalent at all -- who has asked to
 * come is the organiser's business.
 */
export const PARTICIPANT_TOURNAMENT_TABS = ["Overview", "Teams", "Agenda", "Attendance", "Results", "Tables", "Draw"] as const
export type ParticipantTournamentTab = (typeof PARTICIPANT_TOURNAMENT_TABS)[number]

export function TournamentDetailHeader({
  detail,
  tab,
  onTab,
}: {
  detail: TournamentDetail
  tab: TournamentTab
  onTab: (t: TournamentTab) => void
}) {
  return (
    <TournamentHeaderChrome
      name={detail.name}
      coverImagePath={detail.coverImagePath}
      coverStockKey={detail.coverStockKey}
      startsOn={detail.startsOn}
      endsOn={detail.endsOn}
      venueName={detail.venueName}
      visibility={detail.visibility}
      backTo="/admin/tournaments"
      tabs={tournamentTabsFor(detail.format, detail.keepsStandings)}
      tab={tab}
      onTab={onTab as (t: string) => void}
    />
  )
}

/**
 * The chrome itself, in terms of the tournament's own facts rather than any one caller's object.
 *
 * `contextLine` is the participant's extra line -- "Tournament . U12" -- which names the COMPETITION
 * being looked at. An organiser is looking at the whole festival and has no single one to name.
 */
export function TournamentHeaderChrome({
  name,
  coverImagePath,
  coverStockKey,
  startsOn,
  endsOn,
  venueName,
  visibility,
  contextLine,
  backTo,
  tabs,
  tab,
  onTab,
}: {
  name: string
  coverImagePath: string | null
  coverStockKey: string | null
  startsOn: string
  endsOn: string | null
  venueName: string | null
  visibility: string
  contextLine?: string | null
  backTo: string
  tabs: readonly string[]
  tab: string
  onTab: (t: string) => void
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const detail = { name, coverImagePath, coverStockKey, startsOn, endsOn, venueName, visibility }

  // THE TOURNAMENT'S OWN PHOTOGRAPH, through the canonical resolver the list card also uses -- so the
  // card a person tapped and the hero they land on are the same picture, by construction.
  //
  // IT USED TO BE THE VENUE'S COVER, which meant three tournaments at one ground were three identical
  // heroes, and a tournament said nothing about itself that its venue had not already said.
  const cover = coverPhotoSource("TOURNAMENT", 
    resolveTournamentCover({ supabase, coverImagePath: detail.coverImagePath, coverStockKey: detail.coverStockKey }),
  )
  const isPublic = detail.visibility === "public"

  return (
    <View style={{ backgroundColor: colour.forest950 }}>
      {/* THE HERO. The forest ground shows through the image's own darkness, so the back control and
          the name stay legible whatever photograph a club has uploaded. */}
      <View style={{ height: insets.top + 168 }}>
        {cover && <Image source={cover} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%" }} resizeMode="cover" />}
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(7,28,20,0.58)" }} />

        <View style={{ flex: 1, paddingTop: insets.top + space.xs, paddingHorizontal: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace(backTo as never))}
            hitSlop={8}
            style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
          </Pressable>

          <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: space.sm, paddingBottom: space.md, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
              <Text numberOfLines={2} style={[type.title, { flex: 1, color: colour.onForest }]}>
                {detail.name}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "rgba(248,250,247,0.16)" }}>
                {isPublic ? <Globe size={11} color={colour.onForest} strokeWidth={2} /> : <Lock size={11} color={colour.onForest} strokeWidth={2} />}
                <Text style={[type.caption, { color: colour.onForest, fontSize: 11 }]}>{isPublic ? "Public" : "Private"}</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={[type.caption, { color: colour.onForestMuted }]}>
              {dateRange(detail.startsOn, detail.endsOn)}
            </Text>
            {!!detail.venueName && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MapPin size={11} color={colour.onForestMuted} strokeWidth={2} />
                <Text numberOfLines={1} style={[type.caption, { flex: 1, color: colour.onForestMuted }]}>
                  {detail.venueName}
                </Text>
              </View>
            )}
            {/* WHICH COMPETITION IS BEING LOOKED AT. Only where there is one: an organiser reading the
                whole field has no single age group to name, and a chip saying nothing is noise. */}
            {!!contextLine && (
              <View style={{ flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 4, marginTop: 2, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "rgba(248,250,247,0.16)" }}>
                <Trophy size={11} color={colour.onForest} strokeWidth={2} />
                <Text style={[type.caption, { color: colour.onForest, fontSize: 11 }]}>{contextLine}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* THE TABS. A dark-green underline on a white band, the treatment the app already uses --
          identical on every tab, so moving between them never moves the bar. */}
      <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.sm }}>
          {tabs.map((t) => {
            const on = t === tab
            return (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t}
                onPress={() => onTab(t)}
                style={({ pressed }) => ({
                  minHeight: 46,
                  paddingHorizontal: space.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottomWidth: 2.5,
                  borderBottomColor: on ? colour.forest800 : "transparent",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={[on ? type.smallMedium : type.small, { color: on ? colour.forest800 : colour.inkMuted }]}>{t}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </View>
  )
}

/**
 * WHICH COMPETITION IS BEING LOOKED AT.
 *
 * A tournament running U12 and U16 is ONE festival and TWO competitions: two fields, two programmes,
 * two tables. Every organiser surface that works on one of them -- Planning, Tables, Results -- has to
 * establish which before anything below it means anything, so they all establish it with the same
 * control rather than each drawing its own row of pills.
 *
 * IT DRAWS NOTHING WHERE THERE IS NOTHING TO CHOOSE. A festival running one age group has one
 * competition, and a control with a single option is furniture.
 */
export function CompetitionChooser({
  ageGroups,
  selected,
  onSelect,
  /** What picking one does, for the screen reader -- "Plan U12", "Show the U12 table". */
  labelFor,
}: {
  ageGroups: readonly string[]
  selected: string | null
  onSelect: (ageGroup: string) => void
  labelFor?: (ageGroup: string) => string
}) {
  if (ageGroups.length <= 1) return null
  return (
    <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
      {ageGroups.map((g) => {
        const on = g === selected
        return (
          <Pressable
            key={g}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={labelFor ? labelFor(g) : g}
            onPress={() => onSelect(g)}
            style={({ pressed }) => ({
              minHeight: 36,
              paddingHorizontal: space.md,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.pill,
              backgroundColor: on ? colour.forest800 : colour.surface,
              borderWidth: 1,
              borderColor: on ? colour.forest800 : colour.line,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{g}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function longDate(iso: string | null): string {
  if (!iso) return "No date"
  const [y, m, d] = iso.split("-").map(Number)
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso
}

/** One day prints once. A range that is really one day reads as a mistake. */
export function dateRange(startsOn: string, endsOn: string | null): string {
  if (!endsOn || endsOn === startsOn) return longDate(startsOn)
  return `${longDate(startsOn)} – ${longDate(endsOn)}`
}

/** Inclusive, so one day is one day. */
export function dayCount(startsOn: string, endsOn: string | null): number {
  const a = Date.parse(`${startsOn}T00:00:00Z`)
  const b = Date.parse(`${endsOn ?? startsOn}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1
  return Math.round((b - a) / 86400000) + 1
}
