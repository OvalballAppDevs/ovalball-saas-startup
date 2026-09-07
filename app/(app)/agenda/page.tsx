import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { CalendarDays, ChevronRight, Dumbbell } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { resolveCalendarSeasonContext } from "@/lib/calendar/season-context"
import {
  applyAgendaFilters,
  countOutstandingResponses,
  groupAgendaByMonth,
  venueOptions,
  type AgendaEvent,
  type AgendaFilters,
} from "@/lib/parent/agenda-model"
import { loadFamilyAgenda, resolveFamilyScope } from "@/lib/parent/family-agenda"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { AgendaFilterSheet } from "./agenda-filter-sheet"

export const dynamic = "force-dynamic"
export const metadata = { title: "Fixtures" }

/**
 * The Parent/Guardian Fixtures surface.
 *
 * Deliberately NOT /fixtures. That page is the inter-club negotiation
 * register -- requesting, accepting and rejecting fixtures between clubs --
 * which is an administrative act a guardian has no part in. Pointing a
 * parent at it produced a page whose every control either failed
 * authorization or did nothing.
 *
 * This is the thing a parent actually wants: what is my child doing, when,
 * where, and have I answered yet. It is a VIEW over canonical fixtures and
 * training_sessions -- never a second event store -- and every row carries
 * the real fixture_id/training_session_id it came from.
 */

