import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { SwitchableContext } from "../active-context-rules"
import type { SessionContext } from "../session-context"
import { isFamilyFacingContext } from "../active-context-rules"
import { resolveFamilyScope } from "../agenda/family-scope"
import { loadAgenda } from "../agenda/load"
import { shiftDays } from "../agenda/window"
import { ATTENDANCE_HORIZON_DAYS } from "../parent/agenda-model"
import { attendanceAttention, narrowToChild } from "../parent/home"
import { loadFamilySubscription, type FamilySubscription } from "../subscriptions/family"
import { loadTeamOverview } from "../team/overview"
import { loadClubAttention } from "./club"
import { familyAttentionItems } from "./family"
import { sortAttention, type AttentionItem } from "./model"
import { teamAttentionItems } from "./team"

type Client = SupabaseClient<Database>

/**
 * How far the app can see for this context. `native` means the projection is the whole story for the
 * context's jobs on the phone; `web` means the context's work lives on the website and the app says
 * so rather than drawing an empty queue as if it were a clean one.
 */
export type AttentionCoverage = "native" | "web"

export interface AttentionRead {
  items: AttentionItem[]
  coverage: AttentionCoverage
  /** The context the items were projected for -- a screen must not show them under another. */
  contextKey: string
}

/**
 * THE ONE ATTENTION READ, for the context this person is standing in.
 *
 * A family context reads the agenda the Calendar reads and asks the availability rule; a team context
 * reads the shared team overview; a club context reads its queues. Site Admin and a governing body
 * are web desks: their queues are the website's own projections, and the app does not invent a copy.
 * Nothing crosses contexts -- a person wearing two hats sees one hat's work at a time, which is also
 * what keeps a club's queue out of a parent's Home.
 */
export async function loadAttentionForContext(
  supabase: Client,
  ctx: SessionContext,
  context: SwitchableContext,
  options: { todayIso: string; selectedPlayerId?: string | null }
): Promise<AttentionRead> {
  const { todayIso } = options
  const contextKey = context.key

  if (isFamilyFacingContext(context.kind)) {
    const children = resolveFamilyScope(ctx, context)
    const window = { startIso: todayIso, endIso: shiftDays(todayIso, ATTENDANCE_HORIZON_DAYS), label: "the next fortnight", order: "asc" as const }
    const [agenda, subscriptions] = await Promise.all([
      loadAgenda(supabase, { kind: "family", children }, window, { includeTraining: true }).catch(() => ({ items: [], truncated: false })),
      Promise.all(
        children.map((child) =>
          loadFamilySubscription(supabase, { playerId: child.playerId, playerName: child.firstName, clubId: child.clubId }).catch(() => null)
        )
      ),
    ])
    const items = narrowToChild(agenda.items, options.selectedPlayerId ?? null)
    const attention = attendanceAttention(items, todayIso, { viewerIsThePlayer: context.kind === "player" })
    const money = subscriptions.filter((s): s is FamilySubscription => s !== null && (!options.selectedPlayerId || s.playerId === options.selectedPlayerId))
    return { items: sortAttention(familyAttentionItems(attention, money, { kind: context.kind, clubId: context.clubId })), coverage: "native", contextKey }
  }

  if (context.kind === "team" && context.id && context.clubId) {
    const overview = await loadTeamOverview(supabase, context.clubId, context.id, todayIso)
    return { items: sortAttention(teamAttentionItems(overview, context.clubId)), coverage: "native", contextKey }
  }

  if (context.kind === "club" && (context.clubId ?? context.id)) {
    const items = await loadClubAttention(supabase, (context.clubId ?? context.id) as string, todayIso)
    return { items: sortAttention(items), coverage: "native", contextKey }
  }

  return { items: [], coverage: "web", contextKey }
}
