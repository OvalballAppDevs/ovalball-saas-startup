import { Pressable, Text, View } from "react-native"

import type { ClubEventItem } from "@ovalball/contracts/agenda/events"
import { answerLabel, eventTypeLabel, type MyEventAnswer } from "@ovalball/contracts/events/centre"
import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"

import { supabase } from "../auth/supabase"
import { dateBlock, exactDate } from "../agenda/presentation"
import { ClubCrest, PersonAvatar } from "../components/identity"
import { CalendarDays, ChevronRight, Clock, MapPin } from "../components/icons"
import { TOUCH_TARGET, colour, eventTone, radius, space, surface, type } from "../design/tokens"
import { useAppContexts } from "../context/contexts"
import { useFamily } from "../family/family"

/**
 * AN EVENT ON THE CALENDAR -- the same card family as a match, a session and a tournament: the accent
 * down the edge, the kind in words, the club, the time and the place, and then each of this person's
 * household with their answer. One tap target: the card opens the Event Centre.
 */
export function EventAgendaCard({ event, answers, onPress }: { event: ClubEventItem; answers: MyEventAnswer[]; onPress: () => void }) {
  // A CHILD IS DRAWN THE WAY THE FAMILY PROJECTION DRAWS THEM -- the same initials, picture and label as
  // on the match and training cards beside this one, never a second derivation from a first name.
  const { projection } = useFamily()
  // The signed-in person's own answer is drawn with their own picture, as the header draws it -- never
  // initials made from the word "You".
  const { person } = useAppContexts()
  const memberOf = (playerId: string | null) => (playerId ? projection.members.find((m) => m.playerId === playerId) : undefined)
  const crest = clubLogoUrlFromPath(supabase, event.clubLogoPath)
  const when = event.startTime ? `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}` : "All day"
  const host = event.hostTeamName ? `${event.hostTeamName} event` : event.isClubWide ? "Club event" : eventTypeLabel(event.eventType)
  const state = event.cancelled ? "Cancelled" : event.postponed ? "Postponed" : null
  const spoken = [`Event: ${event.name}`, event.clubName, when, event.where, state, ...(event.cancelled ? [] : answers).map((a) => `${a.firstName ?? "You"}, ${answerLabel(a.status, a.waitlisted)}`)].filter(Boolean).join(". ")

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the Event Centre"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        marginHorizontal: space.lg,
        borderRadius: radius.lg,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colour.line,
        overflow: "hidden",
        opacity: event.cancelled ? 0.72 : pressed ? 0.95 : 1,
      })}
    >
      <View accessible={false} style={{ width: 4, alignSelf: "stretch", backgroundColor: eventTone.event.accent }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: eventTone.event.accent, backgroundColor: eventTone.event.surface }}>
              <CalendarDays size={11} color={eventTone.event.text} />
              <Text style={[type.caption, { color: eventTone.event.text, fontSize: 10, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" }]}>EVENT</Text>
            </View>
            {!!state && <Text style={[type.caption, { color: colour.danger, fontFamily: "Inter_600SemiBold" }]}>{state}</Text>}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ClubCrest clubName={event.clubName ?? event.name} url={crest} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {!!event.clubName && <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>{event.clubName}</Text>}
              <Text numberOfLines={2} style={[type.bodyMedium, { color: colour.ink, fontSize: 16, textDecorationLine: event.cancelled ? "line-through" : "none" }]}>{event.name}</Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{host}</Text>
            </View>
            <ChevronRight size={16} color={colour.inkSubtle} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
            <Practical icon={<Clock size={13} color={colour.inkMuted} />} text={when} />
            {!!event.where && <Practical icon={<MapPin size={13} color={colour.inkMuted} />} text={event.where} />}
          </View>
        </View>
        {/* A CANCELLED EVENT ASKS NOBODY ANYTHING: "Awaiting" under it would read as a question still open. */}
        {(event.cancelled ? [] : answers).map((a) => {
          const member = memberOf(a.playerId)
          return (
            <View key={`${a.eventId}:${a.playerId ?? "self"}`} accessible={false} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
              {a.isSelf && !a.playerId ? (
                <PersonAvatar name={person.firstName} url={person.avatarUrl} size={30} />
              ) : (
                <PersonAvatar name={member?.fullName ?? a.firstName ?? null} url={member?.avatarUrl ?? null} initials={member?.initials} size={30} />
              )}
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{a.isSelf && !a.playerId ? "You" : (member?.shortLabel ?? a.firstName)}</Text>
              <AnswerChip status={a.status} waitlisted={a.waitlisted} />
            </View>
          )
        })}
      </View>
    </Pressable>
  )
}

/**
 * AN EVENT IN THE FIXTURES AGENDA -- the agenda's own row anatomy, so an event interleaves with the
 * matches around it rather than interrupting them: the date block on the left (the agenda has no day
 * headings, so a row that left it out said "18:30" without saying which day), the host club's crest, the
 * event's name, who it is for, and when and where. It keeps its own identity -- the violet accent and the
 * EVENT mark -- and names each of this household's people with their own answer, never one ambiguous one.
 * The same Event Centre opens from here as from the Calendar's card.
 */
export function EventListRow({ event, answers, onPress }: { event: ClubEventItem; answers: MyEventAnswer[]; onPress: () => void }) {
  const { projection } = useFamily()
  const { person } = useAppContexts()
  const crest = clubLogoUrlFromPath(supabase, event.clubLogoPath)
  const block = dateBlock(event.startsOn)
  const when = event.startTime ? `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}` : "All day"
  const host = event.hostTeamName ? `${event.hostTeamName} event` : event.isClubWide ? "Club event" : eventTypeLabel(event.eventType)
  const state = event.cancelled ? "Cancelled" : event.postponed ? "Postponed" : null
  const people = (event.cancelled ? [] : answers).map((a) => {
    const member = a.playerId ? projection.members.find((m) => m.playerId === a.playerId) : undefined
    const self = a.isSelf && !a.playerId
    return { key: `${a.eventId}:${a.playerId ?? "self"}`, member, self, label: self ? "You" : (member?.shortLabel ?? a.firstName ?? "You"), answer: answerLabel(a.status, a.waitlisted), status: a.status, waitlisted: a.waitlisted }
  })
  const spoken = [
    `Event: ${event.name}`,
    exactDate(event.startsOn),
    when,
    event.where,
    state,
    ...people.map((p) => `${p.label}, ${p.answer}`),
  ].filter(Boolean).join(". ")

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the Event Centre"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        overflow: "hidden",
        opacity: pressed ? 0.94 : event.cancelled ? 0.65 : 1,
      })}
    >
      <View accessible={false} style={{ width: 3, alignSelf: "stretch", backgroundColor: eventTone.event.accent }} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingLeft: space.md - 3, paddingRight: space.md }}>
        <View style={{ width: 34, alignItems: "center", gap: 1 }}>
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.weekday}</Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontSize: 18, lineHeight: 20 }]}>{block.day}</Text>
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.month}</Text>
        </View>

        <ClubCrest clubName={event.clubName ?? event.name} url={crest} size={38} />

        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {people.length > 0 && (
            <View accessible={false} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.sm, rowGap: 2, marginBottom: 2 }}>
              {people.map((p) => (
                <View key={p.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {p.self ? (
                    <PersonAvatar name={person.firstName} url={person.avatarUrl} size={16} />
                  ) : (
                    <PersonAvatar name={p.member?.fullName ?? p.label} url={p.member?.avatarUrl ?? null} initials={p.member?.initials} size={16} />
                  )}
                  <Text style={[type.caption, { color: colour.ink, fontSize: 11 }]}>{p.label}</Text>
                  <Text style={[type.caption, { color: answerInk(p.status, p.waitlisted), fontSize: 11 }]}>{p.answer}</Text>
                </View>
              ))}
            </View>
          )}
          <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink, fontSize: 15, textDecorationLine: event.cancelled ? "line-through" : "none" }]}>
            {event.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{host}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Clock size={11} color={colour.inkSubtle} />
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11, flexShrink: 1 }]}>
              {event.where ? `${when} · ${event.where}` : when}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: eventTone.event.surface }}>
            <CalendarDays size={10} color={eventTone.event.text} />
            <Text style={[type.caption, { color: eventTone.event.text, fontSize: 11 }]}>Event</Text>
          </View>
          {!!state && <Text style={[type.caption, { color: colour.danger, fontSize: 11 }]}>{state}</Text>}
        </View>
      </View>
    </Pressable>
  )
}

