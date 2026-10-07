import type { SupabaseClient } from "@supabase/supabase-js"

import type { KitConfig } from "./kit"
import { clubLogoUrlFromPath, resolveClubLogoUrl } from "../club-logo"
import { resolveTournamentCover, type TournamentCover } from "../tournament-cover"
import { fixtureHasResult } from "./fixture-status"
import { loadScheduleGrounds } from "./grounds"
import { dedupeMirrorPairs } from "./mirror-pair"
import { compactTeamLabel } from "../teams/compact-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "./team-identity"
import type { Database } from "../database"

import type { AgendaScope } from "./scope"
import type { DateWindow } from "./window"

/**
 * READING THE AGENDA.
 *
 * One loader, four scopes, and a query shaped by the scope the server already
 * resolved -- never by anything in the request. A filter narrows what comes
 * back from here; nothing in a URL can reach the `.in()` clauses below.
 *
 * BOUNDED BY CONSTRUCTION. Every read is bounded twice: by the resolved date
 * window (always finite -- see window.ts), and by a hard row cap. A Site Admin
 * asking for a year is a big question and it is answered with a big-but-finite
 * query, never by pulling the platform's history into the browser and
 * filtering it in React. Where the cap bites, the page says so rather than
 * quietly truncating.
 *
 * IDENTITY IS INHERITED, NOT REINVENTED. The Match Centre is the richest
 * expression of a fixture; this carries the same facts at agenda density --
 * crest, kit, opposition, home/away, venue, status -- resolved through the
 * same canonical helpers (resolveClubLogoUrl, loadTeamIdentitiesForSeason,
 * club_kits). There is no second opposition catalogue and no parsing of
 * display strings: opposition identity comes from the fixture's own
 * opponent_team_id or opponent_directory_id.
 */

/**
 * WHERE A TOURNAMENT APPEARS, AND WHERE IT DELIBERATELY DOES NOT.
 *
 * Every dated-activity projection in Ovalball was examined and classified, because "it comes out of
 * the agenda loader" is not a reason for a festival to appear on a screen built to answer a different
 * question. A = it belongs; B = it does not; D = the surface's own filter already settles it.
 *
 *   A  mobile Calendar (month, list, week sheet, season grid)   the canonical "what is happening"
 *   A  web Agenda (app/(app)/agenda)                            the same question on the other client
 *   A  web Calendar (app/(app)/calendar)                        reads tournaments through its own query
 *   A  mobile Home / club Home / team Home / player Home        "what is coming up" includes a festival
 *   A  team page "What's Next" (components/teams/team-whats-next) a team's next activity may be a tournament
 *   A  Needs Attention / availability (attention/load.ts)        an unanswered tournament IS outstanding
 *   B  mobile Fixtures list                                      a list of MATCHES: every control on it --
 *                                                                home/away, opposition, match type, Add
 *                                                                Result -- is a fixture concept a
 *                                                                tournament does not have
 *   B  team "past results" lists (team/profile, team/overview,   these ask "what did we play and what
 *      web team page past window)                                was the score"; a tournament has no
 *                                                                single scoreline to answer with
 *   D  club overview counts (club/overview.ts)                   filters kind === "fixture" itself
 *   D  team overview next-fixture (team/overview.ts)             filters kind === "fixture" itself
 *   D  participant Home hero (participant/home-hero.ts)          selects the next FIXTURE and the next
 *                                                                TRAINING explicitly, so a tournament is
 *                                                                never chosen; a tournament hero is a
 *                                                                product decision not yet taken
 *   C  notifications and reminders                               BLOCKED pending Planning: an invitation
 *                                                                or reminder about a tournament should
 *                                                                carry its published programme, and
 *                                                                there is none to carry yet
 *
 * The B surfaces opt out explicitly through `includeTournaments: false` rather than filtering the rows
 * out after the fact, so the query a screen makes matches the question it is asking.
 */

/** The most rows any single agenda read will return, whatever the scope. */
export const AGENDA_ROW_CAP = 400

export interface AgendaSide {
  /** Canonical club directory id -- the identity the opposition filter groups on. Null for an unset opposition. */
  directoryId: string | null
  clubName: string
  /** The DISPLAY form -- "Under 12 Boys". What a team is called everywhere a row has room for it. */
  teamName: string | null
  /**
   * The COMPACT form -- "U12", "Girls U14", "Men's 1st".
   *
   * The same canonical identity in the rugby identifier shape, for the dense
   * surfaces whose design calls for it: Calendar lanes and FILTER CHIPS. Derived
   * from the team's structured fields by `compactTeamLabel`, never shortened
   * from the display name -- a label built by trimming words off another label
   * is a naming convention invented for a screen.
   *
   * Null where the season identity did not resolve, and the caller falls back to
   * the display form rather than inventing a short one.
   */
  compactName: string | null
  /**
   * THE CANONICAL RUGBY CODE this side plays -- "union" or "league".
   *
   * Carried so a participant surface can say what kind of rugby a fixture is
   * without parsing it out of a name. `teams.rugby_code` is the one authority;
   * never inferred from an age grade, a competition or a club.
   *
   * Null for a side that is only a Club Directory entry, which has a team name
   * but no Ovalball team behind it to ask.
   */
  rugbyCode: string | null
  crestUrl: string | null
  kit: KitConfig | null
}

