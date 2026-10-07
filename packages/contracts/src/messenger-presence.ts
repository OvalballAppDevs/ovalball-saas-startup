import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHETHER SOMEBODY IS AROUND, said honestly.
 *
 * There is no `online = true` flag anywhere in Ovalball. Presence is the `profiles.last_active_at`
 * heartbeat that a signed-in client refreshes every minute while it is in the foreground
 * (`touch_last_active`), read back only through `my_direct_presence` -- which answers for the other
 * person in MY OWN direct conversations, only where both are adults and neither has blocked the other.
 * A child's activity is never shown, a stranger's is never reachable, and a block hides it both ways.
 *
 * "Online now" therefore means "this person's app checked in within the last two minutes" -- two missed
 * heartbeats. After that: "Recently active" for a quarter of an hour, then "Last online today at 3:45pm",
 * "yesterday at 8:12pm" or "11/02/22 at 3:45pm". Never anything finer than when the app was last open.
 */

/** How often a foreground client says it is still here. */
export const PRESENCE_HEARTBEAT_MS = 60_000

/** Two missed heartbeats and somebody is no longer "Online". */
export const ONLINE_WINDOW_MS = 2 * PRESENCE_HEARTBEAT_MS

const RECENT_WINDOW_MS = 15 * 60_000
const DAY_MS = 24 * 60 * 60_000

export interface PresenceState {
  online: boolean
  /** Null where there is nothing true and useful to say; a surface then says nothing rather than "Offline". */
  label: string | null
}

export function presenceFromLastActive(lastActiveAt: string | null | undefined, now: number = Date.now()): PresenceState {
  if (!lastActiveAt) return { online: false, label: null }
  const at = new Date(lastActiveAt).getTime()
  if (Number.isNaN(at)) return { online: false, label: null }
  const age = now - at
  if (age < ONLINE_WINDOW_MS) return { online: true, label: "Online now" }
  if (age < RECENT_WINDOW_MS) return { online: false, label: "Recently active" }
  return { online: false, label: `Last online ${lastOnlineWhen(at, now)}` }
}

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })

/** "3:45pm" -- the clock time as people say it, in UK time. */
function clock(at: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).formatToParts(new Date(at))
  const hour = parts.find((p) => p.type === "hour")?.value ?? ""
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\./g, "").replace(/\s/g, "")
  return `${hour}:${minute}${period}`
}

/**
 * "today at 3:45pm", "yesterday at 8:12pm", "11/02/22 at 3:45pm" -- UK dates, from the heartbeat the platform
 * already keeps, and nothing finer: app presence, never location or activity.
 */
function lastOnlineWhen(at: number, now: number): string {
  const day = LONDON_DAY.format(new Date(at))
  if (day === LONDON_DAY.format(new Date(now))) return `today at ${clock(at)}`
  if (day === LONDON_DAY.format(new Date(now - DAY_MS))) return `yesterday at ${clock(at)}`
  const short = new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/London" })
  return `${short} at ${clock(at)}`
}

export interface DirectPresence {
  conversationId: string
  otherUserId: string
  lastActiveAt: string | null
}

/** The other person's last activity in each of my direct conversations, where the server allows it. */
export async function loadDirectPresence(supabase: SupabaseClient<Database>): Promise<Map<string, DirectPresence>> {
  const result = new Map<string, DirectPresence>()
  const { data, error } = await supabase.rpc("my_direct_presence")
  if (error || !data) return result
  for (const row of data) {
    result.set(row.conversation_id, {
      conversationId: row.conversation_id,
      otherUserId: row.other_user_id,
      lastActiveAt: row.last_active_at ?? null,
    })
  }
  return result
}

/** One heartbeat. Failure is silent and harmless: the next one a minute later tries again. */
export async function touchLastActive(supabase: SupabaseClient<Database>): Promise<void> {
  await supabase.rpc("touch_last_active")
}