/** The ink an answer is written in -- the same four colours the agenda's own attendance words use. */
function answerInk(status: MyEventAnswer["status"], waitlisted?: boolean): string {
  if (waitlisted) return eventTone.event.text
  return status === "ATTENDING" ? colour.forest800 : status === "CANNOT_ATTEND" ? colour.danger : status === "UNSURE" ? colour.warning : colour.inkMuted
}

export function AnswerChip({ status, waitlisted }: { status: MyEventAnswer["status"]; waitlisted?: boolean }) {
  const paint = waitlisted
    ? { ground: eventTone.event.surface, ink: eventTone.event.text }
    : status === "ATTENDING"
      ? { ground: colour.successSurface, ink: colour.forest800 }
      : status === "CANNOT_ATTEND"
        ? { ground: colour.dangerSurface, ink: colour.danger }
        : status === "UNSURE"
          ? { ground: colour.warningSurface, ink: colour.warning }
          : { ground: colour.surface, ink: colour.inkMuted }
  return (
    <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: paint.ground, borderWidth: 1, borderColor: colour.line }}>
      <Text style={[type.caption, { color: paint.ink, fontFamily: "Inter_600SemiBold" }]}>{answerLabel(status, waitlisted)}</Text>
    </View>
  )
}

function Practical({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      {icon}
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flexShrink: 1 }]}>{text}</Text>
    </View>
  )
}