export interface AgendaItem {
  key: string
  /**
   * WHAT KIND OF DATED ACTIVITY THIS IS.
   *
   * A TOURNAMENT IS NOT A FIXTURE. It has no opposition, no home and away, and
   * no single scoreline, so it is carried as its own kind rather than squeezed
   * into a fixture's shape. Every surface that branches on this must handle
   * all three: a `kind === "training" ? a : b` written when there were two
   * kinds silently renders a festival as a match.
   */
  kind: "fixture" | "training" | "tournament"
  /** The canonical fixture_id, training_session_id or tournament_id. Never synthesised. */
  eventId: string
  date: string
  time: string | null
  meetTime: string | null
  /** Our side, read from the viewer's own team's point of view. */
  us: AgendaSide
  /** The opposition. Null for training and for a tournament, neither of which has one, and neither of which must ever be given a fake one. */
  them: AgendaSide | null
  /**
   * THE ACTIVITY'S OWN NAME, where it has one -- "Lancashire Minis Festival".
   *
   * A fixture is named by its two sides and a training session by its team, so
   * both are null here and keep being drawn the way they always were. A
   * tournament is the first activity that carries a name of its own, and a row
   * that dropped it would describe a Saturday in April as "Under 12 Boys" and
   * nothing more.
   */
  name: string | null
  /**
   * THE TOURNAMENT'S OWN DETAILS, exactly the facts its Calendar row shows and no more.
   *
   * Null for a fixture and for training. Everything here is read from the tournament's own canonical
   * record -- the age group from the side that is entered, the host from the hosting club's directory
   * identity, the photograph through `resolveTournamentCover`, which is the SAME chain the tournament
   * list card and the detail hero use. There is no thumbnail cover and no list-only photograph.
   */
  tournament: {
    /** The competition this side is entered in -- "U12". Never inferred from the team's name. */
    ageGroup: string
    /** Who is running the day, as the Club Directory names them. */
    hostClubName: string | null
    /**
     * The competition's format -- "round_robin", "knockout", "swiss". It decides ONE thing on a
     * Calendar row: which accent the format mark uses. It never changes the row, its destination,
     * its spacing or its attendance; a cup day and a league day are the same kind of event.
     */
    format: string | null
    /** When it finishes, where the organiser has said. Null is "not stated", never a guess. */
    endTime: string | null
    /** The canonical cover selection. The client turns `stock`/`none` into an asset it can load. */
    cover: TournamentCover
  } | null
  /**
   * WHICH DAY OF A MULTI-DAY ACTIVITY THIS ROW IS -- `{ day: 2, of: 3 }`.
   *
   * A tournament that runs Saturday to Monday appears on the Calendar on all
   * three days, because a calendar is asked "what is happening on this date"
   * and the answer on the Sunday is the festival. The three rows are the same
   * tournament: one `eventId`, one Tournament Centre, one attendance answer.
   * This field is what lets a row say "Day 2 of 3" instead of looking like
   * three separate events that happen to share a name.
   *
   * Null for a single-day activity, which includes every fixture, every
   * training session and a one-day tournament -- "Day 1 of 1" is noise.
   */
  dayOfSpan: { day: number; of: number } | null
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  venue: string | null
  pitch: string | null
  status: string | null
  /**
   * THE CANONICAL MATCH TYPE — `fixtures.game_type`, verbatim.
   *
   * "Friendly", "League Fixture", "Cup Fixture", "Scheduled Match": the taxonomy
   * the database constrains and a Fixture Secretary sets on the web. Carried
   * here so a parent's phone shows the value that record holds, changed on the
   * web and read on the phone with no synchronisation of any kind -- one record,
   * two clients.
   *
   * Null where nothing is recorded, which is not "Friendly". Training has none.
   */
  gameType: string | null
  /** Canonical result, where one exists. Never inferred, never fabricated. */
  result: { ourScore: number; theirScore: number } | null
  /**
   * ONE REAL GAME OF A PUBLISHED TOURNAMENT PLAN, on a surface that lists matches (20270726).
   *
   * The row is still `kind: "tournament"` -- the same tournament, its Centre, its attendance answer --
   * but it is a single game: `them` is the real opponent, `time` its kick-off, `result` its counted
   * score, and it opens the one canonical game screen. The stage is the server's own label. Absent on
   * a Calendar's day rows, which describe the festival rather than one of its games.
   */
  tournamentGame?: { id: string; stageLabel: string; tournamentName: string } | null
  /** Which player this row belongs to in a family scope; null for staff/club/platform scopes. */
  playerId: string | null
  /**
   * The child's FIRST NAME, for a row that needs to say whose rugby it is in a
   * context where the family projection is not to hand.
   *
   * There is deliberately no `childAvatarUrl` beside it. There used to be, and it
   * was always null: resolving a child's photograph needs a signed URL from a
   * private bucket, which this reader never asked for. `FamilyProjection` is the one
   * authority for how a child is DRAWN -- picture, initials and the name a chip
   * carries -- and a second, permanently empty field on every agenda row was an
   * invitation to draw them a second way.
   */
  childFirstName: string | null
  attendance: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
  /** For a fixture, whether the server takes an answer yet (`fixtures.attendance_is_open`). */
  attendanceOpen?: boolean | null
  /**
   * The viewer's team this row belongs to. EMPTY for the one row that belongs to no team: a tournament
   * the viewer's club HOSTS without entering a side of its own, drawn in the host club's context so the
   * organiser can see the festival they are running (20270736). Never a fabricated team id.
   */
  teamId: string
  clubId: string | null
  /**
   * The Match Centre for a fixture, the Training Centre for a session, the
   * Tournament Centre for a tournament. Each addressed by its own canonical id.
   */
  href: string | null
}

export interface AgendaReadResult {
  items: AgendaItem[]
  /** True when the row cap was reached -- the page says so rather than pretending this is everything. */
  truncated: boolean
}

type Client = SupabaseClient<Database>

const FIXTURE_FIELDS =
  "id, owning_team_id, opponent_team_id, opponent_directory_id, season_id, mirror_fixture_id, kickoff_date, kickoff_time, meet_time, home_away, status, game_type, raw_opposition_text, venue_address, venue_id, pitch_id, home_score, away_score, result_status, attendance_is_open"

/**
 * Which teams' rugby this scope covers.
 *
 * Resolved from the SCOPE, so the ids that reach a query are always ones the
 * session proved. Platform scope returns null, meaning "no team filter" --
 * the only scope that gets one, and only for a Full Site Admin.
 */
async function teamIdsForScope(supabase: Client, scope: AgendaScope): Promise<string[] | null> {
  if (scope.kind === "family") return Array.from(new Set(scope.children.map((c) => c.teamId)))
  if (scope.kind === "teams") return scope.teamIds
  if (scope.kind === "club") {
    const { data } = await supabase.from("teams").select("id").eq("club_id", scope.clubId)
    return (data ?? []).map((t) => t.id)
  }
  if (scope.kind === "platform") return null
  return []
}

