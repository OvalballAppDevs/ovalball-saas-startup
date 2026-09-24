import type { SupabaseClient } from "@supabase/supabase-js"
import {
  FAMILY_HORIZON_DAYS,
  clubLogoUrlFromPath,
  isFamilyFacingContext,
  newsCardFromArticle,
  noticeFromAnnouncement,
  loadClubKitTheme,
  EMPTY_FAMILY,
  clubAccentsOnDark,
  loadFamilySubscription,
  narrowToChild,
  projectHomeHero,
  projectParentHome,
  resolveFamilyScope,
  resolveClubTheme,
  resolveWindow,
  shiftDays,
  type AgendaItem,
  type ClubNewsCard,
  type ClubNotice,
  type ClubAccents,
  type ClubTheme,
  type Database,
  type FamilyProjection,
  type FamilySubscription,
  type HeroPage,
  type ParentHome,
  type SessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

import { readFeed, readingScopeFor } from "@ovalball/contracts/club/content"

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
   * THE HERO'S PAGES, in the order they actually happen.
   *
   * Another presentation of the same canonical rows the rest of the app reads --
   * `projectHomeHero` reuses `projectParticipantMatch` and its training twin, so a
   * hero cannot state a different kick-off from the Calendar card two taps away.
   */
  hero: HeroPage[]
  /** The club's canonical home-kit colours, made safe on the forest ground. */
  accents: ClubAccents
  /**
   * THE FAMILY'S MEMBERSHIP, per child, from the one payment domain.
   *
   * Empty where the club runs no subscription programme -- which is not a gap to
   * report on screen, it is a club that does not collect through Ovalball.
   */
  subscriptions: FamilySubscription[]
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
  /** How many clubs the notices and news were heard from (a family may hear several). */
  voiceClubs: number
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
  selectedPlayerId: string | null = null,
  /**
   * THE FAMILY, ALREADY PROJECTED.
   *
   * Passed in rather than resolved again: `FamilyProvider` holds the one
   * projection the whole app draws a child from, and a second resolution here is
   * how one screen comes to show a photograph another shows initials for.
   */
  family: FamilyProjection = EMPTY_FAMILY
): Promise<HomeSummary> {
  const today = todayIso()
  const familyFacing = isFamilyFacingContext(context.kind)
  /*
    ONE READ, FOUR MONTHS AHEAD. The website's own family panel has read from
    today to today + FAMILY_HORIZON_DAYS since it was built, so the app asks the
    same question rather than a similar one -- and asking once is what stops
    "what is next", "what needs an answer" and "what is on this week" from
    disagreeing. A staff context keeps its shorter horizon: a club's Home is a
    week's operational view, not a season's.
  */
  const range = familyFacing
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
  // WHERE TO ASK is the context's rule (`readingScopeFor`); WHAT MAY BE SEEN is the server's, row by row.
  // Home asks the same projection the index reads, with smaller limits.
  const readingScope = readingScopeFor(context, ctx)
  const feed = await readFeed(supabase, readingScope, { announcements: 4, news: 3 }).catch(() => ({ announcements: [], news: [], moreAnnouncements: false, moreNews: false }))
  const notices = feed.announcements.map(noticeFromAnnouncement)
  const news = feed.news.map(newsCardFromArticle)

  const all = agenda?.items ?? []
  // The canonical narrowing, shared so that Home and the projection's own tests
  // are asserting the same function rather than two lines that look alike.
  const items = narrowToChild(all, selectedPlayerId)
  // THE CANONICAL RUGBY WEEK, from the same resolver the Calendar uses -- Monday
  // to Sunday, because the fixture is on Saturday and the training that prepares
  // for it is on Tuesday. "This week" must mean the same seven days on both.
  const week = resolveWindow("week", today, today, "upcoming")
  const accents = clubAccentsOnDark(resolveClubTheme(kit), FOREST_GROUND)
  const home = projectParentHome(items, {
    todayIso: today,
    weekStartIso: week.startIso,
    weekEndIso: week.endIso,
    // An adult player reading their own rugby is asked about themselves; a
    // guardian is asked about their child. The context already knows which.
    viewerIsThePlayer: context.kind === "player",
  })

  /*
    THE FAMILY'S MEMBERSHIP, asked only of a family context and only for the
    children this scope covers. `get_enrolment_eligibility` is the canonical
    FAMILY authority -- a guardian's own relationship to that child and that club
    -- never the team-staff `finance.subscription.view` rule, which answers a
    different question about a squad.
  */
  const subscriptions = familyFacing
    ? (
        await Promise.all(
          resolveFamilyScope(ctx, context).map((child) =>
            loadFamilySubscription(supabase, {
              playerId: child.playerId,
              playerName: child.firstName,
              clubId: child.clubId,
            }).catch(() => null)
          )
        )
      ).filter((row): row is FamilySubscription => row !== null)
    : []

  return {
    ...club,
    home,
    hero: projectHomeHero(items, family, today),
    accents,
    subscriptions,
    /*
      WHO HAS ANSWERED, FOR STAFF ONLY.

      This is a SQUAD TALLY -- how many of a team have said yes, no or nothing --
      and it is a coach's question. A guardian sees their own child's answer, on
      the child's own row and in the Match Centre, and has no business being shown
      the rest of the squad's. The server already refuses it, and not asking is
      the better half of that: a read a family context never makes cannot leak.
    */
    nextAvailability:
      !familyFacing && home.next?.kind === "fixture" ? await loadAvailability(supabase, home.next.eventId) : null,
    notices,
    news,
    voiceClubs: readingScope.clubs.length,
    theme: resolveClubTheme(kit),
  }
}

/** The forest the Parent Home stands on, so the club's accents are measured against it. */
const FOREST_GROUND = "#071c14"

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
