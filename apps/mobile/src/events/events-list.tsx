import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { dayLabel } from "@ovalball/contracts"
import { loadClubEvents, type ClubEventItem } from "@ovalball/contracts/agenda/events"
import { readMyEventAnswers, type MyEventAnswer } from "@ovalball/contracts/events/centre"

import { supabase } from "../auth/supabase"
import { Button, CardSkeleton, EmptyState } from "../components/ui"
import { colour, space, type } from "../design/tokens"
import { EventEditor } from "./editor"
import { EventListRow } from "./event-card"

/**
 * THE EVENTS A CLUB OR A TEAM IS RUNNING -- upcoming first, drafts included for the people who may edit
 * them, and Create Event. The same card the calendar draws; the same Event Centre behind each.
 */
export function EventsList({
  clubId,
  teamId,
  canCreate,
  openPath,
}: {
  clubId: string
  teamId?: string | null
  canCreate: boolean
  /** The Event Centre's address INSIDE the stack this list lives in, so Back returns to this list. */
  openPath: "/admin/event/[eventId]" | "/team/event/[eventId]"
}) {
  const router = useRouter()
  const [events, setEvents] = useState<ClubEventItem[] | null>(null)
  const [drafts, setDrafts] = useState<{ id: string; name: string; starts_on: string }[]>([])
  const [answers, setAnswers] = useState<MyEventAnswer[]>([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const end = `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`
    const found = await loadClubEvents(supabase, [clubId], { startIso: today, endIso: end }).catch(() => [] as ClubEventItem[])
    const scoped = teamId ? found.filter((e) => e.hostTeamId === teamId || e.teamIds.includes(teamId)) : found
    setEvents(scoped)
    setAnswers(await readMyEventAnswers(supabase, scoped.map((e) => e.eventId)).catch(() => []))
    const d = await supabase.from("club_events").select("id, name, starts_on, host_team_id").eq("club_id", clubId).eq("status", "DRAFT").order("starts_on")
    setDrafts((d.data ?? []).filter((x) => !teamId || x.host_team_id === teamId))
  }, [clubId, teamId])
  // RE-READ ON RETURN: an organiser who cancels or postpones an event in its Event Centre comes Back to this
  // list, which must say so rather than show the event as it was before they opened it.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const open = (id: string) => router.push({ pathname: openPath, params: { eventId: id } } as never)

  return (
    <View style={{ gap: space.lg }}>
      {canCreate && <Button label="Create Event" onPress={() => setCreating(true)} />}
      {drafts.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Drafts</Text>
          {drafts.map((d) => (
            <Button key={d.id} label={`${d.name} · ${dayLabel(d.starts_on, new Date().toISOString().slice(0, 10))}`} variant="secondary" onPress={() => open(d.id)} />
          ))}
        </View>
      )}
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Upcoming</Text>
      {events === null && <CardSkeleton lines={3} />}
      {events !== null && events.length === 0 && <EmptyState title="No events coming up" body={canCreate ? "Create one, then invite the people it is for." : "Events the club runs will appear here."} />}
      {/* The agenda's own dated row: a list with no day headings must say which day each event is. */}
      <View style={{ gap: space.sm }}>
        {(events ?? []).map((e) => (
          <EventListRow key={e.key} event={e} answers={answers.filter((a) => a.eventId === e.eventId)} onPress={() => open(e.eventId)} />
        ))}
      </View>
      {creating && <EventEditor clubId={clubId} event={null} defaultTeamId={teamId ?? null} onClose={() => setCreating(false)} onSaved={(id) => { void load(); open(id) }} />}
    </View>
  )
}
