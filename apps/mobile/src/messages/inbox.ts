import type { SupabaseClient } from "@supabase/supabase-js"
import {
  byRecentActivity,
  getMessengerRows,
  isFamilyFacingContext,
  type Database,
  type MessengerRow,
  type SessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

/**
 * THE INBOX, FROM THE WEBSITE'S OWN ASSEMBLER.
 *
 * `getMessengerRows` is the one place a conversation becomes a row: fixture negotiations, club
 * threads, Support, announcements and direct messages, each read through an RPC that is already
 * scoped to the caller. Mobile runs THAT function rather than a mobile version of it, so the inbox
 * on a phone contains exactly what the inbox in a browser contains -- and when a kind is added, both
 * get it.
 *
 * `includeClubToClub` IS THE ONE PRODUCT RULE, and it is the web's: a parent or a player does not see
 * club-to-club fixture negotiation, while their own Support thread is always theirs. Expressed here by
 * calling the same `isFamilyFacingContext` predicate the website calls, not by a second list of kinds.
 *
 * NOTHING HERE DECIDES WHO MAY SEE WHAT. Every row came back from an RPC or an RLS-protected read that
 * already made that decision; a context is a SCOPE, and hiding a row would not protect it any more
 * than showing one would expose it.
 */
export async function loadInbox(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  userId: string,
  active: SwitchableContext | null
): Promise<MessengerRow[]> {
  const rows = await getMessengerRows(supabase, ctx, userId, {
    includeClubToClub: !active || !isFamilyFacingContext(active.kind),
  })
  return [...rows].sort(byRecentActivity)
}

/** The badge's number. Counted from the same rows the list shows, so the two can never disagree. */
export function unreadTotal(rows: MessengerRow[]): number {
  return rows.reduce((total, row) => total + (row.unreadCount > 0 ? row.unreadCount : 0), 0)
}

/**
 * WHICH SCREEN A ROW OPENS.
 *
 * The web carries an `href` on every row; a phone needs a route of its own, so the KIND is mapped
 * rather than the href parsed. Parsing "/messages/direct/<id>" back into its parts would be a second,
 * silent dependency on the website's URL shape.
 *
 * A kind this build cannot open yet returns null, and the list shows it without making it tappable --
 * which is honest, and better than a row that opens a blank screen.
 */
export function routeForRow(row: MessengerRow): { pathname: string; params: Record<string, string> } | null {
  const id = row.key.slice(row.key.indexOf(":") + 1)
  switch (row.kind) {
    case "direct":
    case "fixture":
    case "request":
    case "club":
      // The route shape IS the link shape, so a row and a deep link go to the same place by the same
      // name -- there is no second mapping to keep in step.
      return { pathname: "/messages/[kind]/[id]", params: { kind: row.kind, id } }
    default:
      // Support and announcements have their own shapes and their own reply rules; M7 gives them
      // native screens rather than forcing them through a conversation view that would misdescribe them.
      return null
  }
}
