import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * THE CHANGING ROOM'S ANNOUNCEMENTS AND REMINDERS (`send_fixture_communication`, `get_fixture_announcements`).
 *
 * An announcement is a NOTIFICATION to the families it is for, delivered through the safeguarding-aware
 * recipient model, and recorded with who it reached. The Changing Room shows each person the
 * announcements sent to them, and shows the sending side's staff everything that side sent. The other
 * side's announcements are never shown.
 */

export type AnnouncementAudience = "MESSAGE_TEAM" | "MESSAGE_ATTENDEES" | "MESSAGE_CANNOT_ATTEND" | "MESSAGE_UNSURE"
export type ReminderAudience = "ATTENDANCE_REMINDER" | "REMIND_UNSURE" | "REMIND_AWAITING_AND_UNSURE"

export const ANNOUNCEMENT_AUDIENCES: { key: AnnouncementAudience; label: string }[] = [
  { key: "MESSAGE_TEAM", label: "All" },
  { key: "MESSAGE_ATTENDEES", label: "Attending" },
  { key: "MESSAGE_CANNOT_ATTEND", label: "Can't Attend" },
  { key: "MESSAGE_UNSURE", label: "Unsure" },
]

export const REMINDER_AUDIENCES: { key: ReminderAudience; label: string }[] = [
  { key: "ATTENDANCE_REMINDER", label: "Awaiting" },
  { key: "REMIND_UNSURE", label: "Unsure" },
  { key: "REMIND_AWAITING_AND_UNSURE", label: "Awaiting and Unsure" },
]

export interface CommunicationCounts {
  team: number | null
  attending: number | null
  outstanding: number | null
  unsure: number | null
  cannotAttend: number | null
}

export async function readCommunicationCounts(supabase: Client, fixtureId: string): Promise<CommunicationCounts> {
  const { data } = await supabase.rpc("fixture_communication_counts", { p_fixture_id: fixtureId }).maybeSingle()
  return {
    team: data?.team_count ?? null,
    attending: data?.attending_count ?? null,
    outstanding: data?.outstanding_count ?? null,
    unsure: data?.unsure_count ?? null,
    cannotAttend: data?.cannot_attend_count ?? null,
  }
}

/** How many families an audience would reach, from the counts; null when the viewer may not know. */
export function audienceCount(counts: CommunicationCounts, audience: AnnouncementAudience | ReminderAudience): number | null {
  switch (audience) {
    case "MESSAGE_TEAM":
      return counts.team
    case "MESSAGE_ATTENDEES":
      return counts.attending
    case "MESSAGE_CANNOT_ATTEND":
      return counts.cannotAttend
    case "MESSAGE_UNSURE":
    case "REMIND_UNSURE":
      return counts.unsure
    case "ATTENDANCE_REMINDER":
      return counts.outstanding
    case "REMIND_AWAITING_AND_UNSURE":
      return counts.outstanding === null || counts.unsure === null ? null : counts.outstanding + counts.unsure
  }
}

export interface SendOutcome {
  outcome: "SENT" | "PARTIALLY_DELIVERED" | "RATE_LIMITED" | "NO_ELIGIBLE_RECIPIENTS" | "FAILED"
  playerCount: number
  recipientCount: number
}

export async function sendFixtureCommunication(supabase: Client, fixtureId: string, action: AnnouncementAudience | ReminderAudience, body: string | null): Promise<SendOutcome> {
  const { data, error } = await supabase
    .rpc("send_fixture_communication", { p_fixture_id: fixtureId, p_action: action, p_body: body ?? undefined })
    .maybeSingle()
  if (error) throw error
  return {
    outcome: (data?.outcome ?? "FAILED") as SendOutcome["outcome"],
    playerCount: data?.player_count ?? 0,
    recipientCount: data?.recipient_count ?? 0,
  }
}

/** What happened, in one sentence a coach can act on. */
export function sendOutcomeLine(o: SendOutcome): string {
  switch (o.outcome) {
    case "SENT":
      return `Sent to ${o.recipientCount} ${o.recipientCount === 1 ? "family" : "families"}.`
    case "PARTIALLY_DELIVERED":
      return `Sent. Some families have switched these notifications off.`
    case "RATE_LIMITED":
      return "You sent this a moment ago. Wait a few minutes before sending it again."
    case "NO_ELIGIBLE_RECIPIENTS":
      return "Nobody in that group can be reached yet."
    case "FAILED":
      return "That didn't send. Try again."
  }
}

export interface FixtureAnnouncement {
  id: string
  kind: "ANNOUNCEMENT" | "REMINDER"
  audience: string
  body: string | null
  sentByName: string | null
  sentAt: string
  recipientCount: number | null
  sentToMe: boolean
  fromMySide: boolean
}

export async function readFixtureAnnouncements(supabase: Client, fixtureId: string): Promise<FixtureAnnouncement[]> {
  const { data, error } = await supabase.rpc("get_fixture_announcements", { p_fixture_id: fixtureId })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.communication_id,
    kind: r.kind as FixtureAnnouncement["kind"],
    audience: r.audience,
    body: r.body,
    sentByName: r.sent_by_name,
    sentAt: r.sent_at,
    recipientCount: r.recipient_count,
    sentToMe: r.sent_to_me,
    fromMySide: r.from_my_side,
  }))
}
