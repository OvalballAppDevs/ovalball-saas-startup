import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { ATTENDANCE_STATE_WORDS } from "../availability/vocabulary"
import { eventDefaultStockKey } from "../media/stock-library"

type Client = SupabaseClient<Database>

/**
 * THE EVENT CENTRE -- one event, one Centre, a role-aware projection (20270729).
 *
 * `public.club_events` is the canonical event. Everything here is the server's answer for THIS viewer:
 * organisers receive totals, names, catering aggregates and controls; an invitee receives the event,
 * their own household and the public catering notes; anybody else receives null. Nothing in this module
 * decides who may see or do anything -- it reads and writes through the RPCs, which re-check.
 */

export type EventType =
  | "SOCIAL"
  | "FUNDRAISING"
  | "COMMUNITY"
  | "TRAINING"
  | "MEETING"
  | "AWARDS"
  | "TOUR"
  | "VOLUNTEER"
  | "CLUB_FUNCTION"
  | "TEAM_EVENT"
  | "FESTIVAL"
  | "EDUCATION"
  | "OTHER"

export const EVENT_TYPES: { value: EventType; label: string; hint: string }[] = [
  { value: "SOCIAL", label: "Social", hint: "Christmas party, end of season, family day" },
  { value: "FUNDRAISING", label: "Fundraising", hint: "Charity run, race night, auction" },
  { value: "COMMUNITY", label: "Community", hint: "Open day, family fun day" },
  { value: "TRAINING", label: "Training", hint: "Skills session, fitness" },
  { value: "MEETING", label: "Meeting", hint: "AGM, committee, coaches' meeting" },
  { value: "AWARDS", label: "Awards / Presentation", hint: "Presentation night, awards evening" },
  { value: "TOUR", label: "Tour / Trip", hint: "Tour, away trip, tour meeting" },
  { value: "VOLUNTEER", label: "Volunteer", hint: "Work party, volunteer day" },
  { value: "CLUB_FUNCTION", label: "Club Function", hint: "Dinner, function, celebration" },
  { value: "TEAM_EVENT", label: "Team Event", hint: "A side's own social or trip" },
  { value: "FESTIVAL", label: "Festival", hint: "Bonfire night, summer festival" },
  { value: "EDUCATION", label: "Education / Course", hint: "First aid, safeguarding, CPD" },
  { value: "OTHER", label: "Other", hint: "Anything else" },
]

export function eventTypeLabel(type: string | null | undefined): string {
  return EVENT_TYPES.find((t) => t.value === type)?.label ?? "Event"
}

export type EventAnswer = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"

export const DIETARY_KEYS = ["vegetarian", "vegan", "gluten_free", "dairy_free", "nut_allergy", "other"] as const
export type DietaryKey = (typeof DIETARY_KEYS)[number]
export const DIETARY_LABEL: Record<DietaryKey, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  gluten_free: "Gluten Free",
  dairy_free: "Dairy Free",
  nut_allergy: "Nut Allergy",
  other: "Other",
}

export interface EventResponse {
  status: EventAnswer
  guests: number
  catering: number
  dietary: Partial<Record<DietaryKey, number>>
  dietaryNote: string | null
  waitlisted: boolean
}

export interface EventHouseholdMember {
  kind: "PLAYER" | "PERSON"
  playerId: string | null
  userId: string | null
  name: string | null
  firstName: string | null
  teamName: string | null
  isSelf: boolean
  canRespond: boolean
  category?: string
  response: EventResponse | null
}

export interface EventCateringSummary {
  players: number
  staff: number
  members: number
  familyAndGuests: number
  externalGuests: number
  total: number
  dietary: Partial<Record<DietaryKey, number>>
  otherNotes: number
}

export interface EventSummary {
  invited: number
  attending: number
  cannotAttend: number
  unsure: number
  awaiting: number
  waiting: number
  externalGuests: number
  peopleConfirmed: number
  catering: EventCateringSummary | null
}

export type EventStatus = "DRAFT" | "SCHEDULED" | "POSTPONED" | "CANCELLED"
export type EventPhase = EventStatus | "COMPLETED"

