import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { KitConfig } from "@ovalball/contracts/agenda/kit"
import {
  readClubKits,
  readDirectoryClubTeamsAtGrade,
  searchTournamentClubs,
  type TournamentCandidateTeam,
  type TournamentClubResult,
} from "@ovalball/contracts/club/tournament-teams"

import { supabase } from "../auth/supabase"
import { Check, ChevronLeft, ChevronRight, MapPin, Plus, Search, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"
import { SideIdentityFields } from "./side-identity-fields"
import { ClubCrest, TeamKit } from "./team-row"
import { addTeamsCtaLabel } from "./teams-selection"

/**
 * ADD CLUBS / TEAMS -- a full-height sheet, in two levels.
 *
 * LEVEL ONE PICKS A CLUB, LEVEL TWO PICKS ITS SIDES. Flattening the two -- searching and getting a
 * list of every team in the county -- would ask the organiser to recognise "Under 9 Boys" forty times
 * over with nothing to tell them apart. A person looking for Burnley searches for Burnley.
 *
 * THE SEARCH IS SCOPED BY RUGBY CODE IN THE QUERY. A union club is never shown league clubs, and not
 * as a disabled row either: that would be telling a club about a sport it does not play.
 *
 * ADDING IS NOT INVITING. Choosing another Ovalball club's sides puts them in the tournament. No
 * email, no pending state, nothing for them to accept or decline.
 */
export function AddClubsSheet({
  visible,
  ageGroup,
  rugbyCode,
  hostDirectoryId,
  alreadyIn,
  onClose,
  onAdd,
  onAddClubSide,
  tournamentAgeGroups,
  onAddExternal,
}: {
  visible: boolean
  ageGroup: string
  rugbyCode: string
  hostDirectoryId: string | null
  /** Team ids already in this grade, so a side cannot be added twice. */
  alreadyIn: (club: TournamentClubResult, teams: TournamentCandidateTeam[]) => Set<string>
  onClose: () => void
  onAdd: (club: TournamentClubResult, teams: TournamentCandidateTeam[]) => void
  /** The grades this tournament runs, offered when a side has no canonical team behind it. */
  tournamentAgeGroups: string[]
  /** Adds a canonical directory club that has no team at the chosen grade, keeping its identity. */
  onAddClubSide: (club: TournamentClubResult, ageGroup: string, alias: string | null) => void
  onAddExternal: () => void
}) {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<TournamentClubResult[]>([])
  const [loading, setLoading] = useState(false)
  const [club, setClub] = useState<TournamentClubResult | null>(null)

  useEffect(() => {
    if (!visible) {
      setQuery("")
      setClub(null)
      setResults([])
    }
  }, [visible])

  useEffect(() => {
    if (!visible || club) return
    let live = true
    setLoading(true)
    // A short settle so a four-letter club name is one query rather than four.
    const timer = setTimeout(() => {
      void searchTournamentClubs(supabase, { query, rugbyCode, excludeDirectoryId: hostDirectoryId })
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setLoading(false))
    }, 220)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [visible, query, rugbyCode, hostDirectoryId, club])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* The search field raises the keyboard, and the pinned "Add club manually" row sits at the
          bottom of the sheet -- without this it is the one thing the keyboard covers, which is exactly
          the row a person reaches for when the search has not found their club. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
        <View style={{ height: "88%", backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: "hidden" }}>
          <View style={{ alignItems: "center", paddingTop: space.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
          </View>

          {club ? (
            <ClubTeamsLevel
              club={club}
              ageGroup={ageGroup}
              alreadyIn={alreadyIn}
              onBack={() => setClub(null)}
              onClose={onClose}
              onAdd={(teams) => {
                onAdd(club, teams)
                setClub(null)
                onClose()
              }}
              tournamentAgeGroups={tournamentAgeGroups}
              onAddClubSide={(grade, alias) => {
                onAddClubSide(club, grade, alias)
                setClub(null)
                onClose()
              }}
            />
          ) : (
            <SearchLevel
              ageGroup={ageGroup}
              query={query}
              setQuery={setQuery}
              results={results}
              loading={loading}
              insetBottom={insets.bottom}
              onClose={onClose}
              onPick={setClub}
              onAddExternal={onAddExternal}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function SheetHeader({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md }}>
      {onBack && (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <ChevronLeft size={22} color={colour.ink} strokeWidth={2.2} />
        </Pressable>
      )}
      <Text style={[type.title, { flex: 1, color: colour.ink }]}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
        <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
      </Pressable>
    </View>
  )
}

function SearchLevel({
  ageGroup,
  query,
  setQuery,
  results,
  loading,
  insetBottom,
  onClose,
  onPick,
  onAddExternal,
}: {
  ageGroup: string
  query: string
  setQuery: (v: string) => void
  results: TournamentClubResult[]
  loading: boolean
  insetBottom: number
  onClose: () => void
  onPick: (c: TournamentClubResult) => void
  onAddExternal: () => void
}) {
  return (
    <>
      <SheetHeader title="Add Clubs / Teams" onClose={onClose} />
      <Text style={[type.small, { color: colour.inkMuted, paddingHorizontal: space.lg, paddingTop: 2 }]}>
        Search for an Ovalball club to add their teams to the {ageGroup} competition.
      </Text>

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
          <Search size={17} color={colour.inkSubtle} strokeWidth={1.9} />
          <TextInput
            accessibilityLabel="Search clubs"
            value={query}
            onChangeText={setQuery}
            placeholder="Search clubs"
            placeholderTextColor={colour.inkSubtle}
            autoCorrect={false}
            style={[type.body, { flex: 1, color: colour.ink, paddingVertical: space.sm }]}
          />
          {query.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear Search" onPress={() => setQuery("")} hitSlop={10}>
              <X size={16} color={colour.inkSubtle} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, paddingBottom: insetBottom + space.lg, gap: space.xs }}>
        {loading && results.length === 0 && (
          <View style={{ paddingVertical: space.xl, alignItems: "center" }}>
            <ActivityIndicator color={colour.forest800} />
          </View>
        )}
        {!loading && results.length === 0 && (
          <Text style={[type.small, { color: colour.inkMuted, paddingVertical: space.lg, textAlign: "center" }]}>
            No clubs found. If the club genuinely is not in Ovalball, you can add it manually below.
          </Text>
        )}
        {results.map((c) => (
          <Pressable
            key={c.directoryId}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}${c.location ? `, ${c.location}` : ""}`}
            onPress={() => onPick(c)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 12,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <ClubCrest url={c.crestUrl} name={c.name} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                {c.name}
              </Text>
              {!!c.location && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 }}>
                  <MapPin size={12} color={colour.inkSubtle} strokeWidth={1.9} />
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                    {c.location}
                  </Text>
                </View>
              )}
            </View>
            <ChevronRight size={17} color={colour.inkSubtle} strokeWidth={1.9} />
          </Pressable>
        ))}

      </ScrollView>

      {/* A CLUB THAT IS NOT ON OVALBALL IS STILL A REAL OPPONENT. Recording one takes no email and
          creates no account -- it is a note about who is coming, not an invitation.

          PINNED BENEATH THE LIST, NOT INSIDE IT. Found in the Simulator: as the last row of the
          results it sat below twenty-five clubs, so the way to record a club Ovalball does not have
          was only reachable by scrolling past every club it does. It is a standing escape hatch from
          the search, so it stays put while the search scrolls. */}
      <View style={{ paddingHorizontal: space.lg, paddingBottom: insetBottom + space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Can't find the club? Add club manually"
          onPress={onAddExternal}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET + 12,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.line,
            backgroundColor: colour.chalk,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colour.forest800 }}>
            <Plus size={18} color={colour.onForest} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Can't find the club?</Text>
            <Text style={[type.smallMedium, { color: colour.ink, marginTop: 1 }]}>Add club manually</Text>
          </View>
          <ChevronRight size={17} color={colour.inkSubtle} strokeWidth={1.9} />
        </Pressable>
      </View>
    </>
  )
}

/**
 * LEVEL TWO -- WHICH OF THIS CLUB'S SIDES ARE COMING.
 *
 * ONLY THE SIDES AT THIS GRADE. Burnley's Under 10 team is not offered in the U9 competition, because
 * it cannot play in it. The filter is in the query, not a hidden row.
 */
function ClubTeamsLevel({
  club,
  ageGroup,
  alreadyIn,
  onBack,
  onClose,
  onAdd,
  onAddClubSide,
  tournamentAgeGroups,
}: {
  club: TournamentClubResult
  ageGroup: string
  alreadyIn: (club: TournamentClubResult, teams: TournamentCandidateTeam[]) => Set<string>
  onBack: () => void
  onClose: () => void
  onAdd: (teams: TournamentCandidateTeam[]) => void
  /** The grades THIS tournament runs -- the only competitions a side can be recorded into. */
  tournamentAgeGroups: string[]
  /** Adds the CLUB itself, keeping its canonical directory identity, when it has no team record at the
   * chosen grade. The grade is explicit because the alias must never imply it. */
  onAddClubSide: (ageGroup: string, alias: string | null) => void
}) {
  const insets = useSafeAreaInsets()
  const [teams, setTeams] = useState<TournamentCandidateTeam[] | null>(null)
  const [kit, setKit] = useState<KitConfig | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // The squad field is revealed by the action rather than shown permanently: a label is optional, and
  // an empty box sitting under an empty list reads as another thing that must be filled in.
  const [naming, setNaming] = useState(false)
  const [alias, setAlias] = useState("")
  // Preselected to the competition the sheet was opened from -- the usual answer -- but still an
  // explicit field, because the organiser may be recording a side for a different grade.
  const [sideGrade, setSideGrade] = useState(ageGroup)

  useEffect(() => {
    let live = true
    void readDirectoryClubTeamsAtGrade(supabase, club.directoryId, ageGroup)
      .then((t) => live && setTeams(t))
      .catch(() => live && setTeams([]))
    void supabase
      .from("clubs")
      .select("id")
      .eq("directory_id", club.directoryId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data?.id) return
        void readClubKits(supabase, [data.id]).then((k) => live && setKit(k[data.id] ?? null))
      })
    return () => {
      live = false
    }
  }, [club.directoryId, ageGroup])

  const existing = useMemo(() => alreadyIn(club, teams ?? []), [alreadyIn, club, teams])
  const selectable = useMemo(() => (teams ?? []).filter((t) => !existing.has(t.teamId)), [teams, existing])
  const allPicked = selectable.length > 0 && selectable.every((t) => picked.has(t.teamId))

  const toggle = useCallback((teamId: string) => {
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }, [])

  const count = picked.size
  const hasTeams = (teams?.length ?? 0) > 0
  const loading = teams === null

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <ChevronLeft size={22} color={colour.ink} strokeWidth={2.2} />
        </Pressable>
        <ClubCrest url={club.crestUrl} name={club.name} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
            {club.name}
          </Text>
          {!!club.location && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 }}>
              <MapPin size={12} color={colour.inkSubtle} strokeWidth={1.9} />
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                {club.location}
              </Text>
            </View>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* NOT YET CLAIMED IS A FACT ABOUT THE CLUB, NOT A WARNING. It is shown because it explains why
          there may be no teams here, and it is never called "external": the club is in Ovalball's
          canonical directory, it simply has not signed up. */}
      {!club.onOvalball && (
        <Text style={[type.caption, { color: colour.inkMuted, paddingHorizontal: space.lg, paddingTop: space.xs }]}>
          Not yet claimed on Ovalball
        </Text>
      )}

      {hasTeams && (
        <Text style={[type.small, { color: colour.inkMuted, paddingHorizontal: space.lg, paddingTop: space.sm }]}>
          Select the {ageGroup} teams from {club.name} to add to this tournament.
        </Text>
      )}

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginBottom: space.xs }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{ageGroup} Teams</Text>
            {hasTeams && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Select one or more teams</Text>}
          </View>
          {selectable.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={allPicked ? "Clear Selection" : "Select All"}
              onPress={() => setPicked(allPicked ? new Set() : new Set(selectable.map((t) => t.teamId)))}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.rugby700 }]}>{allPicked ? "Clear" : "Select all"}</Text>
            </Pressable>
          )}
        </View>

        {teams === null && (
          <View style={{ paddingVertical: space.xl, alignItems: "center" }}>
            <ActivityIndicator color={colour.forest800} />
          </View>
        )}
        {/* NO TEAM AT THIS GRADE IS NOT A DEAD END.
            The club is real and in the directory; it simply has not created this side on Ovalball. The
            organiser can still enter it, and the participant keeps the club's canonical directory id --
            so if the club later creates its own U12 team, this side is still recognisably theirs. It is
            NOT re-typed as an unknown club, which would invent a second identity for a club we know. */}
        {teams !== null && !hasTeams && (
          <View style={{ gap: space.sm, paddingTop: space.xs }}>
            <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>
              No {ageGroup} teams are currently registered for {club.name}. You can still add them to this tournament.
            </Text>

            {!naming ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${club.name} ${ageGroup} Team`}
                onPress={() => setNaming(true)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET + 6,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.xs,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: colour.forest800,
                  backgroundColor: colour.successSurface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Plus size={17} color={colour.forest800} strokeWidth={2.4} />
                <Text style={[type.smallMedium, { color: colour.forest800 }]} numberOfLines={1}>
                  Add {club.name} {ageGroup} Team
                </Text>
              </Pressable>
            ) : (
              <SideIdentityFields
                ageGroups={tournamentAgeGroups}
                ageGroup={sideGrade}
                onAgeGroup={setSideGrade}
                alias={alias}
                onAlias={setAlias}
              />
            )}
          </View>
        )}

        {(teams ?? []).map((t) => {
          const already = existing.has(t.teamId)
          const on = picked.has(t.teamId)
          return (
            <Pressable
              key={t.teamId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: already }}
              accessibilityLabel={already ? `${t.name}, already added` : t.name}
              disabled={already}
              onPress={() => toggle(t.teamId)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET + 8,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderWidth: on ? 1.5 : 1,
                borderColor: on ? colour.forest800 : colour.line,
                backgroundColor: on ? colour.successSurface : colour.surface,
                opacity: already ? 0.55 : pressed ? 0.92 : 1,
              })}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: on ? 0 : 1.5,
                  borderColor: colour.lineStrong,
                  backgroundColor: on ? colour.forest800 : "transparent",
                }}
              >
                {on && <Check size={13} color={colour.onForest} strokeWidth={3} />}
              </View>
              <TeamKit kit={kit} clubName={club.name} size={30} />
              <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.ink }]}>
                {t.name}
              </Text>
              {already && <Text style={[type.caption, { color: colour.inkMuted }]}>Added</Text>}
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.sm, borderTopWidth: 1, borderTopColor: colour.line, gap: space.sm }}>
        {/* THE PRIMARY ACTION IS WHATEVER THIS CLUB ACTUALLY OFFERS.
            A club with teams gets "Add 2 Teams". A club with none used to get a full-width disabled
            "Add 0 Teams" over an empty list, which is a button that exists only to be unusable -- so it
            is not rendered at all, and the one real action lives in the empty state instead. Once the
            organiser has opened the name field, the footer confirms it. */}
        {hasTeams ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addTeamsCtaLabel(count)}
            disabled={count === 0}
            onPress={() => onAdd((teams ?? []).filter((t) => picked.has(t.teamId)))}
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              backgroundColor: colour.forest800,
              opacity: count === 0 ? 0.45 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: colour.onForest }]}>{addTeamsCtaLabel(count)}</Text>
          </Pressable>
        ) : naming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Team"
            onPress={() => onAddClubSide(sideGrade, alias.trim() || null)}
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              backgroundColor: colour.forest800,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: colour.onForest }]}>Add Team</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onBack}
          style={({ pressed }) => ({ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={[type.smallMedium, { color: colour.ink }]}>Cancel</Text>
        </Pressable>
      </View>
    </>
  )
}

export const ADD_CLUBS_SHEET_SURFACE = surface
