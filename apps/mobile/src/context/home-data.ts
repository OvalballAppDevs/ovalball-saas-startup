import type { SupabaseClient } from "@supabase/supabase-js"
import {
  clubLogoUrlFromPath,
  listClubNews,
  listLiveClubNotices,
  loadClubKitTheme,
  resolveClubTheme,
  type AgendaItem,
  type ClubNewsCard,
  type ClubNotice,
  type ClubTheme,
  type Database,
  type SessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

import { readAgenda, todayIso } from "../agenda/load"

/**
 * THE LITTLE A HOME SCREEN NEEDS, FOR THE CONTEXT YOU ARE IN.
 *
 * IT NOW READS THE CANONICAL AGENDA, and the note that used to sit here -- explaining why it could not
 * -- is the debt M5 paid. `lib/agenda/load.ts` began with `server-only` and imported a React
 * component's props type, so React Native could not reach it; Home therefore ran a small fixtures
 * query of its own and resolved the opponent with its own `??` chain.
 *
 * That agreed with the website for a fixture against a team on Ovalball and would have disagreed for
 * one against a club that is only in the Club Directory -- which is the common case for a club in its
 * first season. Two implementations agreeing today is not the same as one implementation.
 *
 * SO HOME, FIXTURES AND CALENDAR NOW ASK THE SAME QUESTION. Home takes the first item; Fixtures takes
 * the list; Calendar takes a week of it. They cannot disagree about who is playing whom, which side is
 * at home or what a fixture is called, because there is one answer.
 *
 * WHAT HOME KEEPS FOR ITSELF is the CLUB IDENTITY on the header -- the crest, the name and the club's
 * own kit COLOURS for whatever context is selected -- and what the club has SAID. Neither is an agenda
 * question. The notices and the news come from the same two tables and the same two rules the
 * website's club desk reads, so a notice published in Club or Team Management appears on the phone
 * because it was published, not because a second query happened to agree.
 */

export interface Availability {
  squad: number
  available: number
  unavailable: number
  awaiting: number
}

export interface HomeSummary {
  clubName: string | null
  clubLogoUrl: string | null
  /** The club's public page slug, so a news story opens where it is published rather than being reproduced in the app. */
  clubSlug: string | null
  /** The next thing on, whatever context is selected. Null is a legitimate answer, not a failure. */
  next: AgendaItem | null
  /** The rest of the week, so Home can say what else is on without a second read. */
  week: AgendaItem[]
  /**
   * WHO HAS ANSWERED FOR THE NEXT MATCH, where the viewer may see it.
   *
   * Not part of the agenda, and deliberately not added to it: an agenda row is one line in a list and
   * a squad summary per row would be one RPC per row. This asks about the ONE fixture Home puts at the
   * top, which is also the only one Needs Attention can sensibly chase.
   *
   * Null where the server declined to answer -- a guardian sees their own child's response, not the
   * team's tally -- and absence is rendered as absence, never as zeroes.
   */
  nextAvailability: Availability | null
  /**
   * WHAT THE CLUB HAS SAID.
   *
   * Short, dated notices and the club's news, written in Club and Team
   * Management and published to the club's own page. An empty list is an
   * ordinary answer -- most clubs have nothing pinned most weeks -- and the
   * screen collapses the section rather than announcing the absence, which is
   * the correction the web's own desk already made after a club with nothing to
   * say was told so three times in a column.
   */
  notices: ClubNotice[]
  news: ClubNewsCard[]
  /**
   * THE CLUB'S OWN COLOURS, from its home kit.
   *
   * Derived by the same `resolveClubTheme` the website's club home uses, from
   * the same `club_kits` row -- so a club that changes its shirt changes both
   * clients at once. Never null: a club with no recorded kit gets Ovalball's
   * own, and the theme says which of the two it is.
   */
  theme: ClubTheme
}

type Client = SupabaseClient<Database>

export async function loadHomeSummary(
  supabase: Client,
  ctx: SessionContext,
  context: SwitchableContext
): Promise<HomeSummary> {
  const today = todayIso()
  const [club, agenda, kit] = await Promise.all([
    loadClub(supabase, context.clubId),
    // ONE READ FOR BOTH ANSWERS. "What is next" and "what else is on this week" are the same rows
    // looked at twice, and asking twice is how they would come to disagree.
    readAgenda(supabase, ctx, context, { mode: "week", anchor: today, includeTraining: true, today }).catch(() => null),
    context.clubId ? loadClubKitTheme(supabase, context.clubId).catch(() => null) : Promise.resolve(null),
  ])

  /*
    THE CLUB'S VOICE. Asked for alongside the rugby rather than after it, and
    each failing on its own: a club with no news must not cost the week's
    fixtures, and a notices query that errors must not blank the screen. Both
    resolve to an empty list, which is also what a club with nothing to say
    returns, so the screen has one case to render rather than three.
  */
  const [notices, news] = context.clubId
    ? await Promise.all([
        listLiveClubNotices(supabase, context.clubId, 4).catch(() => []),
        listClubNews(supabase, context.clubId, club.clubName ?? "Club", 3).catch(() => []),
      ])
    : [[], []]

  const items = agenda?.items ?? []
  // NOT THE FIRST ROW -- the first row that is still ON. A cancelled match is not what somebody is
  // getting ready for, so it does not take the headline; it stays perfectly visible in Fixtures.
  const next = items.find((item) => item.status !== "Cancelled") ?? null
  return {
    ...club,
    next,
    week: items.filter((item) => item !== next),
    nextAvailability: next?.kind === "fixture" ? await loadAvailability(supabase, next.eventId) : null,
    notices,
    news,
    theme: resolveClubTheme(kit),
  }
}

async function loadAvailability(supabase: Client, fixtureId: string): Promise<Availability | null> {
  const { data } = await supabase.rpc("fixture_availability_summary", { p_fixture_ids: [fixtureId] })
  const counts = data?.[0]
  if (!counts) return null
  return {
    squad: counts.squad_count ?? 0,
    available: counts.attending_count ?? 0,
    unavailable: counts.unavailable_count ?? 0,
    awaiting: counts.awaiting_count ?? 0,
  }
}

async function loadClub(
  supabase: Client,
  clubId: string | null
): Promise<{ clubName: string | null; clubLogoUrl: string | null; clubSlug: string | null }> {
  if (!clubId) return { clubName: null, clubLogoUrl: null, clubSlug: null }
  const { data } = await supabase
    .from("clubs")
    .select("slug, logo_storage_path, club_directory(name, logo_storage_path)")
    .eq("id", clubId)
    .maybeSingle()
  if (!data) return { clubName: null, clubLogoUrl: null, clubSlug: null }
  // THE CANONICAL RULE, from the shared package: the club's own upload, else the Club Directory's
  // branding logo, else nothing. Never a kit.
  const path = data.logo_storage_path ?? data.club_directory?.logo_storage_path ?? null
  return {
    clubName: data.club_directory?.name ?? null,
    clubLogoUrl: clubLogoUrlFromPath(supabase, path),
    clubSlug: data.slug ?? null,
  }
}

/*
 * The date helpers that used to live here -- readableDate, dateParts, relativeDay -- went with the
 * fixture card they served. `src/agenda/presentation.ts` is where an agenda date becomes words now,
 * and it is the one Fixtures, Calendar and Home all read, so "Saturday" means the same day on all
 * three. The old `relativeDay` took a Date and parsed dates as UTC midnight, which is how a fixture
 * shows on the wrong day west of Greenwich; the replacement takes today as an ISO string and reads
 * both dates at midday.
 */