export interface EventCentre {
  id: string
  name: string
  eventType: EventType
  description: string | null
  status: EventStatus
  phase: EventPhase
  statusNote: string | null
  cancellationReason: string | null
  startsOn: string
  endsOn: string
  startTime: string | null
  endTime: string | null
  meetTime: string | null
  host: { clubId: string; clubName: string; directoryId: string; logoPath: string | null; teamId: string | null; teamName: string | null }
  isClubWide: boolean
  teams: { id: string; name: string }[]
  invites: { players: boolean; staff: boolean; members: boolean; individuals: number }
  visibility: "INVITED" | "CLUB"
  location: {
    kind: "VENUE" | "EXTERNAL" | "ONLINE"
    detail: string | null
    venue: {
      id: string
      name: string
      address: string | null
      postcode: string | null
      latitude: number | null
      longitude: number | null
      directions: string | null
      coverImagePath: string | null
      coverStockKey: string | null
    } | null
    external: { name: string; address: string | null; postcode: string | null; latitude: number | null; longitude: number | null } | null
    onlineUrl: string | null
    /** The pitches this event reserves at its ground -- what Arena shows it holding. */
    pitches: { id: string; name: string }[]
  }
  rsvp: { required: boolean; deadline: string | null; open: boolean }
  maxGuests: number
  catering: { required: boolean; notes: string | null; deadline: string | null }
  capacity: { limit: number | null; waitingList: boolean; remaining: number | null; full: boolean }
  payment: { mode: "FREE" | "PAID_EXTERNALLY"; note: string | null }
  cover: { path: string | null; stockKey: string | null }
  invitationsSentAt: string | null
  invitationMessage: string | null
  viewer: { canManage: boolean; invited: boolean }
  mine: EventHouseholdMember[]
  summary: EventSummary | null
}

export async function readEventCentre(supabase: Client, eventId: string): Promise<EventCentre | null> {
  const { data, error } = await supabase.rpc("get_event_centre", { p_event_id: eventId })
  if (error) throw error
  return (data as unknown as EventCentre | null) ?? null
}

/** Where the event is, in one line. */
export function eventPlaceLine(e: Pick<EventCentre, "location">): string | null {
  const l = e.location
  if (l.kind === "VENUE" && l.venue) return [l.venue.name, l.detail].filter(Boolean).join(" · ")
  if (l.kind === "EXTERNAL" && l.external) return l.external.name
  if (l.kind === "ONLINE") return "Online"
  return null
}

