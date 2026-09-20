import { PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageSize } from "../pagination-constants"
import { parseFixtureWindow as windowOf } from "@/lib/fixtures/date-window"
import type { FixtureStatus } from "@/lib/fixtures/status"

export { PAGE_SIZES, DEFAULT_PAGE_SIZE }
export type { PageSize }

/** The canonical match-type taxonomy. `fixtures.game_type` holds one of these; there is no second list anywhere in the product. */
export const GAME_TYPE_OPTIONS = ["Friendly", "League Fixture", "Cup Fixture", "Scheduled Match"] as const
export type GameType = (typeof GAME_TYPE_OPTIONS)[number]

export type SortKey = "date-asc" | "date-desc" | "club" | "created-desc" | "updated-desc"
export type DateFilter = "all" | "upcoming" | "past"
export type StatusFilter = "all" | FixtureStatus
export type CodeFilter = "all" | "union" | "league"
export type SourceFilter = "all" | "club_created" | "site_admin_manual" | "csv_import" | "competition_import"
/** A fixture is owned by one side, so Home/Away filters that side -- never a guess from team ordering. */
export type HomeAwayFilter = "all" | "Home" | "Away"

export type ResultStatusFilter = "all" | "none" | "awaiting_confirmation" | "final" | "disputed" | "amendment_pending" | "external_recorded" | "unverified"

export interface CompetitionFilterOption {
  id: string
  label: string
}

/** Season and team options are the same shape; kept distinct so a caller cannot pass one where the other belongs. */
export interface SeasonFilterOption {
  id: string
  label: string
}

export interface TeamFilterOption {
  id: string
  label: string
}

export interface AdminFixtureRow {
  id: string
  kickoffDate: string
  kickoffTime: string | null
  /** The time the squad is asked to arrive -- set per fixture, not derived from kick-off. */
  meetTime: string | null
  homeAway: string
  status: string
  gameType: string | null
  source: string
  rawOppositionText: string
  seasonLabel: string | null
  owningTeamId: string
  owningTeamName: string
  rugbyCode: string
  owningClubId: string
  owningDirectoryId: string
  owningClubName: string
  opponentClubName: string | null
  opponentTeamName: string | null
  opponentTeamId: string | null
  opponentClubId: string | null
  opponentDirectoryId: string | null
  opponentTeamCategory: string | null
  opponentTeamAgeGroup: string | null
  opponentTeamGender: string | null
  opponentTeamSquadDesignation: string | null
  opponentTeamRugbyCode: string | null
  homeClubName: string
  homeTeamId: string | null
  homeTeamName: string
  /** Structured fields backing homeTeamName -- kept alongside it so attachTeamAliases (query.ts) can re-derive the name once an alias is known, without a second round-trip through the view. */
  homeTeamCategory: string | null
  homeTeamAgeGroup: string | null
  homeTeamGender: string | null
  homeTeamSquadDesignation: string | null
  homeTeamRugbyCode: string | null
  awayClubName: string
  awayTeamId: string | null
  awayTeamName: string
  awayTeamCategory: string | null
  awayTeamAgeGroup: string | null
  awayTeamGender: string | null
  awayTeamSquadDesignation: string | null
  awayTeamRugbyCode: string | null
  /** Central Fixture Participant Resolution: false when home/awayClubName is a fallback to raw_opposition_text, not a real resolved club -- the UI must render this distinctly, never as if it were a canonical identity. */
  homeClubResolved: boolean
  awayClubResolved: boolean
  /** Club-identity foundation pass: resolved via the SAME ClubAvatar component every other surface uses (attachClubLogos in query.ts) -- never a page-local logo lookup. Null when unresolved or the club has no crest; ClubAvatar's own initials fallback handles both identically. */
  homeClubLogoUrl: string | null
  awayClubLogoUrl: string | null
  competitionName: string | null
  venueName: string | null
  pitchName: string | null
  messageCount: number
  cancelledAt: string | null
  updatedAt: string
  createdAt: string
  pitchAllocation: string | null
  homeScore: number | null
  awayScore: number | null
  resultStatus: string
  /** Reconciliation complaint 32: set only for a legacy pre-consolidation mirror pair -- links to the other side, which is deliberately not listed in the main table (see is_primary_mirror filtering in query.ts). */
  mirrorFixtureId: string | null
  /** Canonical fixture single-source-of-truth pass: raw Mini-Rugby Group ids for each side, when that side is a group rather than a plain team. Resolved to a display label (attachGroupLabels in query.ts) the same way Calendar and Pitch Allocation already do -- never a second, divergent resolution. */
  owningSchedulingGroupId: string | null
  opponentSchedulingGroupId: string | null
  /**
   * STEP 7 DISPLAY ONLY. Counts of the canonical availability responses for
   * the squads whose attendance this viewer may read. **Null means "not
   * authorised to know", never "nobody has answered"** -- the RPC returns null
   * counts rather than zeroes precisely so the two stay distinguishable, and a
   * surface must render nothing rather than a zero when it is null. The
   * Parent/Player journey that PRODUCES these responses is Step 9's.
   */
  availability?: { squad: number; attending: number; unavailable: number; unsure: number; awaiting: number } | null
}

