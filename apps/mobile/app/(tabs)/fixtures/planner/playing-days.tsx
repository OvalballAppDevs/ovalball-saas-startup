import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { useLocalSearchParams } from "expo-router"
import {
  PLAYING_DAY_CATEGORY_LABEL,
  playingDayCategory,
  setClubPlayingDays,
  setTeamPlayingDay,
  type IsoWeekday,
  type PlayingDayCategory,
} from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { ChoiceSheet } from "../../../../src/components/field-sheet"
import { ChevronRight } from "../../../../src/components/icons"
import { Button, ErrorState, Skeleton } from "../../../../src/components/ui"
import { ButtonRow, Note } from "../../../../src/people/ui"
import { useOriginBack } from "../../../../src/links/origin"
import { useSeasonPlanner } from "../../../../src/season-planner/state"
import { usePlayingDays } from "../../../../src/season-planner/data"
import { DAY_NAMES, PlannerCard, SectionLabel } from "../../../../src/season-planner/ui"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const KINDS: PlayingDayCategory[] = ["senior_mens", "senior_womens", "colts", "age_grade"]

/**
 * PLAYING DAYS -- when the club's teams usually play, held by Ovalball for the whole club, not on one phone.
 *
 * A club default, a default for each kind of team the club actually has (its teams' own category and gender), and a
 * team's own day where it genuinely differs. A preference: weeks open on it and the calendar marks it, but any date
 * can still be planned. One Save for every change on the screen.
 */
