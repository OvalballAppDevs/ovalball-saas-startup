import type { SupabaseClient } from "@supabase/supabase-js"
import {
  loadAgenda,
  resolveAgendaScope,
  resolveWindow,
  type AgendaItem,
  type AgendaScope,
  type Database,
  type Direction,
  type RangeMode,
  type SessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

/**
 * ONE READ, FOR HOME, FIXTURES AND CALENDAR.
 *
 * This is deliberately thin. `resolveAgendaScope`, `resolveWindow` and `loadAgenda` are the WEBSITE'S
 * OWN functions, now in the shared package; nothing here reinterprets a fixture, resolves an opponent,
 * flips home and away or decides whose rugby a context covers. If the three mobile surfaces ever
 * disagreed, it would be because they projected the same items differently -- never because they asked
 * different questions.
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. Home used to run its own small fixtures query and resolve the
 * opponent with its own `??` chain. It agreed with the website for a fixture against a team on
 * Ovalball, and would have disagreed for one against a club that is only in the Directory -- which is
 * the common case for a club in its first season. Two implementations agreeing today is not the same
 * as one implementation.
 *
 * SCOPE COMES FROM THE PROVED SESSION, NEVER FROM A SCREEN. `resolveAgendaScope` takes the
 * SessionContext the server resolved and the context somebody switched into, and takes no other input.
 * A filter later can only remove rows from what it returns; nothing a screen does can widen it.
 */

type Client = SupabaseClient<Database>

export interface AgendaRead {
  items: AgendaItem[]
  /** True when the row cap bit. Said out loud rather than quietly truncating. */
  truncated: boolean
  scope: AgendaScope
  /** What to call the window, in the agenda's own words. */
  label: string
}

export interface AgendaRequest {
  mode?: RangeMode
  /** The day the window is anchored on. Ignored by "upcoming", which anchors on today. */
  anchor?: string
  direction?: Direction
  includeTraining?: boolean
  /** The device's today, passed in so a test can pin it and a screen cannot drift from it. */
  today?: string
}

export async function readAgenda(
  supabase: Client,
  ctx: SessionContext,
  active: SwitchableContext,
  request: AgendaRequest = {}
): Promise<AgendaRead> {
  const today = request.today ?? todayIso()
  const scope = resolveAgendaScope(ctx, active)
  const window = resolveWindow(request.mode ?? "upcoming", request.anchor ?? today, today, request.direction ?? "upcoming")
  const result = await loadAgenda(supabase, scope, window, { includeTraining: request.includeTraining ?? true })
  return { items: result.items, truncated: result.truncated, scope, label: window.label }
}

/**
 * TODAY, IN THE DEVICE'S OWN CALENDAR -- not in UTC.
 *
 * `new Date().toISOString().slice(0, 10)` is the tempting one-liner and it is wrong for exactly the
 * people this app is for: a parent checking at ten on a Saturday night in British Summer Time is
 * already "tomorrow" in UTC, so the fixture they are looking for drops out of the upcoming window.
 * Fixtures are stored as a DATE with a separate time, so the only correct comparison is against the
 * local civil date.
 */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type { AgendaItem, AgendaScope }
