import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { clubLogoUrlFromPath } from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { compatibleOpponents, createFixtureRequest, type CompatibleOpponent } from "../../../src/agenda/mutations"
import { todayIso } from "../../../src/agenda/load"
import { friendly, logDetail } from "../../../src/errors/translate"
import { ChoiceField, DateField, Field, SubmitButton, TextField, TimeField } from "../../../src/components/form"
import { ClubCrest } from "../../../src/components/identity"
import { Check, ChevronRight, OvalIcon } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * ASKING ANOTHER CLUB FOR A FIXTURE.
 *
 * NOT THE SAME THING AS ADDING ONE. Add Fixture records a match this club is arranging for itself.
 * This asks a side on Ovalball, they confirm it, and both clubs end up with the same match -- which is
 * the canonical inter-club path and the reason a fixture against an Ovalball team should never be
 * typed in as free text.
 *
 * COMPATIBILITY IS THE DATABASE'S ANSWER AND ONLY THE DATABASE'S.
 *
 * `compatible_opponent_teams` applies `internal.identities_can_play_fixture` to the rugby code, the
 * category, the age grade and the sex of both sides. It is emphatically NOT a name match, and the
 * temptation to write one is strong and wrong: "Under 12 Boys" and "U12 Boys" are the same side to a
 * person and different strings to a computer, an age grade is a school-year rule rather than a
 * substring, and a Rugby League side is not an eligible opponent for a Union one however similar the
 * name looks.
 *
 * IT ALSO CHECKS AUTHORITY BEFORE IT ANSWERS -- the function refuses somebody who may not arrange
 * fixtures for this team rather than listing another club's sides to them. So an empty list here can
 * mean two legitimate things, and the screen says which.
 *
 * AND THE TRIGGER REFUSES AN INCOMPATIBLE PAIR AT INSERT TIME REGARDLESS. Nothing this screen offers
 * can create a match two sides may not play; the picker is a convenience over a rule that is enforced
 * where it matters.
 */
