import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"

import { supabase } from "../auth/supabase"
import {
  cancelTrainingSession,
  overrideTrainingSession,
  type TrainingResult,
  type TrainingSession,
} from "../agenda/training"
import { loadPitchOptions, loadVenueOptions, type PitchOption, type VenueOption } from "../agenda/fixture-detail"
import { exactDate } from "../agenda/presentation"
import { CancelSheet, ChoiceSheet, DateSheet, TextSheet, TimeSheet } from "../components/field-sheet"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * RUNNING A TRAINING SESSION — the half only a coach has.
 *
 * WHY IT IS ITS OWN COMPONENT, and this is the whole point of the file. Until P4
 * every one of these sheets was in the Training Centre's tree for EVERY viewer.
 * Nothing was drawn, because each row's press target is gated on the server's own
 * `can_manage` and a non-editable row renders no chevron at all -- but the
 * administrative components were mounted, and the two reads that exist only to
 * fill them (`loadVenueOptions`, `loadPitchOptions`) were made for a parent whose
 * screen had nowhere to put the answer.
 *
 * The fixture side learned this at P3: a read a participant never makes cannot
 * leak, and a component a participant never mounts cannot be revealed by a bug in
 * a condition. So the mount itself is now the gate. This is rendered only where
 * `session.canManage` is true -- the value `get_training_session_card` returns from
 * `internal.can_manage_training` -- which means the URL still does not grant the
 * surface, and now it does not even assemble it.
 *
 * NOT A SEPARATE PRODUCT. The Training Centre is ONE surface: the identity, the
 * times, the ground, the plan and the availability are drawn once, for everybody,
 * by the screen. This adds the CONTROLS to that surface rather than replacing it,
 * which is the same rule Match Centre follows -- staff controls integrate into the
 * page rather than becoming a different page.
 *
 * EDITING IS AN OVERRIDE ON THIS OCCURRENCE. Ovalball materialises training from a
 * plan, so moving next Tuesday to a different pitch changes next Tuesday, not every
 * Tuesday for the rest of the season -- which is what editing the plan would do and
 * almost never what anybody means.
 */

/** Which field a coach is editing, or null. Held by the screen so the rows can say so. */
export type TrainingEdit = "date" | "start" | "venue" | "pitch" | "agenda" | "notes" | "cancel" | null

export function TrainingOperations({
  session,
  editing,
  onClose,
  onSaved,
}: {
  session: TrainingSession
  editing: TrainingEdit
  onClose: () => void
  /** Re-read the canonical record. Nothing here keeps a local copy of what it changed. */
  onSaved: () => Promise<void> | void
}) {
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [pitches, setPitches] = useState<PitchOption[]>([])

  /*
    THE GROUNDS AND THE PITCHES, asked for only now.

    These lists exist to populate a choice between them, so they are read when the
    component that offers the choice mounts -- which happens only for somebody the
    server said may make it.
  */
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadVenueOptions(supabase, session.clubId),
      loadPitchOptions(supabase, session.clubId, session.venueId),
    ]).then(([venueOptions, pitchOptions]) => {
      if (cancelled) return
      setVenues(venueOptions)
      setPitches(pitchOptions)
    })
    return () => {
      cancelled = true
    }
  }, [session.clubId, session.venueId])

  const save = useCallback(
    async (action: () => Promise<TrainingResult>) => {
      if (saving) return
      setSaving(true)
      setProblem(null)
      const result = await action()
      if (!result.ok) {
        setSaving(false)
        // THE SERVER'S OWN SENTENCE, inside the sheet that tried. A refusal belongs
        // where the attempt was made, not as a banner somewhere else on the page.
        setProblem(result.message)
        return
      }
      await onSaved()
      setSaving(false)
      onClose()
    },
    [saving, onSaved, onClose]
  )

  const id = session.id

  return (
    <>
      <DateSheet
        visible={editing === "date"}
        value={session.date}
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(date) => void save(() => overrideTrainingSession(supabase, id, { date }))}
      />
      <TimeSheet
        visible={editing === "start"}
        title="Start time"
        value={session.startTime}
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(startTime) => void save(() => overrideTrainingSession(supabase, id, { startTime }))}
      />
      <ChoiceSheet
        visible={editing === "venue"}
        title="Venue"
        hint="Your club's grounds."
        options={venues.map((venue) => ({ id: venue.id, name: venue.name, detail: venue.town }))}
        value={session.venueId}
        emptyMessage="Your club has no grounds recorded in Ovalball yet. They are added in Club Admin on the web."
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(venueId) => void save(() => overrideTrainingSession(supabase, id, { venueId }))}
      />
      <ChoiceSheet
        visible={editing === "pitch"}
        title="Pitch"
        hint="Playing areas at this ground."
        options={pitches.map((pitch) => ({ id: pitch.id, name: pitch.name }))}
        value={session.pitchId}
        emptyMessage={
          session.venueId ? "This ground has no playing areas recorded." : "Choose a ground first — a pitch belongs to one."
        }
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(pitchId) => void save(() => overrideTrainingSession(supabase, id, { pitchId, venueId: session.venueId }))}
      />
      <TextSheet
        visible={editing === "agenda"}
        title="Agenda"
        hint="What the session is working on."
        placeholder="Scrum shape, defensive line speed"
        value={session.agenda ?? ""}
        multiline
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(agenda) => void save(() => overrideTrainingSession(supabase, id, { agenda: agenda.trim() || null }))}
      />
      <TextSheet
        visible={editing === "notes"}
        title="Notes"
        hint="Anything the squad needs to know."
        placeholder="Bring a gumshield"
        value={session.furtherNotes ?? ""}
        multiline
        onClose={onClose}
        saving={saving}
        problem={problem}
        onSave={(notes) => void save(() => overrideTrainingSession(supabase, id, { furtherNotes: notes.trim() || null }))}
      />
      <CancelSheet
        visible={editing === "cancel"}
        summary={{
          teams: session.teamLabel ?? "Training",
          when: `${exactDate(session.date)}${session.startTime ? ` · ${session.startTime}` : ""}`,
        }}
        onClose={onClose}
        saving={saving}
        problem={problem}
        onConfirm={(reason) => void save(() => cancelTrainingSession(supabase, id, reason))}
      />
    </>
  )
}

/**
 * CANCELLING, which is the one that cannot be undone.
 *
 * Its own control rather than a row, because it is not a field. Gated the same way
 * and mounted the same way, so a participant does not render it either.
 */
export function CancelSessionButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cancel this training session"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: space.lg,
        minHeight: TOUCH_TARGET + 6,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        backgroundColor: colour.danger,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Cancel Session</Text>
    </Pressable>
  )
}

/** A spacer so the participant surface and the staff one end the same distance from the bar. */
export function OperationsSpacer() {
  return <View style={{ height: space.sm }} />
}
