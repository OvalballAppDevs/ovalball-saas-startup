import Link from "next/link"
import { CalendarHeart, Dumbbell } from "lucide-react"

import { describeWeek, weekStartLabel, type SeasonMonth, type SeasonWeek } from "@/lib/calendar/season-grid"
import { cn } from "@/lib/utils"

/**
 * OUR RUGBY YEAR, ON ONE PAGE.
 *
 * THE GRID IS HIGH-LEVEL AND THE DETAIL IS IN A PANEL. A season is forty-odd
 * weeks; showing every fixture inline turns "what does our year look like"
 * into a scroll. So each week is one cell -- its number, its date and a mark
 * for what is on -- and opening a week shows everything in it.
 *
 * MONTHS ARE ROWS, AND THEY CARRY THE PHASE. "September 2026 / Regular Season"
 * tells a reader where they are in the season's own structure, which a bare
 * month name cannot. The phase comes from the canonical season register --
 * pre_season_starts_on and starts_on -- never from an assumed cutoff.
 *
 * NEVER COLOUR ALONE, AND NEVER RED. Home is a filled disc, away is a ring,
 * training is a dumbbell: the shapes differ before the colours do, and every
 * cell carries a full sentence as its accessible name. Away deliberately does
 * NOT borrow the reference design's red — red is reserved across Ovalball for
 * cancelled, error and danger, and an away fixture is none of those. It is the
 * same forest green as home, drawn hollow: the club's colour, not at home.
 *
 * CURRENT WEEK AND SELECTED WEEK ARE DIFFERENT THINGS. Today's week is a fact
 * about the calendar and is marked with a ring it never loses; the open week
 * is a fact about what you are doing and is marked with a fill. A week can be
 * both at once, which is exactly why they cannot share a treatment.
 *
 * SELECTION LIVES IN THE URL, so a week is linkable, Back closes the panel,
 * and the whole grid stays a server component costing no JavaScript.
 */

export interface SeasonGridProps {
  months: SeasonMonth[]
  todayIso: string
  /** The week whose detail panel is open, or null. */
  selectedWeek: string | null
  /** Builds the href that opens (or closes) a week, preserving filters. */
  weekHref: (startIso: string | null) => string
  /**
   * The canonical season start. Weeks before it are pre-season -- read from
   * the season register, so a club whose pre-season starts in January is
   * labelled from its own record rather than from a hardcoded August.
   */
  seasonStartsOnIso: string | null
  /**
   * The CANONICAL period bounds, for the empty state to name.
   *
   * Deliberately not derived from the rendered weeks: the grid is aligned to
   * Mondays and so reaches back before the period starts and on past its end.
   * Naming those edges would tell a person their pre-season runs 27 July to
   * 6 September when the register says 1 to 31 August -- a second, wrong
   * answer to a question the canonical season register already answers.
   */
  periodStartIso: string
  periodEndIso: string
  /** What this period is called in a sentence: the season, or its pre-season. */
  periodNoun: string
}

