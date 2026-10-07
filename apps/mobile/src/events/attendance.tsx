import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"

import {
  DIETARY_KEYS,
  DIETARY_LABEL,
  respondToEvent,
  type DietaryKey,
  type EventAnswer,
  type EventCentre,
  type EventHouseholdMember,
} from "@ovalball/contracts/events/centre"

import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability/vocabulary"
import { attendanceMomentCopy } from "@ovalball/contracts/match-centre/attendance"
import { supabase } from "../auth/supabase"
import { AvailabilityChoice } from "../components/availability-choice"
import { AttendanceMoment } from "../fixtures/match-centre/attendance-moment"
import { PersonAvatar } from "../components/identity"
import { Button } from "../components/ui"
import { Minus, Plus, Users, Utensils } from "../components/icons"
import { friendlyAction } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { AnswerChip } from "./event-card"
import { SectionCard, Stat } from "./parts"

/**
 * ANSWERING -- for each person this viewer answers for: themselves where they are invited in their own
 * right, and each invited child they are a guardian of. Party size and food only where the event allows
 * them, and never more than it allows: the server holds the same rule and refuses anything else.
 */
export function YourResponse({ event, onSaved }: { event: EventCentre; onSaved: () => void }) {
  if (event.mine.length === 0) return null
  return (
    <SectionCard title={event.mine.length > 1 ? "Your Responses" : "Your Response"}>
      {event.mine.map((m, i) => (
        <View key={m.playerId ?? m.userId ?? i} style={{ gap: space.md, paddingTop: i === 0 ? 0 : space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
          <MemberResponse event={event} member={m} onSaved={onSaved} />
        </View>
      ))}
      {!event.rsvp.open && event.phase !== "CANCELLED" && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {event.phase === "COMPLETED" ? "This event has finished." : event.phase === "DRAFT" ? "Responses open when the invitations are sent." : "Responses are closed."}
        </Text>
      )}
    </SectionCard>
  )
}

function MemberResponse({ event, member, onSaved }: { event: EventCentre; member: EventHouseholdMember; onSaved: () => void }) {
  const r = member.response
  const [status, setStatus] = useState<EventAnswer | null>(r?.status ?? null)
  const [guests, setGuests] = useState(r?.guests ?? 0)
  const [catering, setCatering] = useState<number>(r?.catering ?? (r?.guests ?? 0) + 1)
  const [dietary, setDietary] = useState<Partial<Record<DietaryKey, number>>>(r?.dietary ?? {})
  const [note, setNote] = useState(r?.dietaryNote ?? "")
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [moment, setMoment] = useState<{ status: EventAnswer; title: string; body: string } | null>(null)

  const party = guests + 1
  const canAnswer = member.canRespond && event.rsvp.open
  // Every place taken, and this person does not already hold one.
  const full = event.capacity.full && !(r?.status === "ATTENDING" && !r.waitlisted)
  const attending = status === "ATTENDING"
  const dirty =
    status !== (r?.status ?? null) ||
    (attending && (guests !== (r?.guests ?? 0) || (event.catering.required && (catering !== (r?.catering ?? party) || JSON.stringify(dietary) !== JSON.stringify(r?.dietary ?? {}) || note !== (r?.dietaryNote ?? "")))))

  const who = member.kind === "PERSON" || member.isSelf ? "you" : member.firstName ?? "them"

  async function save() {
    if (!status) return
    setSaving(true)
    setProblem(null)
    setDone(null)
    try {
      const result = await respondToEvent(supabase, event.id, member.playerId, {
        status,
        guests: attending ? guests : 0,
        catering: attending && event.catering.required ? Math.min(catering, party) : null,
        dietary: attending && event.catering.required ? dietary : {},
        dietaryNote: attending && event.catering.required ? note : null,
      })
      setDone(result.waitlisted ? "You're on the waiting list. We'll tell you if a place comes up." : "Saved.")
      // THE ATTENDANCE MOMENT, as Match Centre plays it: only once the server has accepted the answer, and only
      // when the answer itself changed -- adjusting a party size is not a new answer. A waiting-list place is
      // not "attending" yet, so it gets the sentence above and no celebration.
      if (status !== (r?.status ?? null) && !result.waitlisted) {
        setMoment({
          status,
          ...attendanceMomentCopy({
            status,
            firstName: who === "you" ? null : member.firstName,
            opponent: null,
            occasion: { name: event.name, date: event.startsOn },
          }),
        })
      }
      onSaved()
    } catch (caught) {
      setProblem(friendlyAction(caught, "save", "your response").message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <PersonAvatar name={member.name} url={null} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyMedium, { color: colour.ink }]}>{member.kind === "PERSON" ? "You" : member.name}</Text>
          {!!member.teamName && <Text style={[type.caption, { color: colour.inkMuted }]}>{member.teamName}</Text>}
        </View>
        {r && <AnswerChip status={r.status} waitlisted={r.waitlisted} />}
      </View>

      {!member.canRespond && <Text style={[type.caption, { color: colour.inkMuted }]}>Answers for {member.firstName ?? "this player"} come from their guardian.</Text>}

      {canAnswer && (
        <>
          {/* THE ONE ANSWER CONTROL -- the same tiles, icons, colours, order and press as Match Centre, the
              Calendar, the Agenda and the Training Centre. Here a tap records the choice and Save Response
              writes it with the party size and food; only a full event changes the first answer's words. */}
          <AvailabilityChoice
            question={who === "you" ? "Can you come?" : `Can ${who} come?`}
            subject={who === "you" ? "you" : who}
            what={event.name}
            committed={status}
            disabled={false}
            onChoose={async (next) => {
              setStatus(next)
              return true
            }}
            ground="light"
            labels={full ? { ATTENDING: event.capacity.waitingList ? "Join Waiting List" : "Full" } : undefined}
            unavailable={full && !event.capacity.waitingList ? ["ATTENDING"] : undefined}
          />

          {attending && event.maxGuests > 0 && (
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Number attending (including {who === "you" ? "you" : who})</Text>
              <Stepper value={party} min={1} max={event.maxGuests + 1} onChange={(n) => {
                // Food follows the party while it was "everyone"; a smaller number someone chose is kept.
                setCatering((c) => (c >= party ? n : Math.min(c, n)))
                setGuests(n - 1)
              }} label="Number attending" />
              <Text style={[type.caption, { color: colour.inkMuted }]}>Up to {event.maxGuests} {event.maxGuests === 1 ? "guest" : "guests"}, such as family members.</Text>
            </View>
          )}

          {attending && event.catering.required && (
            <View style={{ gap: space.sm }}>
              {party > 1 && (
                <View style={{ gap: space.xs }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Food needed for</Text>
                  <Stepper value={Math.min(catering, party)} min={0} max={party} onChange={setCatering} label="Food needed for" />
                </View>
              )}
              <Text style={[type.smallMedium, { color: colour.ink }]}>Dietary requirements (optional)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {DIETARY_KEYS.map((k) => {
                  const n = dietary[k] ?? 0
                  return (
                    <Pressable
                      key={k}
                      accessibilityRole="button"
                      accessibilityLabel={`${DIETARY_LABEL[k]}, ${n}. Tap to add one`}
                      onPress={() => setDietary((d) => ({ ...d, [k]: ((d[k] ?? 0) + 1) % (Math.min(catering, party) + 1) }))}
                      style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: n > 0 ? colour.forest800 : colour.lineStrong, backgroundColor: n > 0 ? colour.mint100 : colour.surface, opacity: pressed ? 0.85 : 1 })}
                    >
                      <Text style={[type.smallMedium, { color: n > 0 ? colour.forest800 : colour.ink }]}>{n > 0 ? `${n} × ` : ""}{DIETARY_LABEL[k]}</Text>
                    </Pressable>
                  )
                })}
              </View>
              {(dietary.other ?? 0) > 0 && (
                <TextInput
                  accessibilityLabel="Other dietary requirement"
                  value={note}
                  onChangeText={setNote}
                  maxLength={300}
                  placeholder="Tell the organisers what is needed"
                  placeholderTextColor={colour.inkSubtle}
                  style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, backgroundColor: colour.surface }]}
                />
              )}
              <Text style={[type.caption, { color: colour.inkMuted }]}>Only the event's organisers see these, and only as numbers for the kitchen.</Text>
            </View>
          )}

          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          {!!done && !dirty && <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>{done}</Text>}
          <Button label="Save Response" busy={saving} disabled={!status || !dirty} onPress={() => void save()} />
        </>
      )}
      {moment && <AttendanceMoment status={moment.status} title={moment.title} body={moment.body} onClose={() => setMoment(null)} />}
    </>
  )
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <View accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`One fewer`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: TOUCH_TARGET / 2, alignItems: "center", justifyContent: "center", backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.lineStrong, opacity: value <= min ? 0.4 : pressed ? 0.7 : 1 })}>
        <Minus size={18} color={colour.ink} />
      </Pressable>
      <Text style={[type.title, { color: colour.ink, minWidth: 36, textAlign: "center", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`One more`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: TOUCH_TARGET / 2, alignItems: "center", justifyContent: "center", backgroundColor: colour.pitch600, opacity: value >= max ? 0.4 : pressed ? 0.7 : 1 })}>
        <Plus size={18} color={colour.onForest} />
      </Pressable>
    </View>
  )
}

