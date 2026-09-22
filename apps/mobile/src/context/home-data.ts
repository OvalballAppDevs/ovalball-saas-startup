import type { SupabaseClient } from "@supabase/supabase-js"
import { clubLogoUrlFromPath, type Database, type SwitchableContext } from "@ovalball/contracts"

/**
 * THE LITTLE A HOME SCREEN NEEDS, FOR THE CONTEXT YOU ARE IN.
 *
 * WHY NOT `loadAgenda`. The website's canonical agenda reader is the right answer and this is not it.
 * `lib/agenda/load.ts` depends on a React component's props type and on a `.server` module, so
 * reaching it from React Native means pulling two more things apart -- and that touches the fixture
 * surfaces the current web programme is in the middle of. Extracting it belongs to M5, where Fixtures
 * is actually built and the extraction can be verified against the surfaces it serves. Until then this
 * asks a deliberately small question and says so, rather than copying the agenda's logic and leaving a
 * second implementation behind.
 *
 * RLS IS THE BOUNDARY, as it is for the website's own browser client. This selects fixtures for one
 * team; the database returns the rows this person may see, and none if they may see none. There is no
 * join here that decides who may read what, and no capability is inferred from the result.
 *
 * THE OPPONENT IS RESOLVED IN THE CANONICAL ORDER -- a real opposing team, then a directory identity,
 * then the free text a fixture was created with. Getting that order wrong is how a fixture against a
 * club that IS on Ovalball reads as a stranger.
 */

export interface NextFixture {
  id: string
  date: string
  kickoff: string | null
  opponent: string
  homeAway: string | null
  status: string | null
}

export interface HomeSummary {
  clubName: string | null
  clubLogoUrl: string | null
  nextFixture: NextFixture | null
}

type Client = SupabaseClient<Database>

export async function loadHomeSummary(supabase: Client, context: SwitchableContext): Promise<HomeSummary> {
  const [club, nextFixture] = await Promise.all([
    loadClub(supabase, context.clubId),
    loadNextFixture(supabase, context),
  ])
  return { ...club, nextFixture }
}

async function loadClub(supabase: Client, clubId: string | null): Promise<{ clubName: string | null; clubLogoUrl: string | null }> {
  if (!clubId) return { clubName: null, clubLogoUrl: null }
  const { data } = await supabase
    .from("clubs")
    .select("logo_storage_path, club_directory(name, logo_storage_path)")
    .eq("id", clubId)
    .maybeSingle()
  if (!data) return { clubName: null, clubLogoUrl: null }
  // THE CANONICAL RULE, from the shared package: the club's own upload, else the Club Directory's
  // branding logo, else nothing. Never a kit.
  const path = data.logo_storage_path ?? data.club_directory?.logo_storage_path ?? null
  return {
    clubName: data.club_directory?.name ?? null,
    clubLogoUrl: clubLogoUrlFromPath(supabase, path),
  }
}

async function loadNextFixture(supabase: Client, context: SwitchableContext): Promise<NextFixture | null> {
  // One team's next fixture. A club or family context covers several teams and deserves a different
  // question, which Home asks by not asking this one -- an arbitrary team's fixture presented as "your
  // next fixture" is worse than no card.
  const teamId = context.kind === "team" ? context.id : null
  if (!teamId) return null

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, opponent_team_display_name_snapshot, opponent_team_id, teams!fixtures_opponent_team_id_fkey(display_name, clubs(club_directory(name)))"
    )
    .eq("owning_team_id", teamId)
    .gte("kickoff_date", today)
    .order("kickoff_date", { ascending: true })
    .limit(1)
  if (error || !data || data.length === 0) return null

  const row = data[0]
  const opponentTeam = row.teams
  const opponent =
    (opponentTeam
      ? [opponentTeam.clubs?.club_directory?.name, opponentTeam.display_name].filter(Boolean).join(" ")
      : null) ??
    row.opponent_team_display_name_snapshot ??
    row.raw_opposition_text ??
    "Opposition to be confirmed"

  return {
    id: row.id,
    date: row.kickoff_date,
    kickoff: row.kickoff_time,
    opponent,
    homeAway: row.home_away,
    status: row.status,
  }
}

/** A date a person reads, in the product's own UK form. */
export function readableDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}