export function SeasonGrid({ months, todayIso, selectedWeek, weekHref, seasonStartsOnIso, periodStartIso, periodEndIso, periodNoun }: SeasonGridProps) {
  if (months.length === 0) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white px-5 py-12 text-center">
        <p className="font-display text-lg text-ink">No season to show</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">
          This season has no dates recorded yet, so there is no year to lay out. A Site Admin sets season dates in Site Admin → Seasons.
        </p>
      </div>
    )
  }

  const totals = seasonTotals(months)

  // A SEASON WITH NOTHING IN IT IS ONE ANSWER, NOT FORTY WEEKS OF THEM.
  if (totals.events === 0) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white px-5 py-12 text-center">
        <p className="font-display text-lg text-ink">Nothing scheduled in {periodNoun}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">
          No matches or training sessions have been booked between {formatBound(periodStartIso)} and {formatBound(periodEndIso)}. As your club books
          them, they will appear here.
        </p>
      </div>
    )
  }

  return (
    <section aria-labelledby="season-grid-heading" className="overflow-hidden rounded-2xl border border-ink/8 bg-white">
      {/* The months are h3s; without this the page would step from the "Calendar"
          h1 straight to h3 and a screen-reader outline would lose a level. It is
          not shown because the grid's own legend and month names already say
          what it is to a sighted reader. */}
      <h2 id="season-grid-heading" className="sr-only">
        Season Overview
      </h2>
      <SeasonGridLegend totals={totals} />

      {/* TWO MONTHS ABREAST ON A WIDE SCREEN.
          A month holds four or five weeks, which filled less than half the
          content width and left the other half blank -- a ten-row ladder down
          a mostly-empty page, which is what made the season read as
          fragmented rather than as a year. Two columns fill the width and
          halve the run without making any single cell bigger. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {months.map((month, i) => (
          <section
            key={month.key}
            aria-labelledby={`season-${month.key}`}
            className={cn(
              "flex items-start gap-4 border-ink/6 px-5 py-3.5",
              // Hairlines between, never around: the container already has an
              // edge, and a border on every cell would draw a table.
              i < months.length - 1 && "border-b",
              i % 2 === 0 && "lg:border-r",
              // On two columns the last row's underline is the container's own.
              months.length % 2 === 0 ? "lg:[&:nth-last-child(-n+2)]:border-b-0" : "lg:last:border-b-0"
            )}
          >
            <div className="w-24 shrink-0 pt-1.5">
              <h3 id={`season-${month.key}`} className="font-display text-[15px] leading-none text-ink">
                {month.label} {month.year}
              </h3>
              {/* THE PHASE, ONLY WHERE IT CHANGES. Repeating "Regular Season"
                  down ten consecutive rows is noise; naming it once, at the
                  month the season actually turns over, is information. */}
              {phaseChangesAt(months, i, seasonStartsOnIso) && (
                <p className="mt-1.5 text-xs font-medium text-forest-800">{phaseLabelFor(month, seasonStartsOnIso)}</p>
              )}
            </div>
            <ul className="grid flex-1 grid-cols-5 gap-1.5">
              {month.weeks.map((week) => (
                <li key={week.startIso}>
                  <WeekCell
                    week={week}
                    isThisWeek={week.startIso <= todayIso && todayIso <= week.endIso}
                    isSelected={week.startIso === selectedWeek}
                    href={weekHref(week.startIso === selectedWeek ? null : week.startIso)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}

/** True for the first month, and for any month whose phase differs from the one before it. */
function phaseChangesAt(months: SeasonMonth[], i: number, seasonStartsOnIso: string | null): boolean {
  const here = phaseLabelFor(months[i], seasonStartsOnIso)
  if (!here) return false
  if (i === 0) return true
  return here !== phaseLabelFor(months[i - 1], seasonStartsOnIso)
}

/**
 * Which phase of the season this month sits in.
 *
 * Derived from the canonical season start: months whose last week still ends
 * before it are pre-season. A season with no recorded start gets no phase
 * label at all rather than an assumed one.
 */
function phaseLabelFor(month: SeasonMonth, seasonStartsOnIso: string | null): string {
  if (!seasonStartsOnIso) return ""
  const lastWeek = month.weeks[month.weeks.length - 1]
  if (!lastWeek) return ""
  return lastWeek.endIso < seasonStartsOnIso ? "Pre-Season" : "Regular Season"
}

/**
 * One week, as a cell.
 *
 * Number and date, then what is on. Deliberately compact: the cell answers "is
 * there anything on, and roughly what", and the panel answers everything else.
 *
 * IT HAS TO FEEL PRESSABLE. A grid of forty flat squares reads as a chart, not
 * as forty controls, so a populated cell sits on a hairline of shadow, lifts
 * on hover and settles on press. A clear week stays flat and quiet: it is
 * still openable, but it is not inviting you anywhere.
 */
function WeekCell({ week, isThisWeek, isSelected, href }: { week: SeasonWeek; isThisWeek: boolean; isSelected: boolean; href: string }) {
  const { day, month } = weekStartLabel(week.startIso)
  const matches = week.homeMatches + week.awayMatches + week.undecidedMatches

  return (
    <Link
      href={href}
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Week ${week.weekNumber}. ${describeWeek(week)}${isThisWeek ? " — this week" : ""}`}
      className={cn(
        "group relative flex w-full flex-col items-center gap-1 rounded-xl border px-1 pt-2 pb-1.5",
        "outline-none transition-[transform,box-shadow,background-color,border-color] duration-100",
        "focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none",
        "active:translate-y-px active:shadow-none",
        isSelected
          ? "border-forest-950 bg-forest-950 text-chalk shadow-[0_2px_8px_rgba(7,28,20,0.28)]"
          : week.isRest
            ? // CALM, NOT BROKEN. A clear week is a flat neutral surface, not a
              // dashed wireframe placeholder -- forty-one of those made a
              // perfectly normal season look unfinished.
              "border-transparent bg-chalk text-ink-subtle hover:border-ink/10 hover:bg-ink/[0.045]"
            : "border-ink/10 bg-white text-ink shadow-[0_1px_0_0_rgba(16,21,18,0.05)] hover:-translate-y-px hover:border-ink/20 hover:shadow-[0_3px_8px_rgba(16,21,18,0.08)]",
        // Today's week keeps its ring in every state, including selected.
        isThisWeek && (isSelected ? "ring-2 ring-pitch-400 ring-offset-1" : "border-pitch-600/60 ring-2 ring-pitch-600/25")
      )}
    >
      <span className={cn("text-[11px] leading-none font-semibold tabular-nums", isSelected ? "text-chalk" : "text-ink")}>W{week.weekNumber}</span>
      <span className={cn("text-[10px] leading-none tabular-nums", isSelected ? "text-chalk/65" : "text-ink-subtle")}>
        {day} {month.slice(0, 3)}
      </span>

      {/* WHAT IS ON, WITH ITS QUANTITY. A mark alone could not tell two
          matches from five, and a bare number could not tell two matches from
          two training sessions, so each kind present shows its own mark and
          its own count. */}
      <span aria-hidden="true" className="mt-0.5 flex min-h-[1.125rem] flex-col items-center justify-center gap-0.5">
        {week.isRest ? (
          <span className={cn("h-px w-3 rounded-full", isSelected ? "bg-chalk/30" : "bg-ink/15")} />
        ) : (
          <span className="flex items-center justify-center gap-1.5">
            {matches > 0 && (
              <span className={cn("inline-flex items-center gap-1 text-[10px] leading-none font-semibold tabular-nums", isSelected ? "text-chalk" : "text-ink")}>
                <span className="flex items-center gap-px">
                  {week.homeMatches > 0 && <span className={cn("size-2 rounded-full", isSelected ? "bg-pitch-400" : "bg-forest-800")} />}
                  {week.awayMatches > 0 && (
                    <span className={cn("size-2 rounded-full border-[1.5px]", isSelected ? "border-chalk/80" : "border-forest-800")} />
                  )}
                  {week.undecidedMatches > 0 && (
                    <span className={cn("size-2 rounded-full border-[1.5px] border-dashed", isSelected ? "border-amber-200" : "border-amber-500")} />
                  )}
                </span>
                {matches}
              </span>
            )}
            {week.trainingSessions > 0 && (
              <span className={cn("inline-flex items-center gap-0.5 text-[10px] leading-none font-semibold tabular-nums", isSelected ? "text-chalk/85" : "text-ink-muted")}>
                <Dumbbell className="size-2.5" strokeWidth={2.75} />
                {week.trainingSessions}
              </span>
            )}
            {week.clubEvents > 0 && (
              <span className={cn("inline-flex items-center gap-0.5 text-[10px] leading-none font-semibold tabular-nums", isSelected ? "text-chalk/85" : "text-[#6d3b5d]")}>
                <CalendarHeart className="size-2.5" strokeWidth={2.75} />
                {week.clubEvents}
              </span>
            )}
          </span>
        )}
      </span>
    </Link>
  )
}

/**
 * The legend.
 *
 * A cell language has to be taught once, and only the marks this season
 * actually uses: a player whose season holds nothing but training was being
 * taught the home and away marks in order to go and not find them.
 */
function SeasonGridLegend({ totals }: { totals: ReturnType<typeof seasonTotals> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink/6 bg-chalk px-5 py-3 text-xs text-ink-muted">
      {totals.home > 0 && (
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full bg-forest-800" /> Home Match
        </li>
      )}
      {totals.away > 0 && (
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-forest-800" /> Away Match
        </li>
      )}
      {totals.undecided > 0 && (
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-dashed border-amber-500" /> Venue To Be Confirmed
        </li>
      )}
      {totals.training > 0 && (
        <li className="inline-flex items-center gap-2">
          <Dumbbell className="size-3" aria-hidden="true" strokeWidth={2.75} /> Training
        </li>
      )}
      {totals.clubEvents > 0 && (
        <li className="inline-flex items-center gap-2">
          <CalendarHeart className="size-3 text-[#6d3b5d]" aria-hidden="true" strokeWidth={2.75} /> Club Event
        </li>
      )}
      <li className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="h-px w-3 rounded-full bg-ink/15" /> No Events
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="size-2.5 rounded-full ring-2 ring-pitch-600/70" /> Current Week
      </li>
    </ul>
  )
}

/** Season-wide totals. The cells show shape; these give it a scale. */
function seasonTotals(months: SeasonMonth[]) {
  let home = 0
  let away = 0
  let undecided = 0
  let training = 0
  let restWeeks = 0
  let weeks = 0
  // CLUB EVENTS ARE COUNTED ONCE PER SEASON, NOT ONCE PER WEEK THEY TOUCH.
  //
  // A week's own `clubEvents` is already deduped within that week, but summing
  // those counts would make a seven-day Centenary Week that straddles two
  // weeks read as two events. The season total therefore collects the ids
  // themselves -- the same reason the week count exists: what is happening,
  // never how many squares it covers.
  const eventIds = new Set<string>()
  for (const m of months) {
    for (const w of m.weeks) {
      weeks += 1
      home += w.homeMatches
      away += w.awayMatches
      undecided += w.undecidedMatches
      training += w.trainingSessions
      for (const e of w.events) if (e.kind === "event") eventIds.add(e.id)
      if (w.isRest) restWeeks += 1
    }
  }
  const events = eventIds.size
  return { home, away, undecided, training, clubEvents: events, restWeeks, weeks, matches: home + away + undecided, events: home + away + undecided + training + events }
}

function formatBound(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

/**
 * THE SEASON IN FIGURES.
 *
 * The grid answers "when"; this answers "how much", which is the question a
 * person actually arrives with -- how many home games to host, how far the
 * travel runs, how many weeks are clear. It used to be one long sentence with
 * a bracketed aside inside it, which is a hard shape to read a number out of.
 *
 * IT COUNTS WHAT IS ON SCREEN. Every figure is derived from the same
 * authorised, filtered grid beneath it, so it can never disagree with what the
 * reader can see -- and when a filter is applied it says so, because "7
 * Matches" means something different under "Home" than under "All Events".
 *
 * Only figures the data actually supports are shown. A season with no away
 * fixtures does not get an "0 Away" tile inviting the reader to wonder whether
 * that is a gap in the data or a gap in the fixture list.
 */
export function SeasonSummary({ months, filtered }: { months: SeasonMonth[]; filtered: boolean }) {
  const t = seasonTotals(months)
  if (t.events === 0) return null

  const stats: { value: number; label: string }[] = []
  if (t.matches > 0) stats.push({ value: t.matches, label: t.matches === 1 ? "Match" : "Matches" })
  if (t.home > 0) stats.push({ value: t.home, label: "Home" })
  if (t.away > 0) stats.push({ value: t.away, label: "Away" })
  if (t.undecided > 0) stats.push({ value: t.undecided, label: "To Confirm" })
  if (t.training > 0) stats.push({ value: t.training, label: t.training === 1 ? "Training Session" : "Training Sessions" })
  if (t.clubEvents > 0) stats.push({ value: t.clubEvents, label: t.clubEvents === 1 ? "Club Event" : "Club Events" })
  if (t.restWeeks > 0) stats.push({ value: t.restWeeks, label: t.restWeeks === 1 ? "Clear Week" : "Clear Weeks" })

  return (
    <section aria-label={filtered ? "Filtered Season Summary" : "Season Summary"} className="rounded-2xl border border-ink/8 bg-white px-5 py-4">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle uppercase">{filtered ? "Matching These Filters" : "This Season"}</p>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dd className="font-display text-2xl leading-none text-ink tabular-nums">{s.value}</dd>
            <dt className="mt-1 text-xs text-ink-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}
