import type { SwitchableContext as ActiveContext } from "@ovalball/contracts"
import { loadClubEvents, type ClubEventItem } from "@ovalball/contracts/agenda/events"
import { readMyEventAnswers, type MyEventAnswer } from "@ovalball/contracts/events/centre"

import { supabase } from "../auth/supabase"

/**
 * THE EVENTS THIS CONTEXT SHOWS, for the Calendar and the Fixtures agenda alike -- one rule, two screens.
 *
 * A club context reads its club's events. Any other context reads the events this person may see and
 * keeps those that are theirs: an answer in their household (they or a child are invited), or -- for a
 * team context -- an event for that side or the whole club. The server's row rule has already removed
 * everything they may not see; this only decides which of those belong on this screen.
 */
export async function loadEventsForContext(
  active: ActiveContext,
  range: { start: string; end: string }
): Promise<{ events: ClubEventItem[]; answers: MyEventAnswer[] }> {
  const clubScope = active.kind === "club" && (active.clubId ?? active.id) ? [(active.clubId ?? active.id) as string] : null
  const found = await loadClubEvents(supabase, clubScope, { startIso: range.start, endIso: range.end }).catch(() => [] as ClubEventItem[])
  const answers = await readMyEventAnswers(supabase, found.map((e) => e.eventId)).catch(() => [] as MyEventAnswer[])
  if (clubScope) return { events: found, answers }
  const mine = new Set(answers.map((a) => a.eventId))
  // A team context is matched by the team's canonical id, never by its name: two sides can share a label.
  const teamId = active.kind === "team" ? active.id : null
  const teamClub = active.kind === "team" ? active.clubId : null
  return {
    events: found.filter(
      (e) => mine.has(e.eventId) || (!!teamId && e.clubId === teamClub && (e.isClubWide || e.teamIds.includes(teamId) || e.hostTeamId === teamId))
    ),
    answers,
  }
}