export default function PlayingDaysScreen() {
  const back = useOriginBack("/fixtures/planner")
  const params = useLocalSearchParams<{ seasonId?: string }>()
  const planner = useSeasonPlanner()
  const playing = usePlayingDays(planner.clubId, params.seasonId || null)
  const largeText = useWindowDimensions().fontScale > LARGE_TEXT_SCALE
  const days = playing.days

  const [clubDefault, setClubDefault] = useState<IsoWeekday | null>(null)
  const [kinds, setKinds] = useState<Record<PlayingDayCategory, IsoWeekday | null>>({ senior_mens: null, senior_womens: null, colts: null, age_grade: null })
  const [teamDays, setTeamDays] = useState<Record<string, IsoWeekday | null>>({})
  const [sheet, setSheet] = useState<{ kind: "category"; key: PlayingDayCategory } | { kind: "team"; teamId: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const reset = useMemo(
    () => () => {
      if (!days) return
      setClubDefault(days.clubDefault)
      setKinds({ ...days.categories })
      setTeamDays(Object.fromEntries(days.teams.map((t) => [t.teamId, t.override])))
    },
    [days]
  )
  useEffect(() => {
    reset()
  }, [reset])

  const presentKinds = useMemo(() => KINDS.filter((k) => (days?.teams ?? []).some((t) => playingDayCategory(t.category, t.gender) === k)), [days])
  const dirty =
    !!days &&
    (clubDefault !== days.clubDefault ||
      KINDS.some((k) => kinds[k] !== days.categories[k]) ||
      days.teams.some((t) => (teamDays[t.teamId] ?? null) !== t.override))

  function effective(teamId: string, category: string | null, gender: string | null): { day: IsoWeekday | null; from: string } {
    const own = teamDays[teamId] ?? null
    if (own) return { day: own, from: "Its own day" }
    const k = playingDayCategory(category, gender)
    if (kinds[k] && presentKinds.length > 1) return { day: kinds[k], from: `Same as ${PLAYING_DAY_CATEGORY_LABEL[k]}` }
    if (clubDefault) return { day: clubDefault, from: "Same as club" }
    return { day: null, from: "Not set" }
  }

  /** What "no day of its own" means for the row being changed, in words -- and which day that is. */
  function noneLabel(): string {
    const club = clubDefault ? ` (${DAY_NAMES[clubDefault - 1]})` : ""
    if (sheet?.kind !== "team") return `Same as club${club}`
    const t = days?.teams.find((x) => x.teamId === sheet.teamId)
    const k = t ? playingDayCategory(t.category, t.gender) : null
    if (k && kinds[k] && presentKinds.length > 1) return `Same as ${PLAYING_DAY_CATEGORY_LABEL[k]} (${DAY_NAMES[(kinds[k] as number) - 1]})`
    return `Same as club${club}`
  }

  async function save() {
    if (!days || !planner.clubId || saving) return
    if (!clubDefault) {
      setProblem("Choose the club's usual playing day first.")
      return
    }
    setSaving(true)
    setProblem(null)
    const clubResult = await setClubPlayingDays(supabase, planner.clubId, { clubDefault, ...kinds })
    if (!clubResult.ok) {
      setSaving(false)
      setProblem(clubResult.message)
      return
    }
    for (const t of days.teams) {
      const next = teamDays[t.teamId] ?? null
      if (next === t.override) continue
      const r = await setTeamPlayingDay(supabase, t.teamId, next)
      if (!r.ok) {
        setSaving(false)
        setProblem(`${t.displayName}: ${r.message}`)
        await playing.reload()
        return
      }
    }
    await playing.reload()
    setSaving(false)
    setSaved(true)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Playing Days" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
        <Note>
          <Text style={[type.small, { color: colour.ink }]}>
            When your teams usually play. Weeks open on this day and the calendar marks it, but you can still plan any day.
          </Text>
        </Note>

        {playing.problem && <ErrorState message={playing.problem} onRetry={() => void playing.reload()} />}
        {!days && !playing.problem && <Skeleton height={260} />}

        {days && (
          <>
            <View style={{ gap: space.md }}>
              <SectionLabel title="Club Playing Day" />
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: largeText ? "wrap" : "nowrap", gap: 6 }}>
                {SHORT.map((label, i) => {
                  const day = (i + 1) as IsoWeekday
                  const on = clubDefault === day
                  return (
                    <Pressable
                      key={label}
                      accessibilityRole="radio"
                      accessibilityLabel={DAY_NAMES[i]}
                      accessibilityState={{ checked: on }}
                      onPress={() => {
                        setClubDefault(day)
                        setSaved(false)
                      }}
                      style={({ pressed }) => ({
                        // One row of seven at normal text sizes; they wrap only when text is large.
                        flexGrow: 1,
                        flexBasis: largeText ? 56 : 0,
                        minWidth: 44,
                        minHeight: TOUCH_TARGET,
                        paddingHorizontal: space.xs,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? colour.forest800 : colour.lineStrong,
                        backgroundColor: on ? colour.forest800 : pressed ? colour.mint100 : colour.surface,
                      })}
                    >
                      <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>
                        {label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            {presentKinds.length > 1 && (
              <View style={{ gap: space.md }}>
                <SectionLabel title="By Kind of Team" />
                <PlannerCard padded={false}>
                  {presentKinds.map((k, i) => (
                    <Row
                      key={k}
                      first={i === 0}
                      title={PLAYING_DAY_CATEGORY_LABEL[k]}
                      value={kinds[k] ? DAY_NAMES[(kinds[k] as number) - 1] : clubDefault ? `Same as club — ${DAY_NAMES[clubDefault - 1]}` : "Same as club"}
                      onPress={() => setSheet({ kind: "category", key: k })}
                    />
                  ))}
                </PlannerCard>
              </View>
            )}

            <View style={{ gap: space.md }}>
              <SectionLabel title="Teams" />
              <Text style={[type.small, { color: colour.inkMuted }]}>Give a team its own day only if it genuinely plays on a different day.</Text>
              <PlannerCard padded={false}>
                {days.teams.map((t, i) => {
                  const e = effective(t.teamId, t.category, t.gender)
                  return (
                    <Row
                      key={t.teamId}
                      first={i === 0}
                      title={t.displayName}
                      value={e.day ? DAY_NAMES[e.day - 1] : "Not set"}
                      caption={e.from}
                      emphasise={!!teamDays[t.teamId]}
                      onPress={() => setSheet({ kind: "team", teamId: t.teamId })}
                    />
                  )
                })}
              </PlannerCard>
            </View>
          </>
        )}
        {problem && <ErrorState message={problem} />}
        {saved && !dirty && <Note tone="positive">Playing days saved.</Note>}
      </ScrollView>

      {dirty && (
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
          <ButtonRow weights={[1, 2]}>
            <Button variant="quiet" label="Discard" onPress={reset} disabled={saving} />
            <Button variant="brand" label="Save Playing Days" busy={saving} onPress={() => void save()} />
          </ButtonRow>
        </View>
      )}

      <ChoiceSheet
        visible={sheet !== null}
        title={sheet?.kind === "category" ? PLAYING_DAY_CATEGORY_LABEL[sheet.key] : (days?.teams.find((t) => sheet?.kind === "team" && t.teamId === sheet.teamId)?.displayName ?? "Team")}
        options={DAY_NAMES.map((d, i) => ({ id: String(i + 1), name: d }))}
        noneLabel={noneLabel()}
        value={sheet?.kind === "category" ? (kinds[sheet.key] ? String(kinds[sheet.key]) : null) : sheet?.kind === "team" ? (teamDays[sheet.teamId] ? String(teamDays[sheet.teamId]) : null) : null}
        emptyMessage=""
        onClose={() => setSheet(null)}
        onSave={(id) => {
          const day = id ? (Number(id) as IsoWeekday) : null
          if (sheet?.kind === "category") setKinds((k) => ({ ...k, [sheet.key]: day }))
          else if (sheet?.kind === "team") setTeamDays((t) => ({ ...t, [sheet.teamId]: day }))
          setSaved(false)
          setSheet(null)
        }}
        saving={false}
        problem={null}
      />
    </View>
  )
}

function Row({ title, value, caption, onPress, first, emphasise = false }: { title: string; value: string; caption?: string; onPress: () => void; first: boolean; emphasise?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}${caption ? `, ${caption}` : ""}`}
      accessibilityHint="Changes it"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: TOUCH_TARGET + 12, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[type.bodyMedium, { color: colour.ink }]}>
          {title}
        </Text>
        {!!caption && <Text style={[type.caption, { color: colour.inkMuted }]}>{caption}</Text>}
      </View>
      <Text style={[type.smallMedium, { color: emphasise ? colour.rugby700 : colour.inkMuted }]}>{value}</Text>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}