/** A match type, or every one. Values come from GAME_TYPE_OPTIONS -- the canonical taxonomy -- never a second list. */
export type GameTypeFilter = "all" | GameType

export interface AdminFixtureQuery {
  q: string
  date: DateFilter
  status: StatusFilter
  code: CodeFilter
  source: SourceFilter
  resultStatus: ResultStatusFilter
  competitionEditionId: string | null
  seasonId: string | null
  teamId: string | null
  homeAway: HomeAwayFilter
  gameType: GameTypeFilter
  /**
   * An explicit inclusive date window, in force only when BOTH ends are real
   * calendar dates. It overrides the `date` bucket rather than combining with
   * it, because "upcoming, but only this week" and "this week" are the same
   * request and answering it twice is how a count disagrees with its list.
   */
  fromDate: string | null
  toDate: string | null
  sort: SortKey
  page: number
  size: PageSize
}

export function parseAdminFixtureQuery(searchParams: Record<string, string | string[] | undefined>): AdminFixtureQuery {
  const get = (key: string) => {
    const v = searchParams[key]
    return Array.isArray(v) ? v[0] : v
  }
  const size = Number(get("size"))
  return {
    q: get("q")?.trim() ?? "",
    // Section 5 live directive: the default landing view is TODAY-ONWARDS
    // (a plain VIEW filter -- history is never deleted, always one click
    // away via "All dates"), not every fixture ever recorded. "all" is
    // still reachable by explicit choice through the Date filter control.
    date: (get("date") as DateFilter) ?? "upcoming",
    status: (get("status") as StatusFilter) ?? "all",
    code: (get("code") as CodeFilter) ?? "all",
    source: (get("source") as SourceFilter) ?? "all",
    resultStatus: (get("resultStatus") as ResultStatusFilter) ?? "all",
    competitionEditionId: get("competition") || null,
    // The three filters a fixture secretary reaches for first and which the
    // surface previously had no way to express, despite fixtures carrying
    // season_id, owning_team_id and home_away all along.
    seasonId: get("season") || null,
    teamId: get("team") || null,
    homeAway: (get("ha") as HomeAwayFilter) ?? "all",
    // Match type is canonical on the fixture (`game_type`) and was on no
    // filter, column or chip on the desktop Control Centre, while the phone
    // card had been showing it all along.
    gameType: (GAME_TYPE_OPTIONS as readonly string[]).includes(get("gameType") ?? "") ? (get("gameType") as GameType) : "all",
    // A window is only in force when both ends parse as real calendar dates
    // and are the right way round -- parseFixtureWindow decides, so a
    // hand-edited or truncated URL falls back to no window rather than to a
    // half-applied one.
    fromDate: windowOf(get("from_date"), get("to_date"))?.from ?? null,
    toDate: windowOf(get("from_date"), get("to_date"))?.to ?? null,
    sort: (get("sort") as SortKey) ?? "date-asc",
    page: Math.max(1, Number(get("page")) || 1),
    size: PAGE_SIZES.includes(size as PageSize) ? (size as PageSize) : DEFAULT_PAGE_SIZE,
  }
}

/** The subset of ALL_FIXTURE_STATUSES (lib/fixtures/status.ts) settable directly through the simple status control -- the three legacy CSV-import-only statuses (Annual Holiday/Festival/Lancashire Cup) are display-only, never a new write target. Use ALL_FIXTURE_STATUSES for any filter/display surface instead of this narrower list. */
export const STATUS_OPTIONS = ["Planned", "Booked", "To Be Determined", "Cancelled", "Completed"] as const
