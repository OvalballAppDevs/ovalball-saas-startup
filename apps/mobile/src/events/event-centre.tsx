import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native"
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  cancelEvent,
  eventAddressLine,
  eventHostLine,
  eventTypeLabel,
  postponeEvent,
  readEventCentre,
  type EventCentre as EventCentreModel,
} from "@ovalball/contracts/events/centre"

import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { CancelSheet } from "../components/field-sheet"
import { openDirections } from "../components/match-conditions"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { CalendarDays, Globe, Navigation, Users, Utensils } from "../components/icons"
import { friendly, logDetail, friendlyAction } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { AttendanceSummary, YourResponse } from "./attendance"
import { CateringSection, MessagesSection } from "./catering-and-messages"
import { EventEditor } from "./editor"
import { ManageGuests } from "./guests"
import { DetailRow, EventFacts, EventHero, EventTabs, SectionCard, eventDateLine, eventSections, eventTimeLine, parseEventSection, type EventSection } from "./parts"

/**
 * THE EVENT CENTRE -- one event, one Centre, every viewer.
 *
 * The same hero, sections and cards for an organiser, a parent, a player and a member; the server's
 * projection (`get_event_centre`) decides what is in them and which controls exist. There is no
 * organiser copy of this screen and no attendee copy: an organiser simply receives the guest list,
 * catering numbers and the Edit, Invite and Message controls, and everybody else does not.
 */
