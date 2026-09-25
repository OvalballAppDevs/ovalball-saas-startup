import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { routeForIntent } from "../../../src/links/destinations"
import { GAME_TYPE_OPTIONS, type GameType } from "@ovalball/contracts/fixtures/game-type"
import { clubLogoUrlFromPath, compareAvailability, findGoodDates, readTeamAvailability, shiftDays, shiftMonths, startOfMonth, type CompareDay, type TeamAvailabilityDay } from "@ovalball/contracts"
import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import {
  compatibleOpponents,
  createFixture,
  createFixtureRequest,
  type CompatibleOpponent,
} from "../../../src/agenda/mutations"
import { searchDirectoryClubs, teamRugbyCode, type DirectoryClub } from "../../../src/agenda/opponent-search"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { todayIso } from "../../../src/agenda/load"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AvailabilityAgendaList, AvailabilityMonthGrid } from "../../../src/fixture-requests/availability-calendar"
import { ChoiceField, DateField, Field, SubmitButton, TextField, TimeField } from "../../../src/components/form"
import { ClubCrest } from "../../../src/components/identity"
import { CalendarDays, Check, ChevronRight, ClipboardList, OvalIcon, Users } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { exactDate } from "../../../src/agenda/presentation"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/** How far ahead the shared calendar looks in one read -- bounded (Section 84/83), well inside the
 * server's own 90-day cap, and wide enough to cover several months of month-view navigation from one
 * fetch rather than re-querying on every month flip. */
const AVAILABILITY_WINDOW_DAYS = 84

/**
 * ADDING A FIXTURE -- ONE JOURNEY, TWO ENDINGS.
 *
 * There used to be two buttons, Add Fixture and Request Fixture, and they asked almost identical
 * questions. The owner was right that this is one job: you are arranging a match. What differs is not
 * what you are DOING, it is who you are doing it with -- and the platform already knows which, so the
 * person should not have to.
 *
 * SO THE OPPONENT IS CHOSEN FIRST, FROM THE CLUB DIRECTORY. Every rugby club in the country is in
 * there, whether or not it has ever opened Ovalball, and picking from it rather than typing a name is
 * what makes the next question answerable at all: a club with an identity can be asked, a string cannot.
 *
 *   ON OVALBALL   -> a REQUEST. They confirm, and both clubs end up with the same match. Nothing is in
 *                    either calendar until they do, and the screen says so before the date is picked.
 *   NOT ON OVALBALL -> a fixture, recorded. There is nobody to ask, and pretending to ask would be a
 *                    request into a void.
 *
 * The person sees which they are doing from the moment they choose the club, and the button says it
 * too -- "Send Request" or "Add Fixture" -- so the ending is never a surprise.
 *
 * NOTHING HERE DECIDES ANYTHING. `create_fixture` and the fixture-request inserts re-check authority,
 * `compatible_opponent_teams` decides which of their sides may be played, and the request trigger
 * refuses an incompatible pair whatever this screen offered.
 */
