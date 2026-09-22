import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { createFixture } from "../../../src/agenda/mutations"
import { todayIso } from "../../../src/agenda/load"
import { friendly, logDetail } from "../../../src/errors/translate"
import { ChoiceField, DateField, Field, SubmitButton, TextField, TimeField } from "../../../src/components/form"
import { ChevronRight } from "../../../src/components/icons"
import { ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * ADDING ONE FIXTURE.
 *
 * ONE. Not a season, not a block, not an import. Those are club-scoped jobs with their own screens on
 * the web, and a phone reproducing them badly would be worse than a phone that does the thing a phone
 * is actually good at: somebody standing on a touchline agreeing a date with another coach.
 *
 * THE FIELDS ARE THE ONES `create_fixture` NEEDS, and the ones a person can answer from the touchline.
 * Competition, pitch allocation and the rest are edits made later at a desk, and the fixture is
 * perfectly valid without them.
 *
 * THE OPPOSITION IS FREE TEXT HERE, DELIBERATELY. Naming a team on Ovalball creates a two-sided fixture
 * that the other club has to agree to -- which is Request Fixture, a different journey with a different
 * answer. This screen records a match this club is arranging for itself; the canonical inter-club path
 * is one tap away and is what the empty state points at.
 *
 * AUTHORITY IS NOT ASKED HERE. `create_fixture` re-checks it, and the screen is only reachable when
 * `my_capabilities` said so. Nothing in this file decides anything.
 */
export default function NewFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const params = useLocalSearchParams<{ teamId?: string }>()
  const today = todayIso()

  // THE TEAM COMES FROM THE CONTEXT SOMEBODY IS STANDING IN. A picker here would be a second way to
  // choose a team, and a way to choose one they are not acting for.
  const teamId = String(params.teamId ?? (active?.kind === "team" ? active.id : "") ?? "")
  const teamName = active?.kind === "team" ? active.label : null

  const [date, setDate] = useState(today)
  const [time, setTime] = useState<string | null>("10:30")
  const [homeAway, setHomeAway] = useState<"Home" | "Away" | "TBD">("Home")
  const [opposition, setOpposition] = useState("")
  const [status, setStatus] = useState<"Planned" | "Booked">("Booked")
  const [gameType, setGameType] = useState<"Friendly" | "League Fixture" | "Cup Fixture">("Friendly")
  const [notes, setNotes] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ready = teamId.length > 0 && opposition.trim().length > 0 && !saving

  async function submit() {
    if (!ready) return
    setSaving(true)
    setProblem(null)
    const result = await createFixture(supabase, {
      owningTeamId: teamId,
      homeAway,
      kickoffDate: date,
      kickoffTime: time,
      opponentTeamId: null,
      opponentDirectoryId: null,
      rawOppositionText: opposition.trim(),
      status,
      gameType,
      venueId: null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    // Straight to the fixture that now exists, rather than back to a list where somebody has to find it.
    if (result.id) router.replace(`/fixtures/${result.id}` as never)
    else router.back()
  }

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

        {!teamId && (
          <ErrorState message="Switch into the team you are adding a fixture for, then try again." />
        )}

        <Field label="Who Are You Playing?" hint="The name the fixture will be listed under.">
          <TextField
            label="Opposition"
            value={opposition}
            onChange={setOpposition}
            placeholder="Rossendale RUFC"
            autoCapitalize="words"
          />
        </Field>

        <Field label="Date">
          <DateField label="Fixture date" value={date} onChange={setDate} />
        </Field>

        <Field label="Kick-Off" hint="Leave it clear if the time is not agreed yet.">
          <TimeField label="Kick-off time" value={time} onChange={setTime} />
        </Field>

        <Field label="Home or Away">
          <ChoiceField
            label="Home or away"
            value={homeAway}
            onChange={setHomeAway}
            options={[
              { value: "Home", label: "Home" },
              { value: "Away", label: "Away" },
              { value: "TBD", label: "Not agreed" },
            ]}
          />
        </Field>

        <Field label="Status" hint="Booked means it is agreed. Planned means it is still being arranged.">
          <ChoiceField
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "Booked", label: "Booked" },
              { value: "Planned", label: "Planned" },
            ]}
          />
        </Field>

        <Field label="Type">
          <ChoiceField
            label="Fixture type"
            value={gameType}
            onChange={setGameType}
            options={[
              { value: "Friendly", label: "Friendly" },
              { value: "League Fixture", label: "League" },
              { value: "Cup Fixture", label: "Cup" },
            ]}
          />
        </Field>

        <Field label="Notes" hint="Anything the team needs to know. Optional.">
          <TextField label="Notes" value={notes} onChange={setNotes} multiline placeholder="Meet at the clubhouse" />
        </Field>

        <SubmitButton label="Add Fixture" onPress={() => void submit()} busy={saving} disabled={!ready} />

        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Playing another club on Ovalball? Use Request Fixture instead — they confirm it, and both sides
          get the same match.
        </Text>
      </ScrollView>
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