/** The full address for directions, blanks dropped and the postcode said once. */
export function eventAddressLine(e: Pick<EventCentre, "location">): string | null {
  const l = e.location
  const parts =
    l.kind === "VENUE" && l.venue
      ? [l.venue.address, l.venue.postcode]
      : l.kind === "EXTERNAL" && l.external
        ? [l.external.address, l.external.postcode]
        : []
  const seen = new Set<string>()
  const out = parts.flatMap((p) => (p ?? "").split(",")).map((p) => p.trim()).filter((p) => {
    const k = p.toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
  return out.length ? out.join(", ") : null
}

/** "Hosted by Ovalball UAT RUFC · Under 9s". */
export function eventHostLine(e: Pick<EventCentre, "host">): string {
  return [e.host.clubName, e.host.teamName].filter(Boolean).join(" · ")
}

// ---------------------------------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------------------------------

export interface EventPatch {
  name?: string
  event_type?: EventType
  description?: string | null
  starts_on?: string
  ends_on?: string
  start_time?: string | null
  end_time?: string | null
  meet_time?: string | null
  host_team_id?: string | null
  is_club_wide?: boolean
  team_ids?: string[]
  individual_user_ids?: string[]
  invite_players?: boolean
  invite_staff?: boolean
  invite_members?: boolean
  visibility?: "INVITED" | "CLUB"
  rsvp_required?: boolean
  rsvp_deadline?: string | null
  max_guests?: number
  catering_required?: boolean
  catering_notes?: string | null
  catering_deadline?: string | null
  capacity?: number | null
  waiting_list_enabled?: boolean
  payment_mode?: "FREE" | "PAID_EXTERNALLY"
  price_note?: string | null
  cover_stock_key?: string | null
  cover_image_path?: string | null
  location_kind?: "VENUE" | "EXTERNAL" | "ONLINE"
  location_detail?: string | null
  venue_id?: string | null
  /** The pitches to reserve at the event's ground, as a set; left out, the event keeps those it holds. */
  pitch_ids?: string[]
  external?: { name?: string; address_line_1?: string; address_line_2?: string; town?: string; county?: string; postcode?: string; latitude?: number; longitude?: number; provider_ref?: string }
  online_url?: string | null
}

export async function saveEvent(supabase: Client, eventId: string | null, clubId: string | null, patch: EventPatch): Promise<{ eventId: string; notified: number; changed: string[]; pitchIds: string[] }> {
  const { data, error } = await supabase.rpc("save_event", { p_event_id: eventId as string, p_club_id: clubId as string, p_patch: patch as never })
  if (error) throw error
  return data as unknown as { eventId: string; notified: number; changed: string[]; pitchIds: string[] }
}

export async function previewEventInvitations(supabase: Client, eventId: string) {
  const { data, error } = await supabase.rpc("preview_event_invitations", { p_event_id: eventId })
  if (error) throw error
  return data as unknown as { recipients: number; alreadyInvited: number; players: number; staff: number; people: number; externalGuests: number }
}

export async function sendEventInvitations(supabase: Client, eventId: string, message: string | null) {
  const { data, error } = await supabase.rpc("send_event_invitations", { p_event_id: eventId, p_message: (message ?? undefined) as string })
  if (error) throw error
  return data as unknown as { sent: number; newlyInvited: number; status: EventStatus }
}

export async function respondToEvent(
  supabase: Client,
  eventId: string,
  playerId: string | null,
  answer: { status: EventAnswer; guests?: number; catering?: number | null; dietary?: Partial<Record<DietaryKey, number>>; dietaryNote?: string | null }
) {
  const { data, error } = await supabase.rpc("respond_to_event", {
    p_event_id: eventId,
    p_player_id: playerId as string,
    p_status: answer.status,
    p_guest_count: answer.guests ?? 0,
    p_catering_count: (answer.catering ?? null) as number,
    p_dietary: (answer.dietary ?? {}) as never,
    p_dietary_note: (answer.dietaryNote ?? null) as string,
  })
  if (error) throw error
  return data as unknown as { status: EventAnswer; waitlisted: boolean; promoted: number; guests: number; catering: number }
}

export async function cancelEvent(supabase: Client, eventId: string, reason: string | null) {
  const { error } = await supabase.rpc("cancel_club_event", { p_event_id: eventId, p_reason: (reason ?? undefined) as string })
  if (error) throw error
}

export async function postponeEvent(supabase: Client, eventId: string, note: string | null) {
  const { error } = await supabase.rpc("postpone_event", { p_event_id: eventId, p_note: (note ?? undefined) as string })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// GUESTS
// ---------------------------------------------------------------------------------------------------

export interface EventGuestListPerson {
  kind: "PLAYER" | "PERSON"
  playerId: string | null
  userId: string | null
  category: "PLAYER" | "STAFF" | "INVITEE" | "MEMBER"
  name: string
  teamName: string | null
  status: EventAnswer | null
  guests: number
  catering: number
  waitlisted: boolean
  dietary: Partial<Record<DietaryKey, number>>
  dietaryNote: string | null
}

export interface EventExternalGuest {
  id: string
  name: string
  email: string | null
  phone: string | null
  status: EventAnswer | null
  guests: number
  catering: number
  dietary: Partial<Record<DietaryKey, number>>
  dietaryNote: string | null
  notes: string | null
  waitlisted: boolean
}

export interface EventGuestList {
  people: EventGuestListPerson[]
  external: EventExternalGuest[]
  individuals: { userId: string; name: string | null }[]
}

export async function readEventGuestList(supabase: Client, eventId: string): Promise<EventGuestList> {
  const { data, error } = await supabase.rpc("get_event_guest_list", { p_event_id: eventId })
  if (error) throw error
  return data as unknown as EventGuestList
}

export async function searchInvitablePeople(supabase: Client, eventId: string, query: string): Promise<{ userId: string; name: string | null; detail: string }[]> {
  const { data, error } = await supabase.rpc("search_event_invitable_people", { p_event_id: eventId, p_query: query })
  if (error) throw error
  return (data as unknown as { userId: string; name: string | null; detail: string }[]) ?? []
}

export async function saveEventGuest(
  supabase: Client,
  eventId: string,
  guestId: string | null,
  guest: { name: string; email?: string | null; phone?: string | null; status?: EventAnswer | null; guests?: number; catering?: number | null; dietary?: Partial<Record<DietaryKey, number>>; dietaryNote?: string | null; notes?: string | null }
): Promise<string> {
  const { data, error } = await supabase.rpc("save_event_guest", { p_event_id: eventId, p_guest_id: guestId as string, p_guest: guest as never })
  if (error) throw error
  return data as unknown as string
}

export async function removeEventGuest(supabase: Client, eventId: string, guestId: string) {
  const { error } = await supabase.rpc("remove_event_guest", { p_event_id: eventId, p_guest_id: guestId })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// MESSAGES
// ---------------------------------------------------------------------------------------------------

export type EventAudience = "ALL" | "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | "AWAITING" | "AWAITING_AND_UNSURE" | "WAITLIST"

/**
 * WHO A MESSAGE GOES TO, described the way a register describes people -- the shared state words
 * (`ATTENDANCE_STATE_WORDS`), sentence case, exactly as the Match Centre's register, the agenda and the
 * team home say them. The answer words ("Can't Attend") belong only on the buttons a person answers with.
 */
export const EVENT_AUDIENCE_LABEL: Record<EventAudience, string> = {
  ALL: "Everyone invited",
  ATTENDING: ATTENDANCE_STATE_WORDS.ATTENDING,
  CANNOT_ATTEND: ATTENDANCE_STATE_WORDS.CANNOT_ATTEND,
  UNSURE: ATTENDANCE_STATE_WORDS.UNSURE,
  AWAITING: ATTENDANCE_STATE_WORDS.AWAITING,
  AWAITING_AND_UNSURE: "Awaiting or unsure",
  WAITLIST: "Waiting list",
}

export async function readEventAudienceCounts(supabase: Client, eventId: string): Promise<Record<EventAudience, number>> {
  const { data, error } = await supabase.rpc("event_audience_counts", { p_event_id: eventId })
  if (error) throw error
  return data as unknown as Record<EventAudience, number>
}

export async function sendEventMessage(supabase: Client, eventId: string, kind: "ANNOUNCEMENT" | "REMINDER", audience: EventAudience, body: string | null, push: boolean) {
  const { data, error } = await supabase.rpc("send_event_message", {
    p_event_id: eventId,
    p_kind: kind,
    p_audience: audience,
    // NULL, never undefined: an undefined argument is dropped from the request, and the API then looks for a
    // function without `p_body` and finds none -- which is how every reminder without words failed.
    p_body: body as string,
    p_push: push,
  })
  if (error) throw error
  return data as unknown as { communicationId: string; sent: number }
}

export interface EventMessage {
  id: string
  kind: "ANNOUNCEMENT" | "REMINDER"
  audience: string
  body: string | null
  sentBy: string | null
  sentAt: string
  reach: number | null
}

export async function readEventMessages(supabase: Client, eventId: string): Promise<EventMessage[]> {
  const { data, error } = await supabase.rpc("get_event_messages", { p_event_id: eventId })
  if (error) throw error
  return (data as unknown as EventMessage[]) ?? []
}

// ---------------------------------------------------------------------------------------------------
// THE CALENDAR'S VIEW OF MY ANSWERS
// ---------------------------------------------------------------------------------------------------

export interface MyEventAnswer {
  eventId: string
  playerId: string | null
  firstName: string | null
  status: EventAnswer | null
  waitlisted: boolean
  isSelf: boolean
}

export async function readMyEventAnswers(supabase: Client, eventIds: string[]): Promise<MyEventAnswer[]> {
  if (eventIds.length === 0) return []
  const { data, error } = await supabase.rpc("my_event_answers", { p_event_ids: eventIds })
  if (error) throw error
  return (data ?? []).map((r) => ({
    eventId: r.event_id,
    playerId: r.player_id,
    firstName: r.first_name,
    status: (r.status as EventAnswer | null) ?? null,
    waitlisted: Boolean(r.waitlisted),
    isSelf: Boolean(r.is_self),
  }))
}

/** A person's answer, DESCRIBED -- the register's state words, as every other surface describes them. */
export function answerLabel(status: EventAnswer | null, waitlisted = false): string {
  if (waitlisted) return "Waiting list"
  if (status === "ATTENDING") return ATTENDANCE_STATE_WORDS.ATTENDING
  if (status === "CANNOT_ATTEND") return ATTENDANCE_STATE_WORDS.CANNOT_ATTEND
  if (status === "UNSURE") return ATTENDANCE_STATE_WORDS.UNSURE
  return ATTENDANCE_STATE_WORDS.AWAITING
}

/** The picture an event without one of its own uses -- the Stock Media Library's one rule (`media/stock-library.ts`). */
export function defaultEventCoverKey(type: EventType, startsOn: string): string {
  return eventDefaultStockKey(type, startsOn)
}
