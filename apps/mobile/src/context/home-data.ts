import type { SupabaseClient } from "@supabase/supabase-js"
import {
  FAMILY_HORIZON_DAYS,
  clubLogoUrlFromPath,
  isFamilyFacingContext,
  listClubNews,
  listLiveClubNotices,
  loadClubKitTheme,
  narrowToChild,
  projectParentHome,
  resolveClubTheme,
  resolveWindow,
  shiftDays,
  type AgendaItem,
  type ClubNewsCard,
  type ClubNotice,
  type ClubTheme,
  type Database,
  type ParentHome,
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
  /**
   * THE THREE QUESTIONS, FROM ONE SET OF ROWS.
   *
   * What needs me, what is next, what else is on this week -- answered by
   * `projectParentHome` in the shared package, so the phone and the website
   * cannot come to different conclusions about the same rugby. Home does not
   * decide any of it; it renders it.
   */
  home: ParentHome
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
  context: SwitchableContext,
  /**
   * ONE CHILD, OR ALL OF THEM.
   *
   * A NARROWING OVER ROWS THE READ ALREADY RETURNED, never a different read: the
   * agenda is loaded for the whole family and this removes from it. There is no
   * query here for a selection to widen, and an id that is not one of this
   * person's children simply matches nothing.
   *
   * It is applied AFTER the read rather than pushed into it deliberately --
   * pushing a client-supplied player id into a server query is the shape that
   * eventually gets it wrong.
   */
  selectedPlayerId: string | null = null
): Promise<HomeSummary> {
  const today = todayIso()
  const family = isFamilyFacingContext(context.kind)
  /*
    ONE READ, FOUR MONTHS AHEAD. The website's own family panel has read from
    today to today + FAMILY_HORIZON_DAYS since it was built, so the app asks the
    same question rather than a similar one -- and asking once is what stops
    "what is next", "what needs an answer" and "what is on this week" from
    disagreeing. A staff context keeps its shorter horizon: a club's Home is a
    week's operational view, not a season's.
  */
  const range = family
    ? { start: today, end: shiftDays(today, FAMILY_HORIZON_DAYS) }
    : { start: today, end: resolveWindow("week", today, today, "upcoming").endIso }

  const [club, agenda, kit] = await Promise.all([
    loadClub(supabase, context.clubId),
    readAgenda(supabase, ctx, context, { range, includeTraining: true, today }).catch(() => null),
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

  const all = agenda?.items ?? []
  // The canonical narrowing, shared so that Home and the projection's own tests
  // are asserting the same function rather than two lines that look alike.
  const items = narrowToChild(all, selectedPlayerId)
  // THE CANONICAL RUGBY WEEK, from the same resolver the Calendar uses -- Monday
  // to Sunday, because the fixture is on Saturday and the training that prepares
  // for it is on Tuesday. "This week" must mean the same seven days on both.
  const week = resolveWindow("week", today, today, "upcoming")
  const home = projectParentHome(items, {
    todayIso: today,
    weekStartIso: week.startIso,
    weekEndIso: week.endIso,
    // An adult player reading their own rugby is asked about themselves; a
    // guardian is asked about their child. The context already knows which.
    viewerIsThePlayer: context.kind === "player",
  })

  return {
    ...club,
    home,
    /*
      WHO HAS ANSWERED, FOR STAFF ONLY.

      This is a SQUAD TALLY -- how many of a team have said yes, no or nothing --
      and it is a coach's question. A guardian sees their own child's answer, on
      the child's own row and in the Match Centre, and has no business being shown
      the rest of the squad's. The server already refuses it, and not asking is
      the better half of that: a read a family context never makes cannot leak.
    */
    nextAvailability:
      !family && home.next?.kind === "fixture" ? await loadAvailability(supabase, home.next.eventId) : null,
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
