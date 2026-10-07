import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"

import {
  DIETARY_KEYS,
  DIETARY_LABEL,
  EVENT_AUDIENCE_LABEL,
  readEventAudienceCounts,
  readEventMessages,
  saveEvent,
  sendEventMessage,
  type EventAudience,
  type EventCentre,
  type EventMessage,
} from "@ovalball/contracts/events/centre"

import { supabase } from "../auth/supabase"
import { Button, CardSkeleton } from "../components/ui"
import { Bell, Megaphone, UserRound, Users, Utensils } from "../components/icons"
import { friendly, friendlyAction } from "../errors/translate"
import { TOUCH_TARGET, colour, eventTone, radius, space, type } from "../design/tokens"
import { Chip, SectionCard, Stat, ToggleRow } from "./parts"

/**
 * CATERING -- for organisers, live numbers from the answers (never a typed total), split by who they are,
 * and the dietary requirements as counts. For everybody, the menu notes the organiser wrote.
 */
export function CateringSection({ event, onChanged }: { event: EventCentre; onChanged: () => void }) {
  const c = event.summary?.catering ?? null
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(event.catering.notes ?? "")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function saveNotes() {
    setBusy(true)
    setProblem(null)
    try {
      await saveEvent(supabase, event.id, null, { catering_notes: notes.trim() || null })
      setEditing(false)
      onChanged()
    } catch (caught) {
      setProblem(friendlyAction(caught, "save", "the catering notes").message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      <SectionCard>
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
          <Utensils size={22} color={colour.forest800} />
          <View style={{ flex: 1 }}>
            <Text style={[type.heading, { color: colour.ink }]}>Catering Required</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Numbers and dietary requirements come from people's responses.</Text>
          </View>
          <View style={{ paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colour.pitch600 }}>
            <Text style={[type.smallMedium, { color: colour.onForest }]}>Yes</Text>
          </View>
        </View>
      </SectionCard>

      {c && (
        <SectionCard title="Current Numbers">
          <View style={{ flexDirection: "row", gap: space.xs }}>
            <Stat label="Players" value={c.players} icon={<UserRound size={13} color={colour.inkMuted} />} />
            <Stat label="Family & Guests" value={c.familyAndGuests + c.externalGuests} icon={<Users size={13} color={colour.inkMuted} />} />
            <Stat label="Staff" value={c.staff + c.members} icon={<UserRound size={13} color={colour.inkMuted} />} />
            <Stat label="Total" value={c.total} strong />
          </View>
          <Text style={[type.caption, { color: colour.info, padding: space.sm, borderRadius: radius.sm, backgroundColor: colour.infoSurface }]}>
            Numbers update as people respond. Only people marked Attending are counted.
          </Text>
        </SectionCard>
      )}

      {c && (
        <SectionCard title="Dietary Requirements">
          {DIETARY_KEYS.map((k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", minHeight: 36, borderTopWidth: k === "vegetarian" ? 0 : 1, borderTopColor: colour.line }}>
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{DIETARY_LABEL[k]}</Text>
              <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{c.dietary[k] ?? 0}</Text>
            </View>
          ))}
          {c.otherNotes > 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>{c.otherNotes} {c.otherNotes === 1 ? "response has" : "responses have"} a note under Other, shown beside each name in Guests.</Text>}
          <Text style={[type.caption, { color: colour.inkMuted }]}>Totals only. Nobody else invited sees another family's requirements.</Text>
        </SectionCard>
      )}

      <SectionCard title="Catering Notes" onEdit={event.viewer.canManage && !editing ? () => setEditing(true) : undefined} editLabel="Edit catering notes">
        {editing ? (
          <>
            <TextInput
              accessibilityLabel="Catering notes"
              value={notes}
              onChangeText={setNotes}
              maxLength={1000}
              multiline
              placeholder="Buffet style food. Vegetarian and gluten free options available."
              placeholderTextColor={colour.inkSubtle}
              style={[type.body, { minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, textAlignVertical: "top" }]}
            />
            {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
            <Button label="Save Changes" busy={busy} onPress={() => void saveNotes()} />
          </>
        ) : (
          <Text style={[type.small, { color: event.catering.notes ? colour.ink : colour.inkMuted }]}>{event.catering.notes ?? "No menu or notes yet."}</Text>
        )}
      </SectionCard>
    </View>
  )
}

const ANNOUNCE_AUDIENCES: EventAudience[] = ["ALL", "ATTENDING", "UNSURE", "AWAITING", "CANNOT_ATTEND", "WAITLIST"]
const REMIND_AUDIENCES: EventAudience[] = ["AWAITING", "UNSURE", "AWAITING_AND_UNSURE"]

/**
 * MESSAGES -- announcements and reminders, through the one notification pipeline, with the reach shown
 * before sending. There is no all-attendee chat: a whole-club event is hundreds of families, and a group
 * thread that large exposes every family to every other. A guest reads what was sent to them here.
 */
export function MessagesSection({ event, onChanged }: { event: EventCentre; onChanged: () => void }) {
  const [pane, setPane] = useState<"announcements" | "reminders">("announcements")
  const [messages, setMessages] = useState<EventMessage[] | null>(null)
  const [counts, setCounts] = useState<Record<EventAudience, number> | null>(null)
  const [composing, setComposing] = useState(false)
  const [audience, setAudience] = useState<EventAudience>("ALL")
  const [body, setBody] = useState("")
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([readEventMessages(supabase, event.id), event.viewer.canManage ? readEventAudienceCounts(supabase, event.id) : Promise.resolve(null)])
      setMessages(m)
      setCounts(c)
    } catch (caught) {
      setProblem(friendly(caught, "the messages").message)
    }
  }, [event.id, event.viewer.canManage])
  useEffect(() => {
    void load()
  }, [load])

  async function send(kind: "ANNOUNCEMENT" | "REMINDER", to: EventAudience) {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      const r = await sendEventMessage(supabase, event.id, kind, to, kind === "ANNOUNCEMENT" ? body : body.trim() || null, push)
      setDone(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`)
      setBody("")
      setComposing(false)
      await load()
      onChanged()
    } catch (caught) {
      setProblem(friendlyAction(caught, "send", kind === "REMINDER" ? "the reminder" : "the announcement").message)
    } finally {
      setBusy(false)
    }
  }

  const canSend = event.viewer.canManage && !!event.invitationsSentAt && event.phase !== "COMPLETED"
  const shown = (messages ?? []).filter((m) => (pane === "announcements" ? m.kind === "ANNOUNCEMENT" : m.kind === "REMINDER"))

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {/* A confirmation or a refusal belongs to the pane it happened in -- "Sent to 2 people" about an
            announcement is not something to read under Reminders. */}
        <Chip label="Announcements" selected={pane === "announcements"} onPress={() => { setPane("announcements"); setDone(null); setProblem(null) }} />
        <Chip label="Reminders" selected={pane === "reminders"} onPress={() => { setPane("reminders"); setDone(null); setProblem(null) }} />
      </View>

      {event.viewer.canManage && !event.invitationsSentAt && <Text style={[type.small, { color: colour.inkMuted }]}>Send the invitations first; then you can message the people invited.</Text>}

      {canSend && pane === "announcements" && !composing && (
        <Pressable accessibilityRole="button" onPress={() => setComposing(true)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.forest800, opacity: pressed ? 0.85 : 1 })}>
          <Megaphone size={18} color={colour.onForest} />
          <Text style={[type.smallMedium, { color: colour.onForest }]}>Create Announcement</Text>
        </Pressable>
      )}

      {canSend && pane === "announcements" && composing && (
        <SectionCard title="New Announcement">
          <Text style={[type.smallMedium, { color: colour.ink }]}>Send to</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {ANNOUNCE_AUDIENCES.filter((a) => a !== "WAITLIST" || event.capacity.waitingList).map((a) => (
              <Chip key={a} label={EVENT_AUDIENCE_LABEL[a]} count={counts?.[a] ?? null} selected={audience === a} onPress={() => setAudience(a)} />
            ))}
          </View>
          <TextInput
            accessibilityLabel="Announcement"
            value={body}
            onChangeText={setBody}
            maxLength={1000}
            multiline
            placeholder="Parking is on the far side of the clubhouse."
            placeholderTextColor={colour.inkSubtle}
            style={[type.body, { minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, textAlignVertical: "top" }]}
          />
          <ToggleRow title="Send Push Notification" detail="Also alert their phones. Off keeps it in the app." value={push} onChange={setPush} />
          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button
            label={`Send to ${counts?.[audience] ?? 0} ${(counts?.[audience] ?? 0) === 1 ? "Person" : "People"}`}
            busy={busy}
            disabled={!body.trim() || (counts?.[audience] ?? 0) === 0}
            onPress={() => void send("ANNOUNCEMENT", audience)}
          />
          <Button label="Cancel" variant="quiet" onPress={() => setComposing(false)} />
        </SectionCard>
      )}

      {canSend && pane === "reminders" && (
        <SectionCard title="Send a Reminder">
          <Text style={[type.caption, { color: colour.inkMuted }]}>Asks people to answer. The same reminder can go out once every six hours. Automatic reminders also go two days before the reply deadline and the day before the event.</Text>
          {REMIND_AUDIENCES.map((a) => (
            <View key={a} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET }}>
              <Bell size={16} color={colour.forest800} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{EVENT_AUDIENCE_LABEL[a]} · {counts?.[a] ?? 0}</Text>
              <Button label="Remind" variant="secondary" busy={busy} disabled={(counts?.[a] ?? 0) === 0} onPress={() => void send("REMINDER", a)} />
            </View>
          ))}
          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
        </SectionCard>
      )}

      {!!done && <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>{done}</Text>}

      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{pane === "announcements" ? "Previous Announcements" : "Previous Reminders"}</Text>
      {messages === null && <CardSkeleton lines={2} />}
      {messages !== null && shown.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>{pane === "announcements" ? "No announcements yet." : "No reminders sent yet."}</Text>}
      {shown.map((m) => (
        <SectionCard key={m.id}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: eventTone.event.surface, alignItems: "center", justifyContent: "center" }}>
              {m.kind === "REMINDER" ? <Bell size={18} color={eventTone.event.text} /> : <Megaphone size={18} color={eventTone.event.text} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.small, { color: colour.ink }]}>{m.body ?? "Please let the organisers know whether you can come."}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {[relativeAgo(m.sentAt), m.sentBy, m.reach !== null ? `Sent to ${m.reach} ${m.reach === 1 ? "person" : "people"}` : null, m.reach !== null ? m.audience : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
        </SectionCard>
      ))}
    </View>
  )
}

function relativeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`
  const weeks = Math.round(days / 7)
  return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`
}