const SEASON_LOOKAHEAD_DAYS = 400

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function parseFilters(sp: Record<string, string | string[] | undefined>): AgendaFilters {
  const one = (k: string): string | null => {
    const v = sp[k]
    return typeof v === "string" && v.length > 0 ? v : null
  }
  const many = (k: string): string[] => {
    const v = sp[k]
    if (typeof v === "string") return v.split(",").filter(Boolean)
    if (Array.isArray(v)) return v.flatMap((x) => x.split(",")).filter(Boolean)
    return []
  }
  const kind = one("kind")
  const attendance = one("attendance")
  const range = one("range")
  return {
    playerIds: many("child"),
    teamIds: many("team"),
    kind: kind === "fixture" || kind === "training" ? kind : "all",
    attendance:
      attendance === "needs_response" || attendance === "ATTENDING" || attendance === "CANNOT_ATTEND" || attendance === "UNSURE"
        ? attendance
        : "all",
    venue: one("venue"),
    dateRange: range === "this_month" || range === "next_14_days" || range === "next_30_days" || range === "season" ? range : "all",
  }
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const children = resolveFamilyScope(ctx, activeContext)

  // Anyone whose active context is not a Guardian/Player one has no agenda
  // to show. Sending them to the Calendar is honest -- it is the surface
  // their context actually has -- rather than rendering a convincing empty
  // page that looks like "your child has nothing on".
  if (children.length === 0) {
    const isParentish = activeContext.kind === "parent" || activeContext.kind === "player" || activeContext.kind === "family"
    if (!isParentish) redirect("/calendar")
  }

  const season = await resolveCalendarSeasonContext(supabase, null, undefined, undefined)
  const todayIso = season.todayIso
  // "This season" means the WHOLE season, deliberately not the current
  // phase's effective range: a parent filtering by season in October wants
  // the campaign, not just the main-phase slice they happen to be inside.
  // Pre-season is included by starting from preSeasonStartsOn where the
  // canonical season row defines one.
  const selected = season.selectedSeason ?? season.defaultSeason
  const seasonWindow = selected ? { startIso: selected.preSeasonStartsOn ?? selected.startsOn, endIso: selected.endsOn } : null

  // Read a wide window once, then let the filters narrow it in memory. The
  // alternative -- refetching per filter change -- would make the counts on
  // this page disagree with the list beneath them the moment a filter is on.
  const events =
    children.length > 0
      ? await loadFamilyAgenda(supabase, children, {
          startIso: addDays(todayIso, -1),
          endIso: addDays(todayIso, SEASON_LOOKAHEAD_DAYS),
        })
      : []

  const filters = parseFilters(sp)
  const visible = applyAgendaFilters(events, filters, todayIso, seasonWindow)
  const months = groupAgendaByMonth(visible)

  // Counted over EVERYTHING in scope, never over the filtered list: the card
  // answers "what do I still owe?", and a filter that hid two of them must
  // not make the answer look smaller than it is.
  const outstanding = countOutstandingResponses(events, todayIso)

  const isAllChildren = activeContext.kind === "family"
  const filtersActive =
    filters.playerIds.length > 0 ||
    filters.teamIds.length > 0 ||
    filters.kind !== "all" ||
    filters.attendance !== "all" ||
    filters.venue !== null ||
    filters.dateRange !== "all"

  return (
    // pb-28 clears the global "Ask Ovie" floating widget, which sits fixed
    // bottom-right on every page. Without it the last agenda card's venue
    // line and its chevron sit underneath the widget at 390px -- confirmed
    // in UAT -- which is the same collision the Match Centre already pads
    // for.
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-28 md:px-8 md:pt-12 md:pb-28">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-forest-800" aria-hidden="true" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          {isAllChildren ? "All Children" : activeContext.subjectName ? activeContext.subjectName : "Fixtures"}
        </p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Fixtures &amp; training</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        {isAllChildren
          ? "Everything coming up across your children, soonest first."
          : `Everything coming up for ${activeContext.subjectName ?? "your team"}, soonest first.`}
      </p>

      {/* The outstanding-response card. Actionable by design: it is a link
          into this same agenda pre-filtered to exactly the events it
          counted, so "3 responses needed" and the list you land on can
          never disagree. */}
      {outstanding > 0 && (
        <Link
          href="/agenda?attendance=needs_response"
          className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          <div>
            <p className="font-display text-base text-amber-900">
              {outstanding} attendance {outstanding === 1 ? "response" : "responses"} needed
            </p>
            <p className="mt-0.5 text-sm text-amber-900/80">In the next 14 days. Tap to see just these.</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-amber-900" aria-hidden="true" />
        </Link>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 border-b border-ink/10 pb-3">
        <p className="text-sm text-ink-muted">
          {visible.length} {visible.length === 1 ? "event" : "events"}
          {filtersActive && " (filtered)"}
        </p>
        <AgendaFilterSheet
          filters={filters}
          familyChildren={children.map((c) => ({ playerId: c.playerId, name: c.fullName, teamId: c.teamId, teamName: c.teamName }))}
          venues={venueOptions(events)}
          showChildFilter={isAllChildren}
        />
      </div>

      {months.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink/10 bg-white px-5 py-8 text-center">
          <p className="font-display text-base text-ink">{filtersActive ? "Nothing matches these filters" : "Nothing scheduled yet"}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {filtersActive ? (
              <>
                Try clearing them to see everything.{" "}
                <Link href="/agenda" className="underline underline-offset-2 hover:text-ink">
                  Clear filters
                </Link>
              </>
            ) : (
              "When your club schedules fixtures or training, they will appear here."
            )}
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {months.map((month) => (
            <section key={month.key} aria-labelledby={`month-${month.key}`}>
              <h2 id={`month-${month.key}`} className="text-sm font-medium tracking-[0.08em] text-ink-muted uppercase">
                {month.label}
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {month.events.map((e) => (
                  <li key={e.key}>
                    <AgendaRow event={e} showChild={isAllChildren} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

const ATTENDANCE_CHIP: Record<string, { label: string; className: string }> = {
  ATTENDING: { label: "Attending", className: "border-mint-300 bg-mint-100 text-forest-900" },
  CANNOT_ATTEND: { label: "Can't attend", className: "border-destructive/30 bg-destructive/10 text-destructive-text" },
  UNSURE: { label: "Unsure", className: "border-amber-300 bg-amber-50 text-amber-900" },
}

function AgendaRow({ event, showChild }: { event: AgendaEvent; showChild: boolean }) {
  const chip = event.attendance ? ATTENDANCE_CHIP[event.attendance] : null
  const dayLabel = new Date(`${event.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })

  const body = (
    <div className="flex items-start gap-3">
      {/* Icon carries the fixture/training distinction alongside the words,
          so the two never rely on colour alone to be told apart. */}
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
          event.kind === "training" ? "border-ink/10 bg-ink/5 text-ink/60" : "border-forest-800/15 bg-forest-800/8 text-forest-800"
        )}
        aria-hidden="true"
      >
        {event.kind === "training" ? <Dumbbell className="size-4" /> : <CalendarDays className="size-4" />}
      </span>

      <div className="min-w-0 flex-1">
        {/* In single-child mode the child's name is on every row of the page
            already -- repeating it here would be noise. */}
        {showChild && (
          <p className="text-xs font-medium text-forest-800">
            {event.childName} · {event.teamName}
          </p>
        )}
        <p className="truncate font-display text-base text-ink">{event.title}</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {dayLabel}
          {event.time ? ` · ${event.time}` : ""}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        {/* The canonical fixtures.meet_time -- the same column the Match
            Centre reads, surfaced here because "when do we arrive" is the
            thing a parent is actually scanning this list for. */}
        {event.meetTime && (
          <p className="mt-0.5 text-sm font-medium text-forest-800">Meet {event.meetTime}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chip ? (
            <span className={cn("rounded-full border px-2 py-0.5 text-xs", chip.className)}>{chip.label}</span>
          ) : (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Needs response</span>
          )}
          {!showChild && <span className="text-xs text-ink-subtle">{event.teamName}</span>}
        </div>
      </div>

      {event.href && <ChevronRight className="mt-2 size-4 shrink-0 text-ink/40" aria-hidden="true" />}
    </div>
  )

  if (!event.href) {
    return <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">{body}</div>
  }
  return (
    <Link
      href={event.href}
      className="block rounded-lg border border-ink/10 bg-white px-4 py-3 transition-colors hover:border-ink/20 hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
    >
      {body}
    </Link>
  )
}
