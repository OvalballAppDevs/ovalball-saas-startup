import { useCallback, useEffect, useState } from "react"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { readClubVenues, venueAddressLine, type ClubVenue } from "@ovalball/contracts/club/venues"
import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { SWISS_DEFAULT_ROUNDS, TOURNAMENT_FORMAT_LABELS, type TournamentFormat, type TournamentVisibility } from "@ovalball/contracts/club/tournaments"

import { FORMAT_ICON } from "../../../../../src/tournaments/format-icon"

import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { supabase } from "../../../../../src/auth/supabase"
import { CreateTournamentHeader, useTournamentDraft } from "../../../../../src/tournaments/create-context"
import { WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { DateField, Field, TextField, TimeField } from "../../../../../src/components/form"
import { ChoiceCard, FormPickerRow, FormRow, FormSwitchRow, SectionLabel, SwissRoundsField } from "../../../../../src/tournaments/form-primitives"
import { TournamentPhotoControl } from "../../../../../src/tournaments/cover-control"
import { CalendarDays, Check, Clock, Globe, Layers, ListOrdered, Lock, MapPin, Trophy } from "../../../../../src/components/icons"
import { BottomSheet } from "../../../../../src/components/bottom-sheet"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"
import { coverPhotoSource } from "../../../../../src/media/stock-assets"

/**
 * CREATE TOURNAMENT -- STEP 1 OF 4: BASIC DETAILS.
 *
 * What it is, how it is run, when, where, and who may find it. Nothing is written yet: this fills the
 * draft the wizard carries, and the tournament is created once at Review & Create.
 *
 * VISIBILITY IS THE ONE GENUINELY NEW PRODUCT DECISION ON THIS SCREEN, and it defaults to PRIVATE.
 * A tournament that nobody deliberately opened must never be discoverable, so the safe option is the
 * one a person gets by doing nothing. The two options carry their real consequences as copy rather
 * than a help icon, because the difference between them is the difference between an invitation list
 * and an open application process.
 */
/** Today as an ISO date. A date picker handed an empty string builds an Invalid Date and renders
 * blank, which reads as a broken control rather than an unset one. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}


export default function BasicDetailsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setDraft } = useTournamentDraft()
  const [venues, setVenues] = useState<ClubVenue[]>([])
  const [venueSheet, setVenueSheet] = useState(false)

  useEffect(() => {
    if (!clubId) return
    let live = true
    void readClubVenues(supabase, clubId)
      .then((v) => {
        // Only grounds the club can actually use: a deactivated venue is not somewhere to run a
        // tournament, and offering one would be a dead end at Review.
        if (live) setVenues(v.venues.filter((x) => x.active))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [clubId])

  const set = useCallback(<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value })), [setDraft])

  // Real validation: a tournament needs a name, a date and somewhere to be. Nothing else blocks
  // progress -- format, time and visibility all have sensible defaults, and notes are optional.
  const missing: string[] = []
  if (draft.name.trim().length <= 1) missing.push("a name")
  if (!draft.startsOn) missing.push("a start date")
  if (!draft.venueId) missing.push("a venue")
  if (draft.multiDay && !draft.endsOn) missing.push("an end date")
  const valid = missing.length === 0
  const missingHint = valid ? null : `Add ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`} to continue.`

  /** The selected venue's own record, so its canonical cover can be shown in the row. Looked up from
   * the already-loaded list rather than stored in the draft: the draft holds the organiser's choice,
   * not a copy of the venue. */
  const selectedVenue = venues.find((v) => v.id === draft.venueId) ?? null
  const venuePhoto = selectedVenue
    ? coverPhotoSource("VENUE", resolveVenueCover({ supabase, coverImagePath: selectedVenue.coverImagePath, coverStockKey: selectedVenue.coverStockKey }), selectedVenue.id)
    : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <CreateTournamentHeader step={1} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 120, gap: space.lg }}
      >
        {/* TextField carries `label` for accessibility only, like DateField -- the visible label is
            `Field`'s job. */}
        <Field label="Tournament Name">
          <TextField label="Tournament Name" value={draft.name} onChange={(v) => set("name", v)} placeholder="Preston Festival" />
        </Field>

        {/* THE PHOTOGRAPH, right after the name -- both answer "which tournament is this?", and seeing
            the picture early is what stops every tournament ending up with the default one. */}
        <TournamentPhotoControl
          current={{ kind: "none" }}
          pending={draft.cover}
          onChoose={(choice) => set("cover", choice)}
        />

        <View style={{ gap: space.sm }}>
          <SectionLabel>FORMAT</SectionLabel>
          {/* FULL WIDTH, STACKED. Three shapes fitted side by side; five do not, and a squeezed card
              shows "Round Rob…" over "All teams play e…" -- which is exactly the information the
              organiser needs to choose between them. */}
          <View style={{ gap: space.xs }}>
            {(Object.keys(TOURNAMENT_FORMAT_LABELS) as TournamentFormat[]).map((f) => (
              <ChoiceCard
                key={f}
                wide
                icon={(() => { const I = FORMAT_ICON[f]; return <I size={20} color={draft.format === f ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} /> })()}
                title={TOURNAMENT_FORMAT_LABELS[f].label}
                blurb={TOURNAMENT_FORMAT_LABELS[f].blurb}
                selected={draft.format === f}
                // Choosing swiss brings its round count with it; leaving swiss takes it away, because
                // the database forbids a round count on any other shape.
                onPress={() =>
                  setDraft((d) => ({ ...d, format: f, swissRounds: f === "swiss" ? (d.swissRounds ?? SWISS_DEFAULT_ROUNDS) : null }))
                }
              />
            ))}
          </View>
          {draft.format === "swiss" && (
            <SwissRoundsField value={draft.swissRounds ?? SWISS_DEFAULT_ROUNDS} onChange={(n) => set("swissRounds", n)} />
          )}
        </View>

        {/* WHEN -- date, time and the multi-day switch share one row shape, so they read as one
            group of decisions rather than three different kinds of control. */}
        <View style={{ gap: space.xs }}>
          <SectionLabel>WHEN</SectionLabel>
          <FormPickerRow label="Start date">
            <DateField label="Start date" value={draft.startsOn ?? today()} onChange={(iso) => set("startsOn", iso)} />
          </FormPickerRow>
          <FormPickerRow label="Start time">
            {/* Required, so no Clear: the form will not accept an empty start time. */}
            <TimeField label="Start time" clearable={false} value={draft.startTime ?? "09:00"} onChange={(t) => set("startTime", t)} />
          </FormPickerRow>
          <FormSwitchRow
            icon={<CalendarDays size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Runs over more than one day"
            value={draft.multiDay}
            onChange={(v) => setDraft((d) => ({ ...d, multiDay: v, endsOn: v ? (d.endsOn ?? d.startsOn) : null }))}
          />
          {draft.multiDay && (
            <FormPickerRow label="End date">
              <DateField label="End date" value={draft.endsOn ?? draft.startsOn ?? today()} onChange={(iso) => set("endsOn", iso)} />
            </FormPickerRow>
          )}
        </View>

        {/* VENUE -- the canonical Venues & Pitches record, shown the way that system shows it. */}
        <View style={{ gap: space.xs }}>
          <SectionLabel>VENUE</SectionLabel>
          <FormRow
            icon={<MapPin size={19} color={draft.venueId ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
            leading={
              venuePhoto ? <Image source={venuePhoto} style={{ width: 44, height: 44, borderRadius: radius.sm }} resizeMode="cover" /> : undefined
            }
            label="Host venue"
            value={draft.venueName}
            placeholder="Choose a venue"
            secondary={draft.venueAddress}
            onPress={() => setVenueSheet(true)}
          />
        </View>

        {/* VISIBILITY -- two options in the same card language as Format, the consequence of the
            chosen one spelled out underneath so the screen stays scannable. */}
        <View style={{ gap: space.xs }}>
          <SectionLabel>VISIBILITY</SectionLabel>
          <ChoiceCard
            wide
            icon={<Lock size={19} color={draft.visibility === "private" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
            title="Private"
            blurb="Invite only"
            selected={draft.visibility === "private"}
            onPress={() => set("visibility", "private" as TournamentVisibility)}
          />
          <ChoiceCard
            wide
            icon={<Globe size={19} color={draft.visibility === "public" ? colour.forest800 : colour.inkSubtle} strokeWidth={1.9} />}
            title="Public"
            blurb="Open to applications"
            selected={draft.visibility === "public"}
            onPress={() => set("visibility", "public" as TournamentVisibility)}
          />
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 16, paddingHorizontal: space.xs, marginTop: 2 }]}>
            {draft.visibility === "private"
              ? "Only clubs you add can take part. This tournament will not appear in public tournament search."
              : "Ovalball clubs can discover this tournament and apply to enter. You accept or reject each application."}
          </Text>
        </View>

        <Field label="Additional Information (optional)">
          <TextField label="Additional Information" value={draft.notes} onChange={(v) => set("notes", v)} placeholder="Annual festival. Food and drinks available onsite." multiline />
        </Field>
      </ScrollView>

      <WizardFooter
        backLabel="Cancel"
        onBack={() => router.replace("/admin/tournaments" as never)}
        primaryLabel="Next: Select Age Groups"
        onPrimary={() => router.push("/admin/tournaments/new/age-groups" as never)}
        primaryDisabled={!valid}
        primaryHint={missingHint}
      />

      <BottomSheet visible={venueSheet} onClose={() => setVenueSheet(false)} title="Choose a Venue">
        <View style={{ gap: space.xs }}>
          {venues.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>This club has no active venues yet.</Text>}
          {venues.map((v) => {
            const on = draft.venueId === v.id
            return (
              <Pressable
                key={v.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v.name}
                onPress={() => {
                  setDraft((d) => ({ ...d, venueId: v.id, venueName: v.name, venueAddress: venueAddressLine(v) || null }))
                  setVenueSheet(false)
                }}
                style={{
                  minHeight: TOUCH_TARGET + 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  padding: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: on ? colour.forest800 : colour.line,
                  backgroundColor: on ? colour.mint100 : colour.surface,
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
        </View>
      </BottomSheet>
    </View>
  )
}