export default function RequestFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const params = useLocalSearchParams<{ teamId?: string }>()
  const today = todayIso()

  const teamId = String(params.teamId ?? (active?.kind === "team" ? active.id : "") ?? "")
  const teamName = active?.kind === "team" ? active.label : null
  const clubId = active?.clubId ?? null

  const [search, setSearch] = useState("")
  const [clubs, setClubs] = useState<OpponentClub[] | null>(null)
  const [club, setClub] = useState<OpponentClub | null>(null)
  const [opponents, setOpponents] = useState<CompatibleOpponent[] | null>(null)
  const [opponent, setOpponent] = useState<CompatibleOpponent | null>(null)

  const [date, setDate] = useState(today)
  const [time, setTime] = useState<string | null>("10:30")
  const [venue, setVenue] = useState<"home" | "away" | "either">("either")
  const [note, setNote] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const findClubs = useCallback(async (needle: string) => {
    setProblem(null)
    try {
      setClubs(await searchOpponentClubs(needle, clubId))
    } catch (caught) {
      const failure = friendly(caught, "clubs")
      logDetail("opponent clubs", failure)
      setProblem(failure.message)
    }
  }, [clubId])

  useEffect(() => {
    const timer = setTimeout(() => void findClubs(search), clubs === null ? 0 : 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, findClubs])

  // WHICH OF THEIR SIDES WE MAY PLAY. Asked the moment a club is chosen, of the canonical function.
  useEffect(() => {
    let live = true
    setOpponents(null)
    setOpponent(null)
    if (!club || !teamId) return
    void (async () => {
      try {
        const result = await compatibleOpponents(supabase, teamId, club.clubId)
        if (live) setOpponents(result)
      } catch (caught) {
        if (!live) return
        // The function raises 42501 for somebody who may not arrange fixtures for this team. That is a
        // different answer from "they have no compatible sides", and conflating them would tell a coach
        // the opposition has no U12s when in fact they themselves were refused.
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
    if (!opponent || !club || !clubId || saving) return
    setSaving(true)
    setProblem(null)
    const result = await createFixtureRequest(supabase, {
      requestingClubId: clubId,
      requestingTeamId: teamId,
      targetTeamId: opponent.teamId,
      opponentClubId: club.clubId,
      opponentDirectoryId: club.directoryId,
      rawOpponentText: club.name,
      proposedDate: date,
      preferredKickoffTime: time,
      venuePreference: venue,
      note: note.trim() || null,
    })
    setSaving(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    router.back()
  }

  const ready = Boolean(opponent && club && clubId && teamId) && !saving

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <Header title="Request Fixture" subtitle={teamName} onBack={() => router.back()} insets={insets} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} />}

        {!club ? (
          <>
            <Field label="Which Club?" hint="Clubs on Ovalball that can receive a fixture request.">
              <TextField label="Search clubs" value={search} onChange={setSearch} placeholder="Search" autoCapitalize="words" />
            </Field>

            {clubs === null && <CardSkeleton lines={1} />}
            {clubs?.length === 0 && (
              <EmptyState
                title="No clubs found"
                body={search.trim() ? `No club on Ovalball matches “${search.trim()}”.` : "Search for the club you want to play."}
                icon={<OvalIcon size={22} color={colour.inkSubtle} />}
              />
            )}
            {!!clubs?.length && (
              <Card>
                {clubs.map((option, index) => (
                  <Row key={option.clubId} first={index === 0} onPress={() => setClub(option)} label={`Choose ${option.name}`}>
                    <ClubCrest clubName={option.name} url={option.crestUrl} size={36} />
                    <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                      {option.name}
                    </Text>
                    <ChevronRight size={17} color={colour.inkSubtle} />
                  </Row>
                ))}
              </Card>
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
              <ClubCrest clubName={club.name} url={club.crestUrl} size={36} />
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                {club.name}
              </Text>
              <Text style={[type.caption, { color: colour.forest800 }]}>Change</Text>
            </Pressable>

            <Field
              label="Which Of Their Sides?"
              hint="Only the sides yours may legally play are listed — the age grade, the code and the category all have to match."
            >
              {opponents === null ? (
                <CardSkeleton lines={1} />
              ) : opponents.length === 0 ? (
                <EmptyState
                  title="No compatible sides"
                  body={`${club.name} has no side ${teamName ?? "this team"} can be matched against. Age grade, rugby code and category all have to agree.`}
                  icon={<OvalIcon size={22} color={colour.inkSubtle} />}
                />
              ) : (
                <Card>
                  {opponents.map((option, index) => {
                    const selected = opponent?.teamId === option.teamId
                    return (
                      <Row
                        key={option.teamId}
                        first={index === 0}
                        onPress={() => setOpponent(option)}
                        label={`Play ${option.displayName}`}
                        selected={selected}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                            {option.displayName}
                          </Text>
                          <Text style={[type.caption, { color: colour.inkMuted }]}>
                            {[option.ageGroup, option.gender].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        {selected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
                      </Row>
                    )
                  })}
                </Card>
              )}
            </Field>

            <Field label="Proposed Date">
              <DateField label="Proposed date" value={date} onChange={setDate} />
            </Field>

            <Field label="Preferred Kick-Off">
              <TimeField label="Preferred kick-off" value={time} onChange={setTime} />
            </Field>

            <Field label="Where">
              <ChoiceField
                label="Venue preference"
                value={venue}
                onChange={setVenue}
                options={[
                  { value: "home", label: "Our ground" },
                  { value: "away", label: "Theirs" },
                  { value: "either", label: "Either" },
                ]}
              />
            </Field>

            <Field label="Note" hint="Anything they should know. Optional.">
              <TextField label="Note" value={note} onChange={setNote} multiline placeholder="Happy to move the time" />
            </Field>

            <SubmitButton label="Send Request" onPress={() => void submit()} busy={saving} disabled={!ready} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              They confirm, decline or propose a change. Nothing is in either club&apos;s calendar until it
              is accepted.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}

interface OpponentClub {
  clubId: string
  directoryId: string | null
  name: string
  crestUrl: string | null
}

/**
 * CLUBS THAT CAN RECEIVE A REQUEST -- which means clubs on Ovalball, not the whole Directory.
 *
 * A Directory entry with no `clubs` row has nobody to answer, so listing it would be offering to send
 * a request into a void. Our own club is excluded: a fixture against yourself is not a fixture.
 */
async function searchOpponentClubs(search: string, myClubId: string | null): Promise<OpponentClub[]> {
  let query = supabase
    .from("clubs")
    .select("id, directory_id, logo_storage_path, club_directory(id, name, logo_storage_path)")
    .eq("status", "active")
    .limit(20)
  if (myClubId) query = query.neq("id", myClubId)

  const { data } = await query
  const rows = (data ?? []).map((row) => ({
    clubId: row.id,
    directoryId: row.directory_id ?? row.club_directory?.id ?? null,
    name: row.club_directory?.name ?? "Club",
    crestUrl: clubLogoUrlFromPath(supabase, row.logo_storage_path ?? row.club_directory?.logo_storage_path ?? null),
  }))
  const needle = search.trim().toLowerCase()
  // Filtered on the name AFTER the read, because the name lives on the joined directory row and
  // PostgREST cannot order a nested ilike into the same bounded query. The set is capped at 20 either
  // way, so this is a narrowing of something already small rather than a client-side search.
  return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {children}
    </View>
  )
}

function Row({
  first,
  onPress,
  label,
  selected,
  children,
}: {
  first?: boolean
  onPress: () => void
  label: string
  selected?: boolean
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 10,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : selected ? colour.mint100 : "transparent",
      })}
    >
      {children}
    </Pressable>
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
