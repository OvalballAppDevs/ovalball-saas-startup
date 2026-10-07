import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/** Where one schedule object is: its ground's name and, where one is allocated, its pitch. */
export interface ScheduleGround {
  name: string | null
  pitchName: string | null
}

/**
 * WHERE EACH THING ON A SCHEDULE IS, FROM THE ONE RULE.
 *
 * A list must not read `venues` itself. A visiting family cannot read the host club's venue rows, so a
 * direct read told them "Venue TBC" about a ground Match Centre names two taps later; an external guest
 * invited to a club's event was told nothing about where it is. `schedule_grounds` answers with the
 * fixture's canonical ground (the venue chosen, else a canonical host's default ground), a tournament's
 * venue and an event's venue -- and only for objects the caller can already see.
 *
 * Asked in batches so a long history never meets the server's per-call ceiling. A failed answer costs
 * the names, never the schedule: the list still draws, with the fixture's own typed place where it has one.
 */
export async function loadScheduleGrounds(
  supabase: Client,
  ids: { fixtureIds?: string[]; tournamentIds?: string[]; eventIds?: string[] }
): Promise<Map<string, ScheduleGround>> {
  const unique = (list: string[] | undefined) => Array.from(new Set((list ?? []).filter(Boolean)))
  const fixtures = unique(ids.fixtureIds)
  const tournaments = unique(ids.tournamentIds)
  const events = unique(ids.eventIds)
  const grounds = new Map<string, ScheduleGround>()
  const BATCH = 300 // three lists of 300 stay under the server's ceiling of 1000 per call
  const calls: PromiseLike<void>[] = []
  for (let start = 0; start < Math.max(fixtures.length, tournaments.length, events.length); start += BATCH) {
    const slice = {
      p_fixture_ids: fixtures.slice(start, start + BATCH),
      p_tournament_ids: tournaments.slice(start, start + BATCH),
      p_event_ids: events.slice(start, start + BATCH),
    }
    calls.push(
      supabase.rpc("schedule_grounds", slice).then(({ data, error }) => {
        if (error) return
        for (const row of (data ?? []) as { subject_id: string; name: string | null; pitch_name: string | null }[]) {
          grounds.set(row.subject_id, { name: row.name ?? null, pitchName: row.pitch_name ?? null })
        }
      })
    )
  }
  await Promise.all(calls)
  return grounds
}