export async function loadAgenda(
  supabase: Client,
  scope: AgendaScope,
  window: DateWindow,
  options: {
    includeTraining: boolean
    includeTournaments?: boolean
    /** A list of MATCHES asks for a tournament's published games, one row each, instead of its days. */
    tournamentGames?: boolean
  }
): Promise<AgendaReadResult> {
  if (scope.kind === "none") return { items: [], truncated: false }

  const teamIds = await teamIdsForScope(supabase, scope)
  if (teamIds !== null && teamIds.length === 0) return { items: [], truncated: false }

  // ---- FIXTURES -----------------------------------------------------------
  let fixtureQuery = supabase
    .from("fixtures")
    .select(FIXTURE_FIELDS)
    .gte("kickoff_date", window.startIso)
    .lte("kickoff_date", window.endIso)
    .is("archived_at", null)
    .order("kickoff_date", { ascending: window.order === "asc" })
    .limit(AGENDA_ROW_CAP)

  if (teamIds !== null) {
    // BOTH sides. A club's own fixtures include every one it responded to
    // rather than created, and matching only the owning side silently drops
    // half of them -- the same reasoning the Calendar's query records.
    fixtureQuery = fixtureQuery.or(`owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})`)
  }

  // ---- SCHEDULING GROUPS --------------------------------------------------
  // A training session belongs to EITHER a team or a scheduling group -- the
  // table's own check constraint says exactly one of the two. A group is how
  // Mini-Rugby runs one session for several component teams, and its
  // participants are the members of those teams: scheduling_group_members is
  // the canonical join, and it is the same one get_training_register,
  // get_my_players_for_training_session and respond_to_training_attendance all
  // read. Nothing is invented here; the group is simply resolved to the teams
  // it already contains.
  const { data: groupMemberRows } = options.includeTraining
    ? teamIds !== null
      ? await supabase.from("scheduling_group_members").select("group_id, team_id").in("team_id", teamIds)
      : await supabase.from("scheduling_group_members").select("group_id, team_id")
    : { data: [] as { group_id: string; team_id: string }[] }
  /** Which of THIS VIEWER'S teams sit inside each group they can see. */
  const scopeTeamsByGroup = new Map<string, string[]>()
  for (const m of groupMemberRows ?? []) {
    const list = scopeTeamsByGroup.get(m.group_id)
    if (list) list.push(m.team_id)
    else scopeTeamsByGroup.set(m.group_id, [m.team_id])
  }
  const scopeGroupIds = Array.from(scopeTeamsByGroup.keys())

  // ---- TRAINING -----------------------------------------------------------
  // Training keeps its own canonical identity. It is never turned into a
  // fixture and never given an opposition.
  const trainingQuery = options.includeTraining
    ? (() => {
        let q = supabase
          .from("training_sessions")
          .select("id, team_id, scheduling_group_id, club_id, session_date, start_time, venue_id, pitch_id, teams(display_name), scheduling_groups(display_tag), club_pitches(display_name)")
          .gte("session_date", window.startIso)
          .lte("session_date", window.endIso)
          .is("cancelled_at", null)
          .order("session_date", { ascending: window.order === "asc" })
          .limit(AGENDA_ROW_CAP)
        if (teamIds !== null) {
          // Team sessions OR the group sessions whose membership includes one
          // of this viewer's teams. Scoped in the QUERY, like every other read
          // on this page -- a group id the viewer has no team in never reaches
          // the browser to be filtered out of.
          const clauses = [`team_id.in.(${teamIds.join(",")})`]
          if (scopeGroupIds.length > 0) clauses.push(`scheduling_group_id.in.(${scopeGroupIds.join(",")})`)
          q = q.or(clauses.join(","))
        }
        return q
      })()
    : Promise.resolve({ data: [] as never[] })

  // ---- TOURNAMENTS --------------------------------------------------------
  // A tournament is a dated activity in its own right, not a set of fixtures.
  // It is read through tournament_participants, which since 20270605 is the one
  // canonical table of sides -- the host's and every visiting club's alike -- so
  // a club sees the festival it is ENTERED in and not merely the ones it runs.
  //
  // OVERLAP, NOT CONTAINMENT. A tournament occupies a span (event_date..ends_on),
  // and belongs in this window if the two overlap at all. Asking only whether
  // event_date falls inside would lose a festival that started on the 31st and
  // runs into the month being looked at -- which is exactly the view somebody
  // opens on the 1st.
  // A SURFACE ASKS FOR TOURNAMENTS, exactly as it asks for training. The Calendar and Home want the
  // whole of a club's dated activity; the FIXTURES list is specifically a list of matches -- its own
  // controls are home/away, opposition, match type and Add Result, none of which a tournament has --
  // so it opts out rather than being handed rows it would have to filter.
  const includeTournaments = options.includeTournaments ?? true
  const { data: participantRows } =
    !includeTournaments
      ? { data: [] as { tournament_id: string; team_id: string | null; club_id: string | null; age_group: string }[] }
      : teamIds !== null
      ? teamIds.length
        ? await supabase
            .from("tournament_participants")
            .select("tournament_id, team_id, club_id, age_group")
            .in("team_id", teamIds)
        : { data: [] as { tournament_id: string; team_id: string | null; club_id: string | null; age_group: string }[] }
      : await supabase.from("tournament_participants").select("tournament_id, team_id, club_id, age_group")

  // A TOURNAMENT THIS CLUB HOSTS IS THIS CLUB'S, whether or not it has entered a side. Read in the club's
  // own context only -- the host's Club Admin and Fixtures Secretary see the festival they are running on
  // its date; a team's staff and a family still see only what their own sides are entered in. A list of
  // MATCHES asks for games, and a host with no side has none of its own, so it is not asked.
  const { data: hostedRows } =
    includeTournaments && !options.tournamentGames && scope.kind === "club"
      ? await supabase
          .from("tournaments")
          .select("id")
          .eq("host_club_id", scope.clubId)
          .is("cancelled_at", null)
          .lte("event_date", window.endIso)
          .gte("ends_on", window.startIso)
      : { data: [] as { id: string }[] }
  const hostedTournamentIds = new Set((hostedRows ?? []).map((h) => h.id))

  const participantTournamentIds = Array.from(new Set([...(participantRows ?? []).map((p) => p.tournament_id), ...hostedTournamentIds]))
  const { data: tournamentRows } = participantTournamentIds.length
    ? await supabase
        .from("tournaments")
        .select(
          // `format` is read so a Calendar row can carry the competition's format accent. It is a fact
          // about the tournament, not a second kind of event: the row, its spacing, its cover and its
          // destination are identical whatever the format says.
          "id, name, event_date, ends_on, kickoff_time, ends_at, status, venue_id, pitch_id, cancelled_at, host_directory_id, cover_image_path, cover_stock_key, format"
        )
        .in("id", participantTournamentIds)
        .is("cancelled_at", null)
        .lte("event_date", window.endIso)
        .gte("ends_on", window.startIso)
        .order("event_date", { ascending: window.order === "asc" })
        .limit(AGENDA_ROW_CAP)
    : { data: [] }

  const [{ data: fixtures }, { data: training }] = await Promise.all([fixtureQuery, trainingQuery])

  const fixtureRows = fixtures ?? []
  const trainingRows = training ?? []
  const tournaments = tournamentRows ?? []
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]))

  // A LIST OF MATCHES READS THE GAMES THEMSELVES -- published, real, labelled by the server.
  type TournamentGameRow = {
    gameId: string
    tournamentId: string
    teamId: string
    date: string
    startTime: string | null
    pitchName: string | null
    stageLabel: string
    opponent: { clubName: string; label: string | null; crestPath: string | null } | null
    opponentDirectoryId: string | null
    ourScore: number | null
    theirScore: number | null
  }
  const gameRows: Map<string, TournamentGameRow[]> | null =
    options.tournamentGames && includeTournaments && teamIds !== null && teamIds.length > 0 && tournaments.length > 0
      ? await (async () => {
          const { data } = await supabase.rpc("get_tournament_fixture_rows", {
            p_team_ids: teamIds,
            p_from: window.startIso,
            p_to: window.endIso,
          })
          const byKey = new Map<string, TournamentGameRow[]>()
          for (const g of ((data ?? []) as unknown as TournamentGameRow[])) {
            const key = `${g.tournamentId}:${g.teamId}`
            byKey.set(key, [...(byKey.get(key) ?? []), g])
          }
          return byKey
        })()
      : options.tournamentGames
        ? new Map()
        : null

  // ---- WHICH DAYS A COMPETITION ACTUALLY PLAYS ON ---------------------------
  //
  // A tournament's DATE RANGE and a competition's ACTIVE DAYS are different facts. A festival running
  // Friday to Sunday may run its U12 competition on Friday and Sunday and its U16 on Saturday and
  // Sunday, and a U12 parent should not be told there is rugby on the Saturday.
  //
  // ONLY A PUBLISHED PLAN NARROWS ANYTHING. Before one exists the tournament occupies its declared
  // range, which is the honest answer: the organiser has not yet said which days this competition uses.
  // A DRAFT plan narrows nothing either -- it is the organiser's workings, and a parent's calendar must
  // not move because somebody is mid-way through arranging a day.
  const { data: planRows } = participantTournamentIds.length
    ? await supabase
        .from("tournament_plans")
        .select("id, tournament_id, age_group, publication_state, tournament_plan_days(day_date)")
        .in("tournament_id", participantTournamentIds)
        .eq("publication_state", "PUBLISHED")
    : { data: [] }
  /** `${tournamentId}:${ageGroup}` -> the days that competition plays, once its plan is published. */
  const publishedDaysByCompetition = new Map<string, string[]>()
  const publishedPlanIds: string[] = []
  const competitionByPlanId = new Map<string, string>()
  for (const plan of (planRows ?? []) as unknown as {
    id: string
    tournament_id: string
    age_group: string
    tournament_plan_days: { day_date: string }[] | null
  }[]) {
    const days = (plan.tournament_plan_days ?? []).map((d) => d.day_date).sort()
    if (days.length > 0) publishedDaysByCompetition.set(`${plan.tournament_id}:${plan.age_group}`, days)
    publishedPlanIds.push(plan.id)
    competitionByPlanId.set(plan.id, `${plan.tournament_id}:${plan.age_group}`)
  }

  /**
   * WHAT TIME A LATER DAY OF A FESTIVAL ACTUALLY STARTS.
   *
   * The tournament records one kick-off and one finish, which belong to its first day; repeating them
   * on the Sunday would state a time nobody set, so a later day used to show no time at all. That was
   * right while nothing better existed -- and a PUBLISHED plan is something better. Its games carry
   * real kick-offs, so each day's first kick-off and last finish are facts about that day rather than
   * a guess, and "--:--" against a day with four games on it helps nobody.
   *
   * Only PUBLISHED plans are read, so a draft still moves nothing on a parent's calendar.
   */
  const dayHoursByCompetitionDay = new Map<string, { start: string; end: string | null }>()
  if (publishedPlanIds.length > 0) {
    const { data: planGameRows } = await supabase
      .from("tournament_games")
      .select("plan_id, game_date, start_time, duration_minutes")
      .in("plan_id", publishedPlanIds)
      .not("start_time", "is", null)
    for (const row of (planGameRows ?? []) as unknown as {
      plan_id: string
      game_date: string
      start_time: string
      duration_minutes: number | null
    }[]) {
      const competition = competitionByPlanId.get(row.plan_id)
      if (!competition) continue
      const key = `${competition}:${row.game_date}`
      const start = String(row.start_time).slice(0, 5)
      const finish = addMinutes(start, row.duration_minutes ?? 0)
      const held = dayHoursByCompetitionDay.get(key)
      if (!held) dayHoursByCompetitionDay.set(key, { start, end: finish })
      else {
        dayHoursByCompetitionDay.set(key, {
          start: start < held.start ? start : held.start,
          end: !held.end || (finish && finish > held.end) ? finish : held.end,
        })
      }
    }
  }

  // WHO IS RUNNING IT, from the Club Directory -- the one canonical club identity, the same one a
  // fixture's unclaimed opposition is named by above.
  const hostDirectoryIds = Array.from(new Set(tournaments.map((t) => t.host_directory_id).filter((x): x is string => Boolean(x))))
  const { data: hostRows } = hostDirectoryIds.length
    ? await supabase.from("club_directory").select("id, name").in("id", hostDirectoryIds)
    : { data: [] }
  const hostNameById = new Map((hostRows ?? []).map((h) => [h.id, h.name]))

  // WHICH COMPETITION this viewer's side is entered in. A club bringing U12 and U13 to one festival
  // has two participant rows; the row drawn for a given team takes that team's own grade.
  const gradeByTournamentTeam = new Map<string, string>()
  for (const p of participantRows ?? []) {
    if (!p.team_id) continue
    gradeByTournamentTeam.set(`${p.tournament_id}:${p.team_id}`, p.age_group)
  }
  /** Which of THIS VIEWER'S teams are entered in each tournament. */
  const scopeTeamsByTournament = new Map<string, string[]>()
  for (const p of participantRows ?? []) {
    if (!p.team_id || !tournamentById.has(p.tournament_id)) continue
    const list = scopeTeamsByTournament.get(p.tournament_id)
    if (list) {
      if (!list.includes(p.team_id)) list.push(p.team_id)
    } else scopeTeamsByTournament.set(p.tournament_id, [p.team_id])
  }

  // ONE REAL MATCH, TWO ROWS -- see lib/fixtures/mirror-pair.ts for what a
  // mirror pair is and why this scope needs the set-aware rule rather than the
  // database's bare is_primary_mirror. The Agenda scopes by the viewer's own
  // teams, so it routinely holds one half of a pair without the other; the
  // strict lower-id rule would delete the viewer's own fixture whenever their
  // side happened to carry the higher id.
  const primaryFixtures = dedupeMirrorPairs(fixtureRows)

  // ---- IDENTITY: teams, clubs, crests, kits -------------------------------
  const involvedTeamIds = Array.from(
    new Set(
      [
        ...primaryFixtures.flatMap((f) => [f.owning_team_id, f.opponent_team_id]),
        ...trainingRows.map((t) => t.team_id),
        ...Array.from(scopeTeamsByTournament.values()).flat(),
      ].filter((x): x is string => Boolean(x))
    )
  )

  const { data: teamRows } = involvedTeamIds.length
    ? await supabase
        .from("teams")
        .select("id, display_name, rugby_code, club_id, clubs(id, directory_id, logo_storage_path, club_directory(id, name, logo_storage_path))")
        .in("id", involvedTeamIds)
    : { data: [] }
  const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]))

  const clubIds = Array.from(new Set((teamRows ?? []).map((t) => t.club_id).filter((x): x is string => Boolean(x))))
  const { data: kitRows } = clubIds.length
    ? await supabase
        .from("club_kits")
        .select("club_id, pattern, primary_colour, secondary_colour, accent_colour")
        .in("club_id", clubIds)
        .eq("variant", "primary")
    : { data: [] }
  const kitByClub = new Map(
    (kitRows ?? []).map((k) => [
      k.club_id,
      { pattern: k.pattern as KitConfig["pattern"], primaryColour: k.primary_colour, secondaryColour: k.secondary_colour, accentColour: k.accent_colour } as KitConfig,
    ])
  )

  // Unclaimed opposition: a directory row, never a fabricated club.
  const directoryIds = Array.from(new Set(primaryFixtures.map((f) => f.opponent_directory_id).filter((x): x is string => Boolean(x))))
  const { data: directoryRows } = directoryIds.length
    ? await supabase.from("club_directory").select("id, name, logo_storage_path").in("id", directoryIds)
    : { data: [] }
  const directoryById = new Map((directoryRows ?? []).map((d) => [d.id, d]))

  // Each side named as it stood in the FIXTURE'S OWN SEASON, so looking back
  // shows the age grade a child actually played, not what that cohort has
  // since become.
  const identities = await loadTeamIdentitiesForSeason(
    supabase,
    primaryFixtures.flatMap((f) =>
      f.season_id
        ? [
            { teamId: f.owning_team_id, seasonId: f.season_id as string },
            ...(f.opponent_team_id ? [{ teamId: f.opponent_team_id, seasonId: f.season_id as string }] : []),
          ]
        : []
    )
  )

  /*
    WHERE EACH THING IS, FROM THE ONE RULE. A match or a tournament can be at another club's ground,
    whose venue and pitch rows a visiting family cannot read -- so asking those tables directly said
    "Venue TBC" about a ground Match Centre names. `schedule_grounds` answers for every object the
    viewer can see. Training is always at the viewer's own club, whose venues they can read.
  */
  const trainingVenueIds = Array.from(new Set(trainingRows.map((t) => t.venue_id).filter((x): x is string => Boolean(x))))
  const [{ data: venueRows }, groundBySubject] = await Promise.all([
    trainingVenueIds.length
      ? supabase.from("venues").select("id, name").in("id", trainingVenueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    loadScheduleGrounds(supabase, { fixtureIds: primaryFixtures.map((f) => f.id), tournamentIds: tournaments.map((t) => t.id) }),
  ])
  const venueById = new Map((venueRows ?? []).map((v) => [v.id, v.name]))

  function sideFor(teamId: string | null, seasonId: string | null): AgendaSide | null {
    if (!teamId) return null
    const team = teamById.get(teamId)
    const club = team?.clubs
    const directory = club?.club_directory
    const identity = seasonId ? identities.get(teamIdentityKey(teamId, seasonId)) : null
    const seasonName = identity?.displayName ?? null
    return {
      directoryId: club?.directory_id ?? directory?.id ?? null,
      clubName: directory?.name ?? "Club",
      teamName: seasonName ?? team?.display_name ?? null,
      // The team's own canonical code. Never inferred from an age grade or a name.
      rugbyCode: team?.rugby_code ?? null,
      // The same season identity the display name comes from, in its short form.
      compactName: identity
        ? compactTeamLabel({
            category: identity.category,
            ageGroup: identity.ageGroup,
            gender: identity.gender,
            squadDesignation: identity.squadDesignation,
            // League runs Open Age, not numbered sides: without the code a League senior side was called
            // "Men's 1st" in the lanes and chips while its display name said "Men's Open Age".
            rugbyCode: team?.rugby_code ?? null,
          })
        : null,
      crestUrl: club
        ? resolveClubLogoUrl(supabase, {
            logo_storage_path: club.logo_storage_path,
            club_directory: directory ? { logo_storage_path: directory.logo_storage_path } : null,
          })
        : null,
      kit: team?.club_id ? (kitByClub.get(team.club_id) ?? null) : null,
    }
  }

  // ---- ATTENDANCE (family scope only) -------------------------------------
  // Only a person answering for somebody needs this, and only their own
  // linked players' rows are ever read.
  const playerIds = scope.kind === "family" ? Array.from(new Set(scope.children.map((c) => c.playerId))) : []
  const { data: attendanceRows } =
    playerIds.length > 0
      ? await supabase
          .from("player_fixture_attendance")
          .select("fixture_id, training_session_id, tournament_id, player_id, status")
          .in("player_id", playerIds)
      : { data: [] }
  const responseFor = (playerId: string, kind: AgendaItem["kind"], id: string) =>
    ((attendanceRows ?? []).find(
      (a) =>
        a.player_id === playerId &&
        (kind === "fixture" ? a.fixture_id === id : kind === "training" ? a.training_session_id === id : a.tournament_id === id)
    )?.status as AgendaItem["attendance"]) ?? null

  const items: AgendaItem[] = []

  /**
   * One fixture, read from OUR side.
   *
   * Home/away comes from canonical fixture semantics and is flipped when the
   * viewer's team is the opponent -- never inferred from venue text, which is
   * the mistake that makes an away fixture read as home the moment a club
   * hosts at a neutral ground.
   */
  function pushFixture(f: (typeof primaryFixtures)[number], ourTeamId: string, family: { playerId: string; firstName: string } | null) {
    const isOwning = f.owning_team_id === ourTeamId
    const theirTeamId = isOwning ? f.opponent_team_id : f.owning_team_id
    const us = sideFor(ourTeamId, f.season_id)
    if (!us) return

    let them = sideFor(theirTeamId, f.season_id)
    if (!them) {
      const dir = f.opponent_directory_id ? directoryById.get(f.opponent_directory_id) : null
      them = dir
        ? {
            directoryId: dir.id,
            clubName: dir.name,
            teamName: null,
            // A Club Directory entry is not an Ovalball team, so there is no
            // team row to ask which code it plays. Null rather than assumed.
            rugbyCode: null,
            compactName: null,
            crestUrl: resolveClubLogoUrl(supabase, { logo_storage_path: null, club_directory: { logo_storage_path: dir.logo_storage_path } }),
            kit: null,
          }
        : {
            directoryId: null,
            clubName: f.raw_opposition_text ?? "Opposition to be confirmed",
            teamName: null,
            compactName: null,
            // Free text typed by a fixture secretary. There is no team behind it.
            rugbyCode: null,
            crestUrl: null,
            kit: null,
          }
    }

    const homeAway = (isOwning
      ? f.home_away
      : f.home_away === "Home"
        ? "Away"
        : f.home_away === "Away"
          ? "Home"
          : f.home_away) as AgendaItem["homeAway"]

    // A result is shown only where BOTH canonical scores exist. A half-filled
    // scoreline is not a result, and inventing the missing half would be
    // fabricating one.
    const hasResult = fixtureHasResult(f)
    const ourIsHome = homeAway === "Home"
    const result = hasResult
      ? { ourScore: ourIsHome ? f.home_score! : f.away_score!, theirScore: ourIsHome ? f.away_score! : f.home_score! }
      : null

    items.push({
      key: `fixture:${f.id}:${family?.playerId ?? ourTeamId}`,
      kind: "fixture",
      eventId: f.id,
      date: f.kickoff_date,
      time: f.kickoff_time ? String(f.kickoff_time).slice(0, 5) : null,
      meetTime: f.meet_time ? String(f.meet_time).slice(0, 5) : null,
      us,
      them,
      // A fixture is named by its two sides, and runs for one afternoon.
      name: null,
      tournament: null,
      dayOfSpan: null,
      homeAway,
      venue: groundBySubject.get(f.id)?.name ?? f.venue_address ?? null,
      pitch: groundBySubject.get(f.id)?.pitchName ?? null,
      status: f.status,
      result,
      gameType: f.game_type ?? null,
      playerId: family?.playerId ?? null,
      childFirstName: family?.firstName ?? null,
      attendance: family ? responseFor(family.playerId, "fixture", f.id) : null,
      attendanceOpen: f.attendance_is_open ?? null,
      teamId: ourTeamId,
      clubId: teamById.get(ourTeamId)?.club_id ?? null,
      href: `/fixtures/${f.id}`,
    })
  }

  /**
   * ONE TOURNAMENT, ONE ROW PER DAY IT ACTUALLY OCCUPIES IN THIS WINDOW.
   *
   * A calendar is asked "what is happening on this date", and on the Sunday of a
   * weekend festival the answer is the festival. So a tournament running Saturday
   * to Monday produces three rows. They are not three events: they carry the same
   * `eventId`, the same Tournament Centre and the same attendance answer, and
   * `dayOfSpan` is what lets a row say so out loud.
   *
   * CLIPPED TO THE WINDOW, NOT TO THE TOURNAMENT. A three-day festival seen
   * through a one-week view that only contains its last day produces exactly that
   * one row -- still labelled "Day 3 of 3", because the day's number is a fact
   * about the tournament and not about the view.
   *
   * IT IS NOT GIVEN AN OPPOSITION, A HOME/AWAY OR A SCORE. A tournament has many
   * clubs in it; naming one of them as "them" would be inventing a fixture that
   * does not exist, and the host playing at its own ground does not make the day
   * a home match for everybody else.
   */
  /** "10:00" plus a game's length, for the finish of a day whose games are published. */
  function addMinutes(time: string, minutes: number): string {
    const [h, m] = time.split(":").map(Number)
    if (h === undefined || m === undefined) return time
    const total = (h * 60 + m + minutes) % (24 * 60)
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  }

  function pushTournamentGames(
    t: (typeof tournaments)[number],
    ourTeamId: string,
    family: { playerId: string; firstName: string } | null,
    us: AgendaSide | null
  ) {
    for (const g of gameRows?.get(`${t.id}:${ourTeamId}`) ?? []) {
      if (g.date < window.startIso || g.date > window.endIso) continue
      items.push({
        key: `tournament-game:${g.gameId}:${family?.playerId ?? ourTeamId}`,
        kind: "tournament",
        eventId: t.id,
        date: g.date,
        time: g.startTime ? String(g.startTime).slice(0, 5) : null,
        meetTime: null,
        us: us ?? { directoryId: null, clubName: "Club", teamName: null, compactName: null, rugbyCode: null, crestUrl: null, kit: null },
        // THE REAL OPPONENT IN THIS GAME -- not one of the festival's clubs picked to stand for it.
        them: g.opponent
          ? {
              directoryId: g.opponentDirectoryId,
              clubName: g.opponent.clubName,
              teamName: g.opponent.label,
              compactName: null,
              rugbyCode: null,
              crestUrl: g.opponent.crestPath ? clubLogoUrlFromPath(supabase, g.opponent.crestPath) : null,
              kit: null,
            }
          : null,
        name: t.name,
        tournament: {
          ageGroup: gradeByTournamentTeam.get(`${t.id}:${ourTeamId}`) ?? "",
          format: t.format ?? null,
          hostClubName: t.host_directory_id ? (hostNameById.get(t.host_directory_id) ?? null) : null,
          endTime: null,
          cover: resolveTournamentCover({ supabase, coverImagePath: t.cover_image_path, coverStockKey: t.cover_stock_key }),
        },
        tournamentGame: { id: g.gameId, stageLabel: g.stageLabel, tournamentName: t.name },
        dayOfSpan: null,
        homeAway: null,
        venue: groundBySubject.get(t.id)?.name ?? null,
        pitch: g.pitchName,
        status: t.status,
        result: g.ourScore !== null && g.theirScore !== null ? { ourScore: g.ourScore, theirScore: g.theirScore } : null,
        gameType: null,
        playerId: family?.playerId ?? null,
        childFirstName: family?.firstName ?? null,
        attendance: family ? responseFor(family.playerId, "tournament", t.id) : null,
        teamId: ourTeamId,
        clubId: teamById.get(ourTeamId)?.club_id ?? null,
        href: `/tournaments/result/${g.gameId}`,
      })
    }
  }

  function pushTournament(
    t: (typeof tournaments)[number],
    ourTeamId: string,
    family: { playerId: string; firstName: string } | null
  ) {
    const us = sideFor(ourTeamId, null)
    if (gameRows) {
      pushTournamentGames(t, ourTeamId, family, us)
      return
    }
    const grade = gradeByTournamentTeam.get(`${t.id}:${ourTeamId}`) ?? ""
    const publishedDays = publishedDaysByCompetition.get(`${t.id}:${grade}`) ?? null

    // THE DAYS THIS ROW OCCUPIES. A published plan says which of the tournament's days this
    // competition uses; without one the tournament's whole range stands.
    const span = publishedDays ?? datesInclusive(t.event_date, t.ends_on)
    const totalDays = span.length
    const shown = span.filter((d) => d >= window.startIso && d <= window.endIso)

    for (const date of shown) {
      // DAY N OF M COUNTS THIS COMPETITION'S OWN DAYS once a plan says what they are -- "Day 2 of 2"
      // for a competition playing Friday and Sunday of a three-day festival, because the Saturday is
      // not one of its days at all.
      const dayNumber = span.indexOf(date) + 1
      const dayHours = dayHoursByCompetitionDay.get(`${t.id}:${grade}:${date}`) ?? null
      items.push({
        key: `tournament:${t.id}:${date}:${family?.playerId ?? ourTeamId}`,
        kind: "tournament",
        eventId: t.id,
        date,
        // THE DAY'S OWN HOURS WHERE A PUBLISHED PLAN STATES THEM, the tournament's recorded kick-off
        // on day one otherwise, and nothing at all when neither is known -- in that order, because a
        // real first kick-off beats a repeated one and a repeated one is worse than silence.
        time:
          dayHours?.start ??
          (dayNumber === 1 && t.kickoff_time ? String(t.kickoff_time).slice(0, 5) : null),
        meetTime: null,
        us: us ?? {
          directoryId: null,
          clubName: "Club",
          teamName: null,
          compactName: null,
          rugbyCode: null,
          crestUrl: null,
          kit: null,
        },
        them: null,
        name: t.name,
        tournament: {
          ageGroup: gradeByTournamentTeam.get(`${t.id}:${ourTeamId}`) ?? "",
          // THE COMPETITION'S FORMAT, so a row can show the agreed accent for a cup. Nothing else
          // about the row changes: a knockout is still one tournament, one row per day it occupies.
          format: t.format ?? null,
          hostClubName: t.host_directory_id ? (hostNameById.get(t.host_directory_id) ?? null) : null,
          endTime: dayHours?.end ?? (dayNumber === 1 && t.ends_at ? String(t.ends_at).slice(0, 5) : null),
          // THE SAME SELECTION THE LIST CARD AND THE DETAIL HERO SHOW. One photograph per tournament,
          // resolved once here; the client decides how to draw `stock` and `none`.
          cover: resolveTournamentCover({
            supabase,
            coverImagePath: t.cover_image_path,
            coverStockKey: t.cover_stock_key,
          }),
        },
        dayOfSpan: totalDays > 1 ? { day: dayNumber, of: totalDays } : null,
        homeAway: null,
        venue: groundBySubject.get(t.id)?.name ?? null,
        pitch: groundBySubject.get(t.id)?.pitchName ?? null,
        status: t.status,
        // A tournament has no single scoreline. Its games have their own.
        result: null,
        gameType: null,
        playerId: family?.playerId ?? null,
        childFirstName: family?.firstName ?? null,
        // ONE ANSWER, repeated on each day's row because it is the same answer.
        attendance: family ? responseFor(family.playerId, "tournament", t.id) : null,
        teamId: ourTeamId,
        clubId: teamById.get(ourTeamId)?.club_id ?? null,
        // THE CANONICAL TOURNAMENT CENTRE, addressed by the tournament's own id --
        // the same one surface every viewer reads, never a role-named variant.
        href: `/tournaments/${t.id}`,
      })
    }
  }

  /**
   * THE FESTIVAL A CLUB IS RUNNING WITHOUT A SIDE IN IT: one row per day, in the club's own name. Its
   * days and hours are the union of its published competitions' -- a competition's draft moves nothing
   * here either -- and the tournament's own range and kick-off before anything is published.
   */
  function pushHostedTournament(t: (typeof tournaments)[number], host: AgendaSide) {
    const competitions = [...publishedDaysByCompetition.entries()].filter(([key]) => key.startsWith(`${t.id}:`))
    const publishedDays = competitions.length > 0 ? [...new Set(competitions.flatMap(([, d]) => d))].sort() : null
    const span = publishedDays ?? datesInclusive(t.event_date, t.ends_on)
    const totalDays = span.length
    for (const date of span.filter((d) => d >= window.startIso && d <= window.endIso)) {
      const dayNumber = span.indexOf(date) + 1
      let start: string | null = null
      let end: string | null = null
      for (const [key, hours] of dayHoursByCompetitionDay) {
        if (!key.startsWith(`${t.id}:`) || !key.endsWith(`:${date}`)) continue
        if (!start || hours.start < start) start = hours.start
        if (hours.end && (!end || hours.end > end)) end = hours.end
      }
      items.push({
        key: `tournament:${t.id}:${date}:host`,
        kind: "tournament",
        eventId: t.id,
        date,
        time: start ?? (dayNumber === 1 && t.kickoff_time ? String(t.kickoff_time).slice(0, 5) : null),
        meetTime: null,
        us: host,
        them: null,
        name: t.name,
        tournament: {
          ageGroup: "",
          format: t.format ?? null,
          hostClubName: t.host_directory_id ? (hostNameById.get(t.host_directory_id) ?? null) : null,
          endTime: end ?? (dayNumber === 1 && t.ends_at ? String(t.ends_at).slice(0, 5) : null),
          cover: resolveTournamentCover({ supabase, coverImagePath: t.cover_image_path, coverStockKey: t.cover_stock_key }),
        },
        dayOfSpan: totalDays > 1 ? { day: dayNumber, of: totalDays } : null,
        homeAway: null,
        venue: groundBySubject.get(t.id)?.name ?? null,
        pitch: groundBySubject.get(t.id)?.pitchName ?? null,
        status: t.status,
        result: null,
        gameType: null,
        playerId: null,
        childFirstName: null,
        attendance: null,
        teamId: "",
        clubId: scope.kind === "club" ? scope.clubId : null,
        href: `/tournaments/${t.id}`,
      })
    }
  }

  function pushTraining(
    t: (typeof trainingRows)[number],
    family: { playerId: string; firstName: string } | null,
    viewerTeamId: string | null
  ) {
    // A training session belongs to EITHER a team or a scheduling group.
    //
    // The group case was previously skipped -- honestly, and recorded as a gap,
    // because listing it once per component team without knowing who was
    // actually invited would have been worse than omitting it. Training Centre
    // is where that gap was owed, and this is it: the group resolves through
    // scheduling_group_members to the teams it contains, which is the same
    // participation model the canonical training RPCs already use.
    //
    // `viewerTeamId` is the caller's own team inside the group -- the child's
    // team for a guardian, a scoped team for staff. It is used to draw the
    // crest and to key the row. It is NOT the session's identity: the session
    // is t.id, once, however many teams train in it.
    const teamId = t.team_id ?? viewerTeamId
    if (!teamId) return
    const us = sideFor(teamId, null)
    // A group session is named by the group, because "Mini-Rugby Saturday" is
    // what it is. Only the crest and scope come from the viewer's own team.
    const groupTag = t.scheduling_groups?.display_tag ?? null
    items.push({
      key: `training:${t.id}:${family?.playerId ?? teamId}`,
      kind: "training",
      eventId: t.id,
      date: t.session_date,
      time: t.start_time ? String(t.start_time).slice(0, 5) : null,
      meetTime: null,
      us: us
        ? { ...us, teamName: groupTag ?? us.teamName }
        : {
            directoryId: null,
            clubName: "Club",
            teamName: groupTag ?? t.teams?.display_name ?? null,
            compactName: null,
            rugbyCode: null,
            crestUrl: null,
            kit: null,
          },
      // Training has no opposition, and is never given a fake one.
      them: null,
      // A session is named by its team or its scheduling group, and runs for one evening.
      name: null,
      tournament: null,
      dayOfSpan: null,
      homeAway: null,
      venue: (t.venue_id ? venueById.get(t.venue_id) : null) ?? t.club_pitches?.display_name ?? null,
      pitch: t.club_pitches?.display_name ?? null,
      status: null,
      result: null,
      // A session is not a match and has no match type.
      gameType: null,
      playerId: family?.playerId ?? null,
      childFirstName: family?.firstName ?? null,
      attendance: family ? responseFor(family.playerId, "training", t.id) : null,
      teamId,
      clubId: t.club_id ?? null,
      // THE CANONICAL TRAINING CENTRE, addressed by the session's own id.
      // Never by team, date, venue or the recurrence that generated it -- this
      // is the same id the Scheduler materialised and the same one the page
      // reads, so the three cannot describe different sessions.
      href: `/training/${t.id}`,
    })
  }

  if (scope.kind === "family") {
    for (const child of scope.children) {
      for (const f of primaryFixtures) {
        if (f.owning_team_id !== child.teamId && f.opponent_team_id !== child.teamId) continue
        pushFixture(f, child.teamId, { playerId: child.playerId, firstName: child.firstName })
      }
      for (const t of trainingRows) {
        // Their own team's session, or a group session their team is in.
        const inGroup =
          t.scheduling_group_id !== null && (scopeTeamsByGroup.get(t.scheduling_group_id)?.includes(child.teamId) ?? false)
        if (t.team_id !== child.teamId && !inGroup) continue
        pushTraining(t, { playerId: child.playerId, firstName: child.firstName }, child.teamId)
      }
      for (const t of tournaments) {
        if (!(scopeTeamsByTournament.get(t.id)?.includes(child.teamId) ?? false)) continue
        pushTournament(t, child.teamId, { playerId: child.playerId, firstName: child.firstName })
      }
    }
  } else {
    const scopeTeams = new Set(teamIds ?? [])
    for (const f of primaryFixtures) {
      // Whichever side is in scope is "us". For platform scope there is no
      // team filter, so the owning side is used -- the fixture's own author.
      const ourTeamId =
        teamIds === null
          ? f.owning_team_id
          : scopeTeams.has(f.owning_team_id)
            ? f.owning_team_id
            : f.opponent_team_id && scopeTeams.has(f.opponent_team_id)
              ? f.opponent_team_id
              : null
      if (!ourTeamId) continue
      pushFixture(f, ourTeamId, null)
    }
    for (const t of trainingRows) {
      // ONE ROW PER SESSION, not one per component team. A group session is a
      // single occurrence with a single id; listing a club admin's Mini-Rugby
      // Saturday four times because four teams are in it would be describing
      // one session as four.
      const viewerTeamId =
        t.team_id ??
        (t.scheduling_group_id ? (scopeTeamsByGroup.get(t.scheduling_group_id)?.[0] ?? null) : null)
      pushTraining(t, null, viewerTeamId)
    }
    for (const t of tournaments) {
      // ONE ROW PER ENTERED SIDE, which is the rule the website's Calendar already
      // settled: "a club taking U12 and U13 to the same festival gets a row in each
      // team's lane -- both carrying the SAME tournament id, so opening either one
      // lands on the same Tournament Centre".
      //
      // THE ALTERNATIVE WAS MEASURABLY WRONG. Drawing one row and letting the first
      // entered team carry it told a club administrator, on a real festival with a
      // U12 and a U16 side in it, that their club was at a "Tournament . U16" --
      // because the age group is a fact about the SIDE, not about the day. A club
      // bringing two age groups has two things to organise, and the calendar is
      // where it finds that out.
      //
      // It is still ONE tournament: same eventId, same Centre, same attendance
      // answer per player. Only the lane and the grade differ.
      for (const ourTeamId of scopeTeamsByTournament.get(t.id) ?? []) {
        pushTournament(t, ourTeamId, null)
      }
    }
    // A FESTIVAL THE CLUB HOSTS WITH NO SIDE OF ITS OWN IN IT. Where it has entered a side the rows above
    // already carry it, so this never draws the same festival twice.
    const hosted = tournaments.filter((t) => hostedTournamentIds.has(t.id) && (scopeTeamsByTournament.get(t.id)?.length ?? 0) === 0)
    if (hosted.length > 0 && scope.kind === "club") {
      const { data: club } = await supabase
        .from("clubs")
        .select("id, logo_storage_path, club_directory(id, name, logo_storage_path)")
        .eq("id", scope.clubId)
        .maybeSingle()
      const directory = (club as unknown as { club_directory: { id: string; name: string; logo_storage_path: string | null } | null } | null)?.club_directory ?? null
      const crestPath = (club as unknown as { logo_storage_path: string | null } | null)?.logo_storage_path ?? directory?.logo_storage_path ?? null
      const host: AgendaSide = {
        directoryId: directory?.id ?? null,
        clubName: directory?.name ?? "Club",
        teamName: null,
        compactName: null,
        rugbyCode: null,
        crestUrl: crestPath ? clubLogoUrlFromPath(supabase, crestPath) : null,
        kit: kitByClub.get(scope.clubId) ?? null,
      }
      for (const t of hosted) pushHostedTournament(t, host)
    }
  }

  // One stable chronological order, secondary-sorted on time then team so two
  // fixtures at the same minute do not swap places between renders.
  items.sort((a, b) => {
    if (a.date !== b.date) return window.order === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    const at = a.time ?? "99:99"
    const bt = b.time ?? "99:99"
    if (at !== bt) return at.localeCompare(bt)
    return a.key.localeCompare(b.key)
  })

  return {
    items,
    // Measured on what the DATABASE returned, not on what survived -- if the
    // query came back full there may be more beyond it, whatever dedupe and
    // scoping then removed. Recorded here rather than derived from items.length,
    // which counts one row per child in a family scope and would report a
    // truncation that never happened.
    truncated: fixtureRows.length >= AGENDA_ROW_CAP || trainingRows.length >= AGENDA_ROW_CAP || tournaments.length >= AGENDA_ROW_CAP,
  }
}

/**
 * Whole days from one ISO date to another, counting both ends: the 4th to the
 * 6th is three days, and the 4th to the 4th is one.
 *
 * Done in UTC on purpose. These are plain calendar dates with no time and no
 * zone -- `tournaments.event_date` is a `date` column -- and parsing them as
 * local times is what makes a festival shift a day for a viewer in a timezone
 * behind UTC.
 */
function daysBetweenInclusive(startIso: string, endIso: string): number {
  const start = Date.UTC(Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)) - 1, Number(startIso.slice(8, 10)))
  const end = Date.UTC(Number(endIso.slice(0, 4)), Number(endIso.slice(5, 7)) - 1, Number(endIso.slice(8, 10)))
  return Math.floor((end - start) / 86_400_000) + 1
}

/** Every ISO date from `startIso` to `endIso`, inclusive. Empty if the range is inverted. */
function datesInclusive(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const end = Date.UTC(Number(endIso.slice(0, 4)), Number(endIso.slice(5, 7)) - 1, Number(endIso.slice(8, 10)))
  let cursor = Date.UTC(Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)) - 1, Number(startIso.slice(8, 10)))
  while (cursor <= end) {
    out.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += 86_400_000
  }
  return out
}
