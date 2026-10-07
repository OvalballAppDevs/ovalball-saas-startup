import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { readClubVenues, venueAddressLine, type ClubVenue } from "@ovalball/contracts/club/venues"
import { SWISS_DEFAULT_ROUNDS, TOURNAMENT_AGE_GROUPS, TOURNAMENT_FORMAT_LABELS, compareAgeGroups, type TournamentFormat } from "@ovalball/contracts/club/tournaments"
import type { TournamentDetail } from "@ovalball/contracts/club/tournament-detail"

import { supabase } from "../auth/supabase"
import { DateField, Field, TextField, TimeField } from "../components/form"
import { FORMAT_ICON } from "./format-icon"
import type { ResultsVisibility } from "@ovalball/contracts/tournaments/results"

import { ChoiceCard, FormPickerRow, FormRow, FormSwitchRow, SectionLabel, SwissRoundsField } from "./form-primitives"
import { CalendarDays, Check, CircleAlert, ClipboardList, Globe, Layers, ListOrdered, Lock, MapPin, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * EDITING A TOURNAMENT THAT ALREADY EXISTS.
 *
 * THE SAME TOURNAMENT, NEVER A SECOND ONE. Every save goes to `save_tournament` WITH the existing id,
 * which updates in place; the create wizard's `create_tournament_with_teams` is not reachable from
 * here at all. The two paths are deliberately different functions so that "edit" cannot become
 * "create" by leaving an argument out.
 *
 * REMOVING AN AGE GROUP IS NEVER SILENT. A grade that goes takes its sides with it -- that is the
 * right behaviour, because a side entered at a grade the tournament no longer runs is invisible and
 * still counted. So before anything is written, `count_tournament_age_group_impact` is asked what the
 * change would cost, and the organiser is told in words: which grades, and how many teams.
 */
export function EditTournamentSheet({
  detail,
  section,
  onClose,
  onSaved,
}: {
  detail: TournamentDetail
  section: null | "details" | "ageGroups"
  onClose: () => void
  onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // --- the editable copy, seeded from the saved tournament every time the sheet opens -------------
  const [name, setName] = useState(detail.name)
  const [startsOn, setStartsOn] = useState(detail.startsOn)
  const [endsOn, setEndsOn] = useState<string | null>(detail.endsOn)
  const [multiDay, setMultiDay] = useState(!!detail.endsOn && detail.endsOn !== detail.startsOn)
  const [startTime, setStartTime] = useState<string | null>(detail.kickoffTime)
  const [format, setFormat] = useState<TournamentFormat>(detail.format)
  const [swissRounds, setSwissRounds] = useState<number | null>(detail.swissRounds)
  const [visibility, setVisibility] = useState(detail.visibility)
  const [resultsVisibility, setResultsVisibility] = useState<ResultsVisibility>(detail.resultsVisibility)
  const [resultsSubmission, setResultsSubmission] = useState(detail.resultsSubmissionEnabled)
  const [venueId, setVenueId] = useState<string | null>(detail.venueId)
  const [grades, setGrades] = useState<string[]>(detail.ageGroups)

  const [venues, setVenues] = useState<ClubVenue[]>([])
  const [venueSheet, setVenueSheet] = useState(false)
  const [impact, setImpact] = useState<{ ageGroup: string; teams: number }[] | null>(null)

  useEffect(() => {
    if (!section) return
    setName(detail.name)
    setStartsOn(detail.startsOn)
    setEndsOn(detail.endsOn)
    setMultiDay(!!detail.endsOn && detail.endsOn !== detail.startsOn)
    setStartTime(detail.kickoffTime)
    setFormat(detail.format)
    setSwissRounds(detail.swissRounds)
    setVisibility(detail.visibility)
    setResultsVisibility(detail.resultsVisibility)
    setResultsSubmission(detail.resultsSubmissionEnabled)
    setVenueId(detail.venueId)
    setGrades(detail.ageGroups)
    setImpact(null)
    setFailure(null)
  }, [section, detail])

  useEffect(() => {
    if (!section || !detail.hostClubId) return
    let live = true
    void readClubVenues(supabase, detail.hostClubId)
      .then((v) => live && setVenues(v.venues.filter((x) => x.active)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [section, detail.hostClubId])

  const selectedVenue = venues.find((v) => v.id === venueId) ?? null

  const problems = useMemo(() => {
    const out: string[] = []
    if (name.trim().length <= 1) out.push("a name")
    if (!startsOn) out.push("a start date")
    if (multiDay && !endsOn) out.push("an end date")
    if (!venueId) out.push("a venue")
    if (section === "ageGroups" && grades.length === 0) out.push("at least one age group")
    return out
  }, [name, startsOn, multiDay, endsOn, venueId, grades.length, section])

  const saveDetails = useCallback(async () => {
    if (!detail.hostClubId) return
    setBusy(true)
    setFailure(null)
    const { error } = await supabase.rpc("save_tournament", {
      p_club_id: detail.hostClubId,
      p_name: name.trim(),
      p_starts_on: startsOn,
      // A one-day tournament ends the day it starts; the server coalesces a null rather than rejecting.
      p_ends_on: multiDay ? endsOn : null,
      p_rugby_code: "union",
      // THE ID IS WHAT MAKES THIS AN EDIT. Without it the same function creates.
      p_tournament_id: detail.id,
      p_venue_id: venueId,
      p_format: format,
      // Carried only by the shape allowed to have it; every other format must send null.
      p_swiss_rounds: format === "swiss" ? (swissRounds ?? SWISS_DEFAULT_ROUNDS) : null,
      p_kickoff_time: startTime,
      p_visibility: visibility,
    } as never)
    if (error) {
      setBusy(false)
      setFailure(error.message)
      return
    }
    // HOW RESULTS ARE RUN IS ITS OWN GOVERNED CALL, not a column on save_tournament -- it re-checks
    // tournament.tournament.manage for itself, and it is deliberately separate from the tournament's
    // own visibility.
    const results = await supabase.rpc("set_tournament_results_settings", {
      p_tournament_id: detail.id,
      p_submission_enabled: resultsSubmission,
      p_results_visibility: resultsVisibility,
    } as never)
    setBusy(false)
    if (results.error) {
      setFailure(results.error.message)
      return
    }
    onSaved()
  }, [detail.hostClubId, detail.id, name, startsOn, multiDay, endsOn, venueId, format, swissRounds, startTime, visibility, resultsSubmission, resultsVisibility, onSaved])

  /** Asks the server what dropping these grades would remove, and shows it. Nothing is written. */
  const checkImpact = useCallback(async () => {
    setBusy(true)
    setFailure(null)
    const { data, error } = await supabase.rpc("count_tournament_age_group_impact", {
      p_tournament_id: detail.id,
      p_age_groups: grades,
    } as never)
    setBusy(false)
    if (error) {
      setFailure(error.message)
      return
    }
    const rows = (data ?? []) as { age_group: string; our_teams: number; other_teams: number }[]
    const affected = rows.map((r) => ({ ageGroup: r.age_group, teams: (r.our_teams ?? 0) + (r.other_teams ?? 0) }))
    if (affected.length === 0) {
      void saveGrades()
      return
    }
    setImpact(affected)
  }, [detail.id, grades])

  const saveGrades = useCallback(async () => {
    setBusy(true)
    setFailure(null)
    const { error } = await supabase.rpc("set_tournament_age_groups", {
      p_tournament_id: detail.id,
      p_age_groups: [...grades].sort(compareAgeGroups),
    } as never)
    setBusy(false)
    if (error) {
      setFailure(error.message)
      return
    }
    onSaved()
  }, [detail.id, grades, onSaved])

  if (!section) return null

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(7,28,20,0.45)" }}>
        <View style={{ maxHeight: "92%", backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + space.sm }}>
          <View style={{ alignItems: "center", paddingTop: space.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md }}>
            <Text style={[type.title, { flex: 1, color: colour.ink }]}>{section === "details" ? "Edit Tournament" : "Edit Age Groups"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            {section === "details" ? (
              <>
                <Field label="Tournament Name">
                  <TextField label="Tournament Name" value={name} onChange={setName} placeholder="Preston Festival" />
                </Field>

                <View style={{ gap: space.sm }}>
                  <SectionLabel>FORMAT</SectionLabel>
                  {/* Stacked full width, exactly as the create wizard shows them -- the same five
                      shapes described the same way, so editing is recognisably the same decision. */}
                  <View style={{ gap: space.xs }}>
                    {(Object.keys(TOURNAMENT_FORMAT_LABELS) as TournamentFormat[]).map((f) => {
                      const Icon = FORMAT_ICON[f]
                      return (
                        <ChoiceCard
                          key={f}
                          wide
                          icon={<Icon size={20} color={format === f ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                          title={TOURNAMENT_FORMAT_LABELS[f].label}
                          blurb={TOURNAMENT_FORMAT_LABELS[f].blurb}
                          selected={format === f}
                          onPress={() => {
                            setFormat(f)
                            setSwissRounds(f === "swiss" ? (swissRounds ?? SWISS_DEFAULT_ROUNDS) : null)
                          }}
                        />
                      )
                    })}
                  </View>
                  {format === "swiss" && (
                    <SwissRoundsField value={swissRounds ?? SWISS_DEFAULT_ROUNDS} onChange={setSwissRounds} />
                  )}
                </View>

                <View style={{ gap: space.xs }}>
                  <SectionLabel>WHEN</SectionLabel>
                  <FormPickerRow label="Start date">
                    <DateField label="Start date" value={startsOn} onChange={setStartsOn} />
                  </FormPickerRow>
                  <FormPickerRow label="Start time">
                    <TimeField label="Start time" clearable={false} value={startTime ?? "09:00"} onChange={setStartTime} />
                  </FormPickerRow>
                  <FormSwitchRow
                    icon={<CalendarDays size={19} color={colour.forest800} strokeWidth={1.9} />}
                    label="Runs over more than one day"
                    value={multiDay}
                    onChange={(v) => {
                      setMultiDay(v)
                      setEndsOn(v ? (endsOn ?? startsOn) : null)
                    }}
                  />
                  {multiDay && (
                    <FormPickerRow label="End date">
                      <DateField label="End date" value={endsOn ?? startsOn} onChange={setEndsOn} />
                    </FormPickerRow>
                  )}
                </View>

                <View style={{ gap: space.xs }}>
                  <SectionLabel>VENUE</SectionLabel>
                  <FormRow
                    icon={<MapPin size={19} color={venueId ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                    label="Host venue"
                    value={selectedVenue?.name ?? null}
                    placeholder="Choose a venue"
                    secondary={selectedVenue ? venueAddressLine(selectedVenue) : null}
                    onPress={() => setVenueSheet(true)}
                  />
                </View>

                <View style={{ gap: space.xs }}>
                  <SectionLabel>VISIBILITY</SectionLabel>
                  <ChoiceCard
                    wide
                    icon={<Lock size={19} color={visibility === "private" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                    title="Private"
                    blurb="Invite only"
                    selected={visibility === "private"}
                    onPress={() => setVisibility("private")}
                  />
                  <ChoiceCard
                    wide
                    icon={<Globe size={19} color={visibility === "public" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                    title="Public"
                    blurb="Open to applications"
                    selected={visibility === "public"}
                    onPress={() => setVisibility("public")}
                  />
                  {visibility === "private" && detail.visibility === "public" && (
                    <Notice tone="warn">
                      Making this tournament private stops clubs finding it and applying. Applications already
                      received are kept.
                    </Notice>
                  )}
                </View>

                {/*
                  WHO SEES THE SCORES. Deliberately a separate decision from the tournament's own
                  visibility: a club may list a festival publicly and still want the results kept
                  inside it, and age-grade rugby has good reasons for that.

                  THE TOURNAMENT'S VISIBILITY IS THE OUTER BOUNDARY. Choosing public results can only
                  permit reading inside what the tournament itself already allows -- it never makes a
                  private tournament discoverable. The server enforces that; the notice below says it.
                */}
                <View style={{ gap: space.xs }}>
                  <SectionLabel>RESULT VISIBILITY</SectionLabel>
                  <ChoiceCard
                    wide
                    icon={<Globe size={19} color={resultsVisibility === "public" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                    title="Public"
                    blurb="Results and tables can be viewed publicly where the tournament itself is publicly discoverable"
                    selected={resultsVisibility === "public"}
                    onPress={() => setResultsVisibility("public")}
                  />
                  <ChoiceCard
                    wide
                    icon={<Lock size={19} color={resultsVisibility === "participants" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
                    title="Participants only"
                    blurb="Results and tables are available to participating clubs, players and guardians with tournament access"
                    selected={resultsVisibility === "participants"}
                    onPress={() => setResultsVisibility("participants")}
                  />
                  {resultsVisibility === "public" && visibility === "private" && (
                    <Notice tone="warn">
                      This tournament is private, so its results stay inside it. Making the tournament
                      public is what opens them up.
                    </Notice>
                  )}
                  <FormSwitchRow
                    icon={<ClipboardList size={18} color={colour.inkSubtle} strokeWidth={1.9} />}
                    label="Teams Submit Their Own Results"
                    hint="Turn this off to record every score yourself."
                    value={resultsSubmission}
                    onChange={setResultsSubmission}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={[type.small, { color: colour.inkMuted }]}>
                  Choose every age group this tournament runs.
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {TOURNAMENT_AGE_GROUPS.map((g) => {
                    const on = grades.includes(g)
                    return (
                      <Pressable
                        key={g}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={g}
                        onPress={() => {
                          setImpact(null)
                          setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g].sort(compareAgeGroups)))
                        }}
                        style={({ pressed }) => ({
                          minWidth: 74,
                          minHeight: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          paddingHorizontal: space.md,
                          borderRadius: radius.md,
                          borderWidth: on ? 1.5 : 1,
                          borderColor: on ? colour.forest800 : colour.line,
                          backgroundColor: on ? colour.successSurface : colour.surface,
                          opacity: pressed ? 0.9 : 1,
                        })}
                      >
                        <Text style={[type.smallMedium, { color: on ? colour.forest800 : colour.ink }]}>{g}</Text>
                      </Pressable>
                    )
                  })}
                </View>

                {/* WHAT THE CHANGE COSTS, NAMED. Shown before anything is written, and the button
                    below only then becomes the one that actually removes. */}
                {impact && (
                  <Notice tone="warn">
                    {impact.map((i) => `${i.ageGroup} (${i.teams === 1 ? "1 team" : `${i.teams} teams`})`).join(", ")}
                    {impact.length === 1 ? " will be removed from this tournament, along with its teams." : " will be removed from this tournament, along with their teams."}
                    {" This cannot be undone."}
                  </Notice>
                )}
              </>
            )}

            {!!failure && <Notice tone="error">{failure}</Notice>}
          </ScrollView>

          <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line, gap: space.sm }}>
            {problems.length > 0 && (
              <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
                Add {problems.length === 1 ? problems[0] : `${problems.slice(0, -1).join(", ")} and ${problems[problems.length - 1]}`} to save.
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={section === "details" ? "Save Changes" : impact ? "Remove and Save" : "Save Changes"}
              disabled={problems.length > 0 || busy}
              onPress={() => (section === "details" ? void saveDetails() : impact ? void saveGrades() : void checkImpact())}
              style={({ pressed }) => ({
                minHeight: 50,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: impact ? colour.danger : colour.forest800,
                opacity: problems.length > 0 || busy ? 0.45 : pressed ? 0.88 : 1,
              })}
            >
              {busy ? <ActivityIndicator color={colour.onForest} /> : <Text style={[type.smallMedium, { color: colour.onForest }]}>{section === "details" ? "Save Changes" : impact ? "Remove and Save" : "Save Changes"}</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={venueSheet} animationType="slide" transparent onRequestClose={() => setVenueSheet(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(7,28,20,0.45)" }}>
          <View style={{ maxHeight: "70%", backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg }}>
              <Text style={[type.title, { flex: 1, color: colour.ink }]}>Choose a Venue</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setVenueSheet(false)} hitSlop={10}>
                <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xs }}>
              {venues.map((v) => {
                const on = venueId === v.id
                return (
                  <Pressable
                    key={v.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={v.name}
                    onPress={() => {
                      setVenueId(v.id)
                      setVenueSheet(false)
                    }}
                    style={{
                      minHeight: TOUCH_TARGET + 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      padding: space.md,
                      borderRadius: radius.md,
                      borderWidth: on ? 1.5 : 1,
                      borderColor: on ? colour.forest800 : colour.line,
                      backgroundColor: on ? colour.successSurface : colour.surface,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{v.name}</Text>
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                        {venueAddressLine(v)}
                      </Text>
                    </View>
                    {on && <Check size={17} color={colour.forest800} strokeWidth={2.2} />}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  )
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const isError = tone === "error"
  return (
    <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: isError ? colour.danger : colour.warning, backgroundColor: isError ? colour.dangerSurface : colour.warningSurface }}>
      <View style={{ paddingTop: 1 }}>
        <CircleAlert size={16} color={isError ? colour.danger : colour.warning} strokeWidth={2} />
      </View>
      <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>{children}</Text>
    </View>
  )
}