export default function AddFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const params = useLocalSearchParams<{
    teamId?: string
    /** Clubhouse Programme Section 6 -- Find a Fixture's own handoff. Only ids travel through the
     * route; name/town/county/crest are always re-resolved from the directory here, never trusted
     * from a param, exactly like the web composer's own initialOpponent resolution. */
    opponentDirectoryId?: string
    opponentClubId?: string
    targetTeamId?: string
    date?: string
    venuePreference?: "home" | "away" | "either"
  }>()
  const today = todayIso()

  const clubId = active?.clubId ?? null
  /*
    WHICH OF OUR SIDES (CA-M10). In a team context the side is the context. In a club context the person
    chooses one of the club's active sides first -- the Add Fixture flow, the compatibility rule and the
    canonical operation are then exactly the team's, with the side's id rather than the club's.
  */
  const clubContext = active?.kind === "club"
  const paramTeam = String(params.teamId ?? "")
  const [chosenTeam, setChosenTeam] = useState<{ id: string; name: string } | null>(null)
  const [sides, setSides] = useState<{ id: string; name: string }[] | null>(null)
  const teamId = clubContext
    ? (chosenTeam?.id ?? (paramTeam && paramTeam !== (active?.clubId ?? active?.id) ? paramTeam : ""))
    : String(paramTeam || (active?.kind === "team" ? active.id : "") || "")
  const teamName = clubContext ? (chosenTeam?.name ?? sides?.find((t) => t.id === teamId)?.name ?? null) : active?.kind === "team" ? active.label : null

  useEffect(() => {
    if (!clubContext || !clubId) return
    let live = true
    void readClubTeams(supabase, clubId)
      .then((d) => {
        if (live) setSides(d.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.displayName })))
      })
      .catch(() => {
        if (live) setSides([])
      })
    return () => {
      live = false
    }
  }, [clubContext, clubId])

  const [rugbyCode, setRugbyCode] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [clubs, setClubs] = useState<DirectoryClub[] | null>(null)
  const [club, setClub] = useState<DirectoryClub | null>(null)
  const [opponents, setOpponents] = useState<CompatibleOpponent[] | null>(null)
  const [opponent, setOpponent] = useState<CompatibleOpponent | null>(null)
  const asking = Boolean(club?.onOvalball)

  const initialVenuePreference = params.venuePreference === "away" ? "Away" : params.venuePreference === "either" ? "TBD" : params.venuePreference === "home" ? "Home" : null

  const [date, setDate] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today)
  const [time, setTime] = useState<string | null>("10:30")
  const [homeAway, setHomeAway] = useState<"Home" | "Away" | "TBD">(initialVenuePreference ?? "Home")

  // CLUBHOUSE SECTION 6 HANDOFF: re-resolve the opponent from the directory ourselves -- the same
  // trust boundary the web composer's own initialOpponent resolution already uses -- rather than
  // trusting a name/crest/town that travelled through the route. Runs once, when a real
  // opponentDirectoryId param is present and no club has been chosen yet by any other means.
  useEffect(() => {
    if (!params.opponentDirectoryId || club) return
    let live = true
    void supabase
      .from("club_directory")
      .select("id, name, town, county, logo_storage_path, clubs(id, status)")
      .eq("id", params.opponentDirectoryId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return
        const claimed = data.clubs as { id: string; status: string }[] | { id: string; status: string } | null
        const candidates = Array.isArray(claimed) ? claimed : claimed ? [claimed] : []
        const activeClub = candidates.find((c) => c.status === "active") ?? null
        setClub({
          directoryId: data.id,
          name: data.name,
          town: data.town,
          county: data.county,
          crestUrl: clubLogoUrlFromPath(supabase, data.logo_storage_path),
          onOvalball: Boolean(activeClub),
          clubId: activeClub?.id ?? null,
        })
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.opponentDirectoryId])

  // Once the compatible-opponent list for the resolved club has loaded, honour a suggested
  // targetTeamId if it genuinely appears in that canonical list -- never set from the param alone.
  useEffect(() => {
    if (!params.targetTeamId || !opponents || opponent) return
    const match = opponents.find((o) => o.teamId === params.targetTeamId)
    if (match) setOpponent(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.targetTeamId, opponents])
  const [gameType, setGameType] = useState<GameType>("Friendly")
  const [note, setNote] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // THE SHARED SCHEDULING CALENDAR (CA-M11.4) -- our own commitments always load once a team is known;
  // the partner's only once a specific compatible team is chosen (there is nobody to ask about otherwise
  // -- Section 20's own "do not claim availability if partner information is unknown").
  const [calendarView, setCalendarView] = useState<"month" | "list">("list")
  const [monthAnchor, setMonthAnchor] = useState(startOfMonth(today))
  const [ownDays, setOwnDays] = useState<TeamAvailabilityDay[] | null>(null)
  const [partnerDays, setPartnerDays] = useState<TeamAvailabilityDay[] | null>(null)
  const [availabilityProblem, setAvailabilityProblem] = useState<string | null>(null)
  const [loadingAvailability, setLoadingAvailability] = useState(false)
  const windowFrom = today
  const windowTo = shiftDays(today, AVAILABILITY_WINDOW_DAYS)

  useEffect(() => {
    let live = true
    setOwnDays(null)
    if (!asking || !teamId) return
    void readTeamAvailability(supabase, teamId, teamId, windowFrom, windowTo)
      .then((days) => {
        if (live) setOwnDays(days)
      })
      .catch((caught) => {
        if (!live) return
        setAvailabilityProblem(friendly(caught, "your team's calendar").message)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, teamId])

  useEffect(() => {
    let live = true
    setPartnerDays(null)
    if (!asking || !teamId || !opponent?.teamId) return
    setLoadingAvailability(true)
    setAvailabilityProblem(null)
    void readTeamAvailability(supabase, teamId, opponent.teamId, windowFrom, windowTo)
      .then((days) => {
        if (live) setPartnerDays(days)
      })
      .catch((caught) => {
        if (!live) return
        setAvailabilityProblem(friendly(caught, "their availability").message)
      })
      .finally(() => {
        if (live) setLoadingAvailability(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, teamId, opponent?.teamId])

  const compareDays: CompareDay[] = useMemo(() => compareAvailability(ownDays ?? [], partnerDays), [ownDays, partnerDays])
  const compareByDate = useMemo(() => new Map(compareDays.map((d) => [d.date, d])), [compareDays])
  const goodDates = useMemo(() => findGoodDates(compareDays).slice(0, 3), [compareDays])

  useEffect(() => {
    void teamRugbyCode(supabase, teamId).then(setRugbyCode)
  }, [teamId])

  const find = useCallback(
    async (needle: string) => {
      setProblem(null)
      try {
        setClubs(await searchDirectoryClubs(supabase, needle, { rugbyCode, excludeClubId: clubId }))
      } catch (caught) {
        const failure = friendly(caught, "clubs")
        logDetail("directory search", failure)
        setProblem(failure.message)
      }
    },
    [rugbyCode, clubId]
  )

  useEffect(() => {
    const timer = setTimeout(() => void find(search), clubs === null ? 0 : 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, find])

  // WHICH OF THEIR SIDES WE MAY PLAY -- only askable of a club that is on Ovalball, because only it has
  // sides the platform knows about.
  useEffect(() => {
    let live = true
    setOpponents(null)
    setOpponent(null)
    if (!club?.onOvalball || !club.clubId || !teamId) return
    void (async () => {
      try {
        const result = await compatibleOpponents(supabase, teamId, club.clubId!)
        if (live) setOpponents(result)
      } catch (caught) {
        if (!live) return
        const failure = friendly(caught, "compatible teams")
        logDetail("compatible opponents", failure)
        setOpponents([])
        setProblem(failure.message)
      }
    })()
    return () => {
      live = false
    }
  }, [club, teamId])

  async function submit() {
    if (!club || saving || !teamId) return
    setSaving(true)
    setProblem(null)

    const result = asking
      ? await createFixtureRequest(supabase, {
          requestingClubId: clubId ?? "",
          requestingTeamId: teamId,
          targetTeamId: opponent?.teamId ?? null,
          opponentClubId: club.clubId,
          opponentDirectoryId: club.directoryId,
          rawOpponentText: club.name,
          proposedDate: date,
          preferredKickoffTime: time,
          venuePreference: homeAway === "Home" ? "home" : homeAway === "Away" ? "away" : "either",
          note: note.trim() || null,
        })
      : await createFixture(supabase, {
          owningTeamId: teamId,
          homeAway,
          kickoffDate: date,
          kickoffTime: time,
          opponentTeamId: null,
          // A DIRECTORY IDENTITY, not free text -- so the fixture names a real club and the crest and
          // the address come with it.
          opponentDirectoryId: club.directoryId,
          rawOppositionText: club.name,
          status: "Booked",
          gameType,
          venueId: null,
          notes: note.trim() || null,
        })

    setSaving(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    if (!asking && result.id) {
      // The canonical address, through the one table. Whoever just created a fixture
      // holds `fixture.fixture.create`, so the gate lands them on the console.
      const route = routeForIntent({ kind: "FIXTURE", fixtureId: result.id })
      if (route) router.replace(route as never)
    }
    else router.back()
  }

  const ready = Boolean(club && teamId) && (!asking || opponents === null || opponents.length === 0 || Boolean(opponent)) && !saving

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <Header title="Add Fixture" subtitle={teamName} onBack={() => router.back()} insets={insets} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} />}
        {!teamId && !clubContext && <ErrorState message="Switch into the team you are arranging a fixture for, then try again." />}
        {!teamId && clubContext && (
          <Field label="Which Side?" hint="The fixture belongs to one of the club's sides. Choose it first.">
            {sides === null && <CardSkeleton lines={2} />}
            {sides?.length === 0 && <EmptyState title="No sides yet" body="Add a side from the Team Directory first." />}
            {!!sides?.length && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {sides.map((side, index) => (
                  <Pressable key={side.id} accessibilityRole="button" accessibilityLabel={side.name} onPress={() => setChosenTeam(side)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : "transparent" })}>
                    <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{side.name}</Text>
                    <ChevronRight size={16} color={colour.inkSubtle} />
                  </Pressable>
                ))}
              </View>
            )}
          </Field>
        )}

        {!teamId ? null : !club ? (
          <>
            <Field label="Who Are You Playing?" hint="Every club in the rugby directory. Search by name.">
              <TextField label="Search clubs" value={search} onChange={setSearch} placeholder="Search" autoCapitalize="words" />
            </Field>

            {clubs === null && <CardSkeleton lines={1} />}
            {clubs?.length === 0 && (
              <EmptyState
                title="No clubs found"
                body={search.trim() ? `No club matches “${search.trim()}”.` : "Search for the club you are playing."}
                icon={<OvalIcon size={22} color={colour.inkSubtle} />}
              />
            )}
            {!!clubs?.length && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {clubs.map((option, index) => (
                  <Pressable
                    key={option.directoryId}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.name}${option.town ? `, ${option.town}` : ""}. ${option.onOvalball ? "On Ovalball" : "Not on Ovalball"}`}
                    onPress={() => setClub(option)}
                    style={({ pressed }) => ({
                      minHeight: TOUCH_TARGET + 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.md,
                      paddingVertical: space.sm + 2,
                      paddingHorizontal: space.md,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colour.line,
                      backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
                    })}
                  >
                    <ClubCrest clubName={option.name} url={option.crestUrl} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                        {option.name}
                      </Text>
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                        {[option.town, option.county].filter(Boolean).join(", ")}
                      </Text>
                    </View>
                    {/* WHETHER THEY ARE ON OVALBALL, SAID IN THE LIST -- because it decides whether the
                        next step is a request or a record, and somebody should know that before they
                        choose rather than after. */}
                    <Presence on={option.onOvalball} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${club.name}. Choose a different club`}
              onPress={() => setClub(null)}
              style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET }}
            >
              <ClubCrest clubName={club.name} url={club.crestUrl} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                  {club.name}
                </Text>
                <Presence on={club.onOvalball} inline />
              </View>
              <Text style={[type.caption, { color: colour.forest800 }]}>Change</Text>
            </Pressable>

            {/* WHAT IS ABOUT TO HAPPEN, BEFORE IT HAPPENS. The two endings are genuinely different and
                the difference is not this app's choice -- a club on Ovalball has somebody who has to
                agree, and a club that is not has nobody to ask. */}
            <View
              style={{
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: asking ? colour.mint100 : "rgba(16,21,18,0.04)",
                gap: 2,
              }}
            >
              <Text style={[type.smallMedium, { color: asking ? colour.forest800 : colour.ink }]}>
                {asking ? "This will be sent as a request" : "This will be added to your fixtures"}
              </Text>
              <Text style={[type.caption, { color: asking ? colour.forest800 : colour.inkMuted }]}>
                {asking
                  ? `${club.name} confirm, decline or propose a change. Nothing is in either club's calendar until they accept.`
                  : `${club.name} is not on Ovalball, so there is nobody to confirm it. You can change it any time.`}
              </Text>
            </View>

            {asking && (
              <Field
                label="Which Of Their Sides?"
                hint="Only the sides yours may legally play — the age grade, the code and the category all have to match."
              >
                {opponents === null ? (
                  <CardSkeleton lines={1} />
                ) : opponents.length === 0 ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    {club.name} has no side {teamName ?? "this team"} can be matched against yet. You can still send the
                    request and they will decide which side plays.
                  </Text>
                ) : (
                  <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                    {opponents.map((option, index) => {
                      const selected = opponent?.teamId === option.teamId
                      return (
                        <Pressable
                          key={option.teamId}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={option.displayName}
                          onPress={() => setOpponent(option)}
                          style={({ pressed }) => ({
                            minHeight: TOUCH_TARGET + 6,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.md,
                            paddingHorizontal: space.md,
                            borderTopWidth: index === 0 ? 0 : 1,
                            borderTopColor: colour.line,
                            backgroundColor: pressed ? "rgba(16,21,18,0.03)" : selected ? colour.mint100 : "transparent",
                          })}
                        >
                          <Users size={18} color={colour.forest800} strokeWidth={1.9} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                              {option.displayName}
                            </Text>
                            <Text style={[type.caption, { color: colour.inkMuted }]}>
                              {[option.ageGroup, option.gender].filter(Boolean).join(" · ")}
                            </Text>
                          </View>
                          {selected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
                        </Pressable>
                      )
                    })}
                  </View>
                )}
              </Field>
            )}

            {asking ? (
              <Field label="Proposed Date" hint={opponent?.teamId ? undefined : "Choose a compatible side above to compare availability -- until then this shows only our own calendar."}>
                <View style={{ gap: space.sm }}>
                  {!!goodDates.length && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                      {goodDates.map((d) => (
                        <Pressable
                          key={d}
                          accessibilityRole="button"
                          accessibilityLabel={`Good option: ${exactDate(d)}`}
                          onPress={() => setDate(d)}
                          style={({ pressed }) => ({ paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: date === d ? colour.pitch600 : colour.mint100, opacity: pressed ? 0.8 : 1 })}
                        >
                          <Text style={[type.caption, { color: date === d ? colour.chalk : colour.forest800, fontSize: 11, fontFamily: "Inter_600SemiBold" }]}>{exactDate(d).split(" ").slice(0, 2).join(" ")}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <View style={{ flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, overflow: "hidden", alignSelf: "flex-start" }}>
                    <ViewToggle label="List" icon={<ClipboardList size={14} color={calendarView === "list" ? colour.chalk : colour.forest800} />} active={calendarView === "list"} onPress={() => setCalendarView("list")} />
                    <ViewToggle label="Month" icon={<CalendarDays size={14} color={calendarView === "month" ? colour.chalk : colour.forest800} />} active={calendarView === "month"} onPress={() => setCalendarView("month")} />
                  </View>

                  {loadingAvailability && !ownDays && <CardSkeleton lines={3} />}
                  {availabilityProblem && <Text style={[type.small, { color: colour.warning }]}>{availabilityProblem}</Text>}

                  {ownDays && calendarView === "list" && <AvailabilityAgendaList days={compareDays} selected={date} onSelect={setDate} />}
                  {ownDays && calendarView === "month" && (
                    <AvailabilityMonthGrid
                      anchor={monthAnchor}
                      today={today}
                      selected={date}
                      byDate={compareByDate}
                      onSelect={setDate}
                      onShiftMonth={(dir) => setMonthAnchor((a) => shiftMonths(a, dir))}
                    />
                  )}

                  <Text style={[type.small, { color: colour.ink }]}>Selected: {exactDate(date)}</Text>
                </View>
              </Field>
            ) : (
              <Field label="Date">
                <DateField label="Fixture date" value={date} onChange={setDate} />
              </Field>
            )}

            <Field label={asking ? "Preferred Kick-Off" : "Kick-Off"} hint="Leave it clear if the time is not agreed yet.">
              <TimeField label="Kick-off time" value={time} onChange={setTime} />
            </Field>

            <Field label={asking ? "Where Would You Prefer?" : "Home or Away"}>
              <ChoiceField
                label="Home or away"
                value={homeAway}
                onChange={setHomeAway}
                options={[
                  { value: "Home", label: asking ? "Our ground" : "Home" },
                  { value: "Away", label: asking ? "Theirs" : "Away" },
                  { value: "TBD", label: asking ? "Either" : "Not agreed" },
                ]}
              />
            </Field>

            {!asking && (
              <Field label="Type">
                <ChoiceField
                  label="Fixture type"
                  value={gameType}
                  onChange={setGameType}
                  /* THE SAME FOUR WORDS THE WEB OFFERS -- `GAME_TYPE_OPTIONS` is the check constraint
                     on `fixtures.game_type`, not a mobile list. A value outside it cannot be written. */
                  options={GAME_TYPE_OPTIONS.map((value) => ({ value, label: value }))}
                />
              </Field>
            )}

            <Field label={asking ? "Note" : "Notes"} hint={asking ? "Anything they should know. Optional." : "Anything the team needs to know. Optional."}>
              <TextField
                label="Note"
                value={note}
                onChange={setNote}
                multiline
                placeholder={asking ? "Happy to move the time" : "Meet at the clubhouse"}
              />
            </Field>

            <SubmitButton
              label={asking ? "Send Request" : "Add Fixture"}
              onPress={() => void submit()}
              busy={saving}
              disabled={!ready}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}

/** On Ovalball, or not. Restrained: it is a fact about reachability, not a verification badge. */
function ViewToggle({ label, icon, active, onPress }: { label: string; icon: React.ReactNode; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} view`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH_TARGET - 8, paddingHorizontal: space.md, backgroundColor: active ? colour.pitch600 : colour.surface }}
    >
      {icon}
      <Text style={[type.caption, { color: active ? colour.chalk : colour.forest800, fontFamily: "Inter_600SemiBold" }]}>{label}</Text>
    </Pressable>
  )
}

function Presence({ on, inline }: { on: boolean; inline?: boolean }) {
  return (
    <View
      style={{
        alignSelf: inline ? "flex-start" : "auto",
        marginTop: inline ? 2 : 0,
        backgroundColor: on ? colour.mint100 : "rgba(16,21,18,0.05)",
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
      }}
    >
      <Text style={[type.caption, { color: on ? colour.forest800 : colour.inkMuted, fontSize: 10 }]}>
        {on ? "On Ovalball" : "Not on Ovalball"}
      </Text>
    </View>
  )
}

function Header({
  title,
  subtitle,
  onBack,
  insets,
}: {
  title: string
  subtitle?: string | null
  onBack: () => void
  insets: { top: number }
}) {
  return (
    <View
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.md,
        borderBottomWidth: 1,
        borderBottomColor: colour.line,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Fixtures"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  )
}
