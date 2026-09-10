import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { CalendarDays } from "lucide-react"

import { AgendaControls } from "@/components/fixtures/agenda/agenda-controls"
import { AgendaTimeline, NextUp } from "@/components/fixtures/agenda/agenda-timeline"
import { AttendanceActiveBanner, AttendancePrompt } from "@/components/fixtures/agenda/attendance-prompt"
import {
  applyAgendaFilters,
  clubOptions,
  filterQuery,
  groupByMonth,
  hasActiveFilters,
  needsResponse,
  oppositionOptions,
  parseFilterState,
  teamOptions,
} from "@/lib/agenda/filters"
import { loadAgenda } from "@/lib/agenda/load"
import { filterAffordances, isPersonalScope, resolveAgendaScope } from "@/lib/agenda/scope"
import { parseAnchor, resolveWindow } from "@/lib/agenda/window"
import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Fixtures" }

/**
 * FIXTURES / AGENDA -- the canonical Ovalball rugby agenda.
 *
 * ONE SHARED ROLE-AWARE SURFACE. There is no per-role agenda -- no parent,
 * player, club or site-admin variant of this page -- and no role branch
 * choosing between layouts. Everybody gets the same timeline, the same cards
 * and the same controls; what differs is the DATASET, which
 * resolveAgendaScope decides from proved relationships before a single row is
 * read, and which FILTERS are worth offering, which filterAffordances decides
 * from the same scope.
 *
 * This replaces a page that was Guardian/Player-only and redirected every
 * other role to the Calendar. A coach, a club admin and a site admin had no
 * agenda at all.
 *
 * THE AUTHORITY PIPELINE, in order, and the order is the point:
 *
 *   1. getSessionContext        -- what this account actually holds
 *   2. resolveActiveContext     -- which of those they are looking through
 *   3. resolveAgendaScope       -- whose rugby this is. Takes NO search params.
 *   4. loadAgenda               -- a bounded query shaped by that scope
 *   5. applyAgendaFilters       -- pure, array-in/array-out, cannot widen
 *
 * Steps 3 and 4 never see the query string. Step 5 can only remove rows from
 * an array it was handed. So there is no expressible URL that returns a row
 * the session did not authorise -- not because a check rejects it, but because
 * there is nowhere for it to be expressed.
 *
 * WHAT THIS PAGE IS NOT: Fixture Management (which edits the record),
 * the Calendar (which is a grid over the same rows), or a second Match Centre.
 * Every fixture here opens the ONE canonical Match Centre by its own
 * fixture_id.
 */
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

  // WHOSE RUGBY. Resolved from the session, before anything is read, and with
  // no access to the request's query string.
  const scope = resolveAgendaScope(ctx, activeContext)

  const todayIso = new Date().toISOString().slice(0, 10)
  const state = parseFilterState(sp, todayIso, parseAnchor)
  const window = resolveWindow(state.mode, state.anchor, todayIso, state.direction)

  // WHAT RUGBY. A bounded read: finite date window, hard row cap, team ids
  // fixed by the scope above.
  const { items: authorised, truncated } = await loadAgenda(supabase, scope, window, { includeTraining: state.includeTraining })

  // NARROWING ONLY. Options are computed from the authorised rows, so a filter
  // can only ever offer a value that is already reachable.
  const oppositions = oppositionOptions(authorised)
  const teams = teamOptions(authorised)
  const clubs = clubOptions(authorised)
  const children =
    scope.kind === "family"
      ? Array.from(new Map(scope.children.map((c) => [c.playerId, { id: c.playerId, name: c.firstName }])).values())
      : []

  const visible = applyAgendaFilters(authorised, state, todayIso)
  const months = groupByMonth(visible)
  const affordances = filterAffordances(scope, children.length)

  /*
    WHO STILL OWES AN ANSWER.
    Computed from `authorised` -- the rows this session already proved a right
    to -- and never from a second, wider query. A coach is not being asked
    whether they can attend, so the whole idea only exists in a personal scope;
    outside one the set is empty and every branch below collapses to nothing.

    It respects the CHILD filter deliberately: a guardian looking at Ava should
    be told what Ava owes, not a number that includes her brother and then
    opens a list that does not match it.
  */
  const personal = isPersonalScope(scope)
  const owed = personal
    ? authorised.filter((i) => (state.playerId ? i.playerId === state.playerId : true) && needsResponse(i, todayIso))
    : []
  const owedCount = owed.length
  // Drawn on the card, so a filtered list does not become an undifferentiated
  // wall -- and so an UNfiltered agenda still shows which rows are waiting.
  const attentionKeys = new Set(owed.map((i) => i.key))

  // The single promoted card, and only in a forward-looking view: "next up"
  // pointing at something that has already happened would be nonsense.
  // Promoted only when it is something a person can actually open. A hero that
  // invites a click and refuses one is worse than no hero.
  const forward = state.direction === "upcoming"
  const nextUp = forward ? (visible.find((i) => i.date >= todayIso) ?? null) : null
  // The promoted item is REMOVED from the timeline, so it appears exactly once
  // -- leaving it in rendered the same training session twice, once in the
  // hero and again in its day. The counts are kept honest instead by saying
  // what the total covers: "5 activities · next one shown above", rather than
  // a bare 5 that the month headers then appear to contradict.
  const restMonths = nextUp ? groupByMonth(visible.filter((i) => i.key !== nextUp.key)) : months

  const showChild = scope.kind === "family" && children.length > 1 && state.playerId === null
  const filtersOn = hasActiveFilters(state)

  const eyebrow =
    scope.kind === "platform"
      ? "All Clubs"
      : scope.kind === "club"
        ? scope.clubName
        : activeContext.kind === "family"
          ? "All Children"
          : (activeContext.subjectName ?? activeContext.label)

  return (
    // pb-28 clears the global "Ask Ovie" widget, fixed bottom-right on every
    // page -- without it the final card sits underneath it at 390px.
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-28 md:px-8 md:pt-12">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-forest-800" aria-hidden="true" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{eyebrow}</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Fixtures &amp; Training</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        {scope.kind === "none"
          ? "There is no rugby linked to this view yet."
          : state.direction === "past"
            ? "Looking back through your rugby, most recent first."
            : state.mode === "upcoming"
              ? "Everything coming up, soonest first."
              : // Naming the window rather than claiming everything is
                // "coming up" -- which was shown while looking at November.
                `${window.label}, in order.`}
      </p>

      {scope.kind === "none" ? (
        <EmptyState
          title="No rugby here yet"
          body="This view isn't linked to any teams or players. Switch context, or ask your club to add you to a team."
        />
      ) : (
        <>
          <div className="mt-6">
            <AgendaControls
              state={state}
              todayIso={todayIso}
              window={window}
              affordances={affordances}
              oppositions={oppositions}
              teams={teams}
              clubs={clubs}
            >
              {children}
            </AgendaControls>
          </div>

          {/*
            THE ONE PLACE THIS FILTER IS TURNED ON AND OFF.
            Off, it invites. On, it explains what is missing and offers the way
            back -- which is the whole defect being closed here: tapping the
            prompt filtered the agenda with nothing on the page saying so and
            nothing but the drawer to undo it.

            Both states are scoped to the CURRENT window, so the number in the
            callout and the number in the list below it are the same number.
            Somebody looking at November is told about November.
          */}
          {personal && state.needsResponse ? (
            <div className="mt-5">
              <AttendanceActiveBanner clearHref={filterQuery({ ...state, needsResponse: false }, todayIso)} />
            </div>
          ) : personal && owedCount > 0 ? (
            <div className="mt-5">
              <AttendancePrompt count={owedCount} href={filterQuery({ ...state, needsResponse: true }, todayIso)} />
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3 border-b border-ink/10 pb-3">
            <p className="text-sm text-ink-muted">
              {/* Never "fixtures": training is in this list too, and a parent
                  told "2 fixtures" who then finds a training session has been
                  given the wrong word for the thing they must answer. */}
              {state.needsResponse ? (
                <>
                  {visible.length} {visible.length === 1 ? "activity needs" : "activities need"} your response
                </>
              ) : (
                <>
                  {visible.length} {visible.length === 1 ? "activity" : "activities"}
                  {filtersOn && " · filtered"}
                  {nextUp && " · next one shown below"}
                </>
              )}
            </p>
            {/* Honest about the cap rather than silently truncating. */}
            {truncated && <p className="text-xs text-amber-900">Showing the first {authorised.length}. Narrow the range to see more.</p>}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={
                // An empty ATTENDANCE filter is good news, not a failed search,
                // and reachable by Back/Forward after answering the last one.
                state.needsResponse
                  ? "Nothing waiting on you"
                  : filtersOn
                    ? "Nothing matches these filters"
                    : state.direction === "past"
                    ? "No past rugby in this range"
                    : // The upcoming window's label is a phrase, not a noun --
                      // "No rugby in today onwards" is not a sentence.
                      state.mode === "upcoming"
                      ? "No rugby coming up"
                      : `No rugby in ${window.label}`
              }
              body={
                state.needsResponse
                  ? "Every fixture and training session in this range has an answer. Show all to see them."
                  : filtersOn
                    ? "Try widening them, or clear them to see everything in this range."
                    : state.direction === "past"
                    ? "Once matches have been played they will appear here."
                    : state.mode === "upcoming"
                      ? "When your club schedules fixtures or training, they will appear here."
                      : // An empty WINDOW is not an empty agenda. Saying "your
                        // club has scheduled nothing" while four fixtures sit
                        // two months out is a wrong diagnosis, and it was the
                        // one being given.
                        "Nothing is scheduled in this range. There may be rugby outside it."
              }
              action={
                // Clearing ONE filter, not the agenda. Somebody on
                // September / Ava / training-on who taps Attendance Needed and
                // finds nothing gets September / Ava / training-on back.
                state.needsResponse
                  ? { href: filterQuery({ ...state, needsResponse: false }, todayIso), label: "Show All" }
                  : filtersOn
                    ? {
                        href: filterQuery(
                          { ...state, opposition: null, homeAway: "all", includeTraining: true, playerId: null, teamId: null, clubId: null },
                          todayIso
                        ),
                        label: "Clear Filters",
                      }
                    : { href: "/agenda", label: "Show Upcoming" }
              }
            />
          ) : (
            <div className="mt-6 flex flex-col gap-6">
              {nextUp && <NextUp item={nextUp} showChild={showChild} todayIso={todayIso} attention={attentionKeys.has(nextUp.key)} />}
              <AgendaTimeline months={restMonths} todayIso={todayIso} showChild={showChild} attentionKeys={attentionKeys} />
            </div>
          )}
        </>
      )}

      {/* Attendance is a thing a person answers for somebody. A coach reading
          their squad's agenda is not being asked whether they can attend, so
          this is offered only in a personal scope -- and only when nothing is
          outstanding, because the callout above already says it with a number
          and a way to act on it. Two instructions about the same thing on one
          page is one too many. */}
      {personal && visible.length > 0 && state.direction === "upcoming" && owedCount === 0 && (
        <p className="mt-8 text-center text-sm text-ink-muted">Open a fixture to change whether you can make it.</p>
      )}
    </div>
  )
}

/**
 * An empty result is a normal answer, not a failure.
 *
 * So it reads as a sentence about rugby rather than a system message, and
 * where there is an obvious next move it offers exactly one -- never a row of
 * competing suggestions, which is how an empty state starts looking like an
 * error page.
 */
function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="mt-8 rounded-2xl border border-ink/10 bg-white px-5 py-10 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-ink/12 bg-white px-5 text-sm font-medium text-ink shadow-[0_3px_0_0_theme(colors.ink/12%)] transition-[transform,box-shadow] hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none active:translate-y-[3px] active:shadow-none"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
