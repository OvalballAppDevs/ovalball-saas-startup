import type { AgendaItem } from "@/lib/agenda/load"
import type { AgendaMonthGroup } from "@/lib/agenda/filters"
import { cn } from "@/lib/utils"

import { ActivityCard } from "./activity-card"

/**
 * THE RUGBY DIARY.
 *
 * A chronological spine rather than a pile of cards. The month is the strong
 * marker, the day hangs off it, and each activity sits against that day. What
 * this buys over a flat list is the thing the page exists to answer -- WHERE
 * AM I IN TIME -- readable by scanning one column rather than by reading every
 * card's date line.
 *
 * The spine is drawn ONCE per month, behind the date blocks, rather than as a
 * rule inside each day's row -- that produced a stub per day with the flex gap
 * breaking it between them, which is tick marks rather than a spine. It is
 * what makes two fixtures on the same Saturday visibly one Saturday, which a
 * repeated date line never quite does.
 *
 * MONTH HEADERS ARE STRONG BUT SHORT. A full-width banner per month is
 * pleasant on a desktop mock and eats a third of a phone screen; this is one
 * line of display type plus a count, sticky so the month you are inside stays
 * named while you scroll past it.
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dayParts(iso: string): { weekday: string; day: number } {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return { weekday: WEEKDAY[dt.getUTCDay()], day: d }
}

interface DayGroup {
  date: string
  items: AgendaItem[]
}

function byDay(items: AgendaItem[]): DayGroup[] {
  const out: DayGroup[] = []
  const index = new Map<string, DayGroup>()
  for (const item of items) {
    let g = index.get(item.date)
    if (!g) {
      g = { date: item.date, items: [] }
      index.set(item.date, g)
      out.push(g)
    }
    g.items.push(item)
  }
  return out
}

export function AgendaTimeline({
  months,
  todayIso,
  showChild,
  attentionKeys,
}: {
  months: AgendaMonthGroup[]
  todayIso: string
  showChild: boolean
  /**
   * Keys of activities this viewer still owes an answer on. A set rather than a
   * predicate so the timeline holds no rule about WHO owes what -- the page
   * decides that once, from the scope, and this only draws it.
   */
  attentionKeys?: Set<string>
}) {
  return (
    <div className="flex flex-col gap-8">
      {months.map((month) => (
        <section key={month.key} aria-labelledby={`month-${month.key}`}>
          {/*
            STUCK BELOW THE APP BAR, NOT UNDER IT.
            The mobile app bar (app-mobile-nav.tsx) is `sticky top-0 z-40` and
            69px tall. This header was also `top-0`, at z-10 -- so when it
            stuck, it sat entirely inside the app bar's band, behind it, and
            was never once visible in its stuck state on a phone. Measured at
            four scroll positions before it was believed. The offset clears the
            bar on mobile; on md+ the bar is a sidebar, so top-0 is correct.
          */}
          <div className="sticky top-[74px] z-10 -mx-1 flex items-baseline justify-between gap-3 bg-chalk/95 px-1 py-2 backdrop-blur md:top-0">
            <h2 id={`month-${month.key}`} className="font-display text-base leading-none text-ink">
              {month.monthLabel} <span className="text-ink-subtle">{month.year}</span>
            </h2>
            <p className="text-xs text-ink-muted">
              {month.items.length} {month.items.length === 1 ? "activity" : "activities"}
            </p>
          </div>

          {/* THE SPINE, drawn ONCE behind the whole month.
              It used to be a `flex-1` rule inside each day's row, which meant
              a 1px stub per day with the flex gap breaking it between them --
              measured at 96px of rule and 64px of nothing, repeating. A spine
              that is not continuous is not a spine, it is tick marks. Drawn
              here as one absolutely-positioned rule behind the date blocks, it
              actually connects the month. */}
          <div className="relative mt-2 flex flex-col gap-4">
            <span
              aria-hidden="true"
              className="absolute inset-y-2 left-[21px] w-px bg-ink/10 sm:left-[27px]"
            />
            {byDay(month.items).map((day) => {
              const { weekday, day: dayNumber } = dayParts(day.date)
              const isToday = day.date === todayIso
              return (
                <div key={day.date} className="flex gap-3 sm:gap-4">
                  {/* THE SPINE. The date block, then a rule running down past
                      every activity on that day, so a Saturday with three
                      fixtures reads as one Saturday. */}
                  <div className="relative z-[1] flex w-11 shrink-0 flex-col items-center sm:w-14">
                    <div
                      className={cn(
                        "flex w-full flex-col items-center rounded-lg py-1.5 ring-1 ring-inset",
                        isToday ? "bg-forest-900 text-chalk ring-forest-950" : "bg-white text-ink ring-ink/10"
                      )}
                    >
                      <span className={cn("text-[10px] font-medium tracking-wide uppercase", isToday ? "text-chalk/75" : "text-ink-muted")}>
                        {weekday}
                      </span>
                      <span className="font-display text-lg leading-none tabular-nums">{dayNumber}</span>
                    </div>
                  </div>

                  <ul className="flex min-w-0 flex-1 flex-col gap-2">
                    {isToday && (
                      <li className="text-[11px] font-semibold tracking-[0.1em] text-forest-800 uppercase">Today</li>
                    )}
                    {day.items.map((item) => (
                      <li key={item.key}>
                        <ActivityCard item={item} showChild={showChild} attention={attentionKeys?.has(item.key) ?? false} />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * NEXT UP.
 *
 * One promoted card, and only one. Promoting every card promotes nothing, and
 * a page where each row shouts is a page nobody can scan. This answers "what
 * is the very next thing" so the rest of the list can stay calm.
 *
 * Rendered only for a forward-looking view: "next up" in a backwards look
 * would be naming something that has already happened.
 */
export function NextUp({
  item,
  showChild,
  todayIso,
  attention = false,
}: {
  item: AgendaItem
  showChild: boolean
  todayIso: string
  attention?: boolean
}) {
  const isToday = item.date === todayIso
  // "Next Match" only when it IS a match. Promoting training under a heading
  // that implies a fixture was misleading even after training became openable
  // -- the heading names what the thing is, and a session is not a match.
  const label = isToday ? "Today" : item.kind === "training" ? "Next Session" : "Next Up"
  const [y, m, d] = item.date.split("-").map(Number)
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  )

  return (
    /*
      text-chalk ON THE SECTION. Without it every descendant inherited the
      page's near-black --ink onto a dark forest ground, which is how the
      promoted card ended up with black writing in a green box. The Match
      Centre hero sets text-chalk on its own section for exactly this reason;
      this one did not, and nothing else was going to.
    */
    <section
      aria-labelledby="agenda-next-up"
      className="overflow-hidden rounded-2xl border border-forest-950/20 bg-gradient-to-b from-forest-900 to-forest-950 text-chalk"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 sm:px-5">
        <h2 id="agenda-next-up" className="text-[11px] font-semibold tracking-[0.14em] text-pitch-400 uppercase">
          {label}
        </h2>
        <p className="text-xs text-white/70">{when}</p>
      </div>
      <div className="p-2 sm:p-3">
        <ActivityCard item={item} showChild={showChild} onDark attention={attention} />
      </div>
    </section>
  )
}