export function EventCentreScreen() {
  const { eventId, tab } = useLocalSearchParams<{ eventId: string; tab?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const [event, setEvent] = useState<EventCentreModel | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)
  const [section, setSection] = useState<EventSection>(parseEventSection(tab))
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState<null | "cancel" | "postpone">(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelProblem, setCancelProblem] = useState<string | null>(null)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!eventId) return
    setProblem(null)
    try {
      setEvent(await readEventCentre(supabase, String(eventId)))
    } catch (caught) {
      const failure = friendly(caught, "this event")
      logDetail("event centre", failure)
      setProblem(failure.message)
    }
  }, [eventId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (tab) setSection(parseEventSection(tab))
  }, [tab])
  useEffect(() => {
    if (!event?.viewer.canManage) return
    void supabase
      .from("teams")
      .select("id, display_name")
      .eq("club_id", event.host.clubId)
      .eq("active", true)
      .is("archived_at", null)
      .order("display_name")
      .then(({ data }) => setTeams((data ?? []).map((t) => ({ id: t.id, name: t.display_name }))))
  }, [event?.viewer.canManage, event?.host.clubId])

  const back = () => {
    const s = navigation.getState()
    if (s && s.index > 0) router.back()
    else router.replace("/calendar")
  }

  async function confirmCancel(reason: string) {
    if (!event) return
    setCancelBusy(true)
    setCancelProblem(null)
    try {
      if (cancelling === "postpone") await postponeEvent(supabase, event.id, reason || null)
      else await cancelEvent(supabase, event.id, reason || null)
      setCancelling(null)
      await load()
    } catch (caught) {
      setCancelProblem(friendlyAction(caught, cancelling === "postpone" ? "postpone" : "cancel", "the event").message)
    } finally {
      setCancelBusy(false)
    }
  }

  const tabs = event ? eventSections(event) : []
  const manage = !!event?.viewer.canManage
  const live = event && (event.phase === "SCHEDULED" || event.phase === "POSTPONED" || event.phase === "DRAFT")

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Event Centre" onBack={back} />
      {problem && (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      )}
      {event === undefined && !problem && (
        <View style={{ padding: space.lg, gap: space.md }}>
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {event === null && (
        <View style={{ padding: space.lg }}>
          <EmptyState title="This event is not available" body="It may have been removed, or it is for people you are not one of." />
        </View>
      )}
      {event && (
        <ScrollView
          stickyHeaderIndices={[2]}
          // The Event Centre carries text an organiser types -- an announcement, catering notes, an RSVP note --
          // so the keyboard moves the field into view rather than covering it, as the Match Centre editors do.
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
        >
          <EventHero event={event} />
          <EventFacts event={event} />
          <EventTabs tabs={tabs} section={section} onSelect={setSection} />

          <View style={{ padding: space.lg, gap: space.lg }}>
            {event.phase === "CANCELLED" && (
              <Banner tone="danger" title="This event is cancelled" body={event.cancellationReason ?? "It is not going ahead."} />
            )}
            {event.phase === "POSTPONED" && (
              <Banner tone="warning" title="This event is postponed" body={event.statusNote ?? "A new date will follow. Answers are kept."} />
            )}
            {event.phase === "DRAFT" && manage && (
              <Banner tone="info" title="Draft" body="Only organisers can see this event until the invitations are sent." />
            )}

            {section === "overview" && (
              <>
                {manage ? (
                  <SectionCard title="Event Details" onEdit={live ? () => setEditing(true) : undefined} editLabel="Edit event details">
                    <DetailRow label="Event Type" value={eventTypeLabel(event.eventType)} />
                    <DetailRow label="Hosted By" value={eventHostLine(event)} />
                    <DetailRow label="Date & Time" value={`${eventDateLine(event)}\n${eventTimeLine(event)}`} />
                    <DetailRow label="Location" value={[event.location.kind === "ONLINE" ? "Online" : event.location.venue?.name ?? event.location.external?.name, event.location.detail].filter(Boolean).join(" · ") || "To be confirmed"} />
                    {(event.location.pitches?.length ?? 0) > 0 && <DetailRow label="Pitches" value={event.location.pitches.map((p) => p.name).join(", ")} />}
                    <DetailRow label="Invited" value={audienceLine(event)} />
                    {event.capacity.limit !== null && <DetailRow label="Places" value={`${event.capacity.limit}${event.capacity.waitingList ? ", with a waiting list" : ""}`} />}
                    {event.payment.mode === "PAID_EXTERNALLY" && <DetailRow label="Price" value={event.payment.note ?? "Paid"} />}
                    <DetailRow label="Invitations" value={event.invitationsSentAt ? `Sent ${new Date(event.invitationsSentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Not sent yet"} />
                    {!!event.description && <DetailRow label="Description" value={event.description} />}
                  </SectionCard>
                ) : (
                  <SectionCard title="About This Event">
                    <Text style={[type.body, { color: event.description ? colour.ink : colour.inkMuted }]}>{event.description ?? `${eventTypeLabel(event.eventType)} hosted by ${eventHostLine(event)}.`}</Text>
                    {event.catering.required && (
                      <Callout icon={<Utensils size={20} color={colour.forest800} />} title="Catering Required" body="Please let us know how many people will be attending and any dietary requirements." />
                    )}
                    {event.payment.mode === "PAID_EXTERNALLY" && <Callout icon={<CalendarDays size={20} color={colour.forest800} />} title="Price" body={event.payment.note ?? "This is a paid event."} />}
                  </SectionCard>
                )}

                {event.location.kind !== "ONLINE" && (eventAddressLine(event) || event.location.venue?.directions) && (
                  <SectionCard title="Getting There">
                    {!!eventAddressLine(event) && <Text style={[type.small, { color: colour.ink }]}>{eventAddressLine(event)}</Text>}
                    {!!event.location.venue?.directions && <Text style={[type.small, { color: colour.inkMuted }]}>{event.location.venue.directions}</Text>}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Directions"
                      onPress={() => void openDirections([event.location.venue?.name ?? event.location.external?.name, eventAddressLine(event)].filter(Boolean).join(", "))}
                      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.forest800, opacity: pressed ? 0.7 : 1 })}
                    >
                      <Navigation size={17} color={colour.forest800} />
                      <Text style={[type.smallMedium, { color: colour.forest800 }]}>Directions</Text>
                    </Pressable>
                  </SectionCard>
                )}
                {event.location.kind === "ONLINE" && !!event.location.onlineUrl && (
                  <SectionCard title="Joining Online">
                    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(event.location.onlineUrl!)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.7 : 1 })}>
                      <Globe size={17} color={colour.forest800} />
                      <Text style={[type.smallMedium, { color: colour.forest800, flex: 1 }]} numberOfLines={1}>{event.location.onlineUrl}</Text>
                    </Pressable>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>Shared only with the people invited.</Text>
                  </SectionCard>
                )}

                {!manage && (
                  <SectionCard title="Who's Invited">
                    <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                      <Users size={20} color={colour.forest800} />
                      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{audienceLine(event)}</Text>
                    </View>
                  </SectionCard>
                )}

                {manage && <AttendanceSummary event={event} />}
                {!manage && event.mine.length > 0 && event.rsvp.open && (
                  <Button label="Respond to Event" onPress={() => setSection("guests")} />
                )}
                {manage && live && (
                  <>
                    <Button label="Edit Event" onPress={() => setEditing(true)} />
                    {!event.invitationsSentAt && <Button label="Invite People" variant="secondary" onPress={() => setSection("guests")} />}
                    <Button label="Share Event" variant="quiet" onPress={() => void Share.share({ message: `${event.name}, ${eventDateLine(event)} ${eventTimeLine(event)}. ${eventHostLine(event)}.` })} />
                    {event.phase === "SCHEDULED" && <Button label="Postpone Event" variant="quiet" onPress={() => setCancelling("postpone")} />}
                    <Button label="Cancel Event" variant="danger" onPress={() => setCancelling("cancel")} />
                  </>
                )}
              </>
            )}

            {section === "guests" && (
              <>
                <YourResponse event={event} onSaved={() => void load()} />
                {manage ? <ManageGuests event={event} teams={teams} onChanged={() => void load()} /> : event.mine.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>You can see this event, but nobody you answer for has been invited.</Text>}
              </>
            )}
            {section === "catering" && <CateringSection event={event} onChanged={() => void load()} />}
            {section === "messages" && <MessagesSection event={event} onChanged={() => void load()} />}
          </View>
        </ScrollView>
      )}

      {editing && event && <EventEditor clubId={event.host.clubId} event={event} onClose={() => setEditing(false)} onSaved={() => void load()} />}
      {/* THE SAME CANCELLATION SHEET AS A FIXTURE AND A SESSION: the event named in full to check against,
          and a button that says what it does. */}
      {event && (
        <CancelSheet
          visible={cancelling !== null}
          kind={cancelling === "postpone" ? "event_postpone" : "event"}
          summary={{ teams: event.name, when: `${eventDateLine(event)} · ${eventTimeLine(event)}` }}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => void confirmCancel(reason.trim())}
          saving={cancelBusy}
          problem={cancelProblem}
        />
      )}
    </View>
  )
}

function audienceLine(e: EventCentreModel): string {
  const who = e.isClubWide ? "All club members" : e.teams.map((t) => t.name).join(", ") || null
  const parts = [who, e.invites.individuals > 0 ? `${e.invites.individuals} named ${e.invites.individuals === 1 ? "person" : "people"}` : null].filter(Boolean)
  const kinds = [e.invites.players ? "players and families" : null, e.invites.staff ? "coaches and staff" : null, e.isClubWide && e.invites.members ? "members" : null].filter(Boolean)
  return `${parts.join(" + ") || "Named people"}${kinds.length ? ` (${kinds.join(", ")})` : ""}`
}

function Banner({ tone, title, body }: { tone: "danger" | "warning" | "info"; title: string; body: string }) {
  const paint = tone === "danger" ? { ground: colour.dangerSurface, ink: colour.danger } : tone === "warning" ? { ground: colour.warningSurface, ink: colour.warning } : { ground: colour.infoSurface, ink: colour.info }
  return (
    <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: paint.ground, gap: 2 }}>
      <Text style={[type.smallMedium, { color: paint.ink }]}>{title}</Text>
      <Text style={[type.small, { color: colour.ink }]}>{body}</Text>
    </View>
  )
}

function Callout({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colour.mint100 }}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.ink }]}>{body}</Text>
      </View>
    </View>
  )
}