/** The organiser's headline numbers -- the server's own counts. */
export function AttendanceSummary({ event }: { event: EventCentre }) {
  const s = event.summary
  if (!s) return null
  return (
    <SectionCard title="Attendance">
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Stat label={ATTENDANCE_STATE_WORDS.ATTENDING} value={s.attending} strong />
        <Stat label={ATTENDANCE_STATE_WORDS.CANNOT_ATTEND} value={s.cannotAttend} />
        <Stat label={ATTENDANCE_STATE_WORDS.UNSURE} value={s.unsure} />
        <Stat label={ATTENDANCE_STATE_WORDS.AWAITING} value={s.awaiting} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.chalk }}>
        <Users size={18} color={colour.forest800} />
        <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
          {s.peopleConfirmed} {s.peopleConfirmed === 1 ? "person" : "people"} confirmed, including guests
          {event.capacity.limit ? ` · ${event.capacity.remaining} of ${event.capacity.limit} places left` : ""}
          {s.waiting > 0 ? ` · ${s.waiting} on the waiting list` : ""}
        </Text>
      </View>
      {event.catering.required && s.catering && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.mint100 }}>
          <Utensils size={18} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800, flex: 1 }]}>Total for catering: {s.catering.total}</Text>
        </View>
      )}
      <Text style={[type.caption, { color: colour.inkMuted }]}>These numbers are only visible to the event's organisers.</Text>
    </SectionCard>
  )
}

