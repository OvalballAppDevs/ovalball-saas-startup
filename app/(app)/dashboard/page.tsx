import { redirect } from "next/navigation"
import Link from "next/link"
import { CalendarDays, Inbox } from "lucide-react"

import { buildNavItems } from "@/lib/app-context/build-nav-items"
import { getDashboardData, type FixtureRow, type PendingRequestRow } from "@/lib/app-context/dashboard-data"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

const STATUS_STYLES: Record<string, string> = {
  Booked: "bg-mint-100 text-forest-900",
  Confirmed: "bg-mint-100 text-forest-900",
  Planned: "bg-mint-100/60 text-forest-800",
  "To Be Determined": "bg-mint-100/60 text-forest-800",
  Cancelled: "bg-destructive/10 text-destructive",
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const { roleLabel } = buildNavItems(ctx)
  const data = await getDashboardData(supabase, ctx)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
        {greeting()}, {ctx.firstName ?? "there"}
      </p>
      <h1 className="mt-2 font-display text-display-l text-ink">{data.clubDisplayName}</h1>
      <p className="mt-1 text-sm text-ink/50">{roleLabel}</p>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">This week</h2>
          <Link href="/calendar" className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            View calendar
          </Link>
        </div>

        {data.thisWeekFixtures.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5 text-ink/30" />}
            title="Nothing scheduled this week"
            body="Fixtures for your team(s) in the next 7 days will show up here."
            actionHref="/calendar"
            actionLabel="View calendar"
          />
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {data.thisWeekFixtures.map((f) => (
              <FixtureListRow key={f.id} fixture={f} />
            ))}
          </ul>
        )}
      </section>

      {data.outstandingRequests.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Requests</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {data.outstandingRequests.map((r) => (
              <RequestListRow key={r.id} request={r} />
            ))}
          </ul>
        </section>
      )}

      {data.outstandingRequests.length === 0 && data.myTeamCount === 0 && (
        <section className="mt-10">
          <EmptyState
            icon={<Inbox className="size-5 text-ink/30" />}
            title="No team assigned yet"
            body="Once you have a team or club role, its fixtures and requests will appear here."
          />
        </section>
      )}
    </div>
  )
}

function FixtureListRow({ fixture }: { fixture: FixtureRow }) {
  const statusClass = STATUS_STYLES[fixture.status] ?? "bg-ink/5 text-ink/60"
  const date = new Date(fixture.kickoffDate + "T00:00:00")
  const dateLabel = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="min-w-[7rem] shrink-0">
        <p className="text-sm font-medium text-ink">{dateLabel}</p>
        {fixture.kickoffTime && <p className="text-xs text-ink/45">{fixture.kickoffTime.slice(0, 5)}</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {fixture.teamDisplayName} <span className="text-ink/40">vs</span> {fixture.opposition}
        </p>
        <p className="text-xs text-ink/50">
          {fixture.homeAway}
          {fixture.venueAddress ? ` · ${fixture.venueAddress}` : ""}
        </p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>{fixture.status}</span>
      {fixture.needsAction && (
        <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
          Action needed
        </span>
      )}
    </li>
  )
}

function RequestListRow({ request }: { request: PendingRequestRow }) {
  const date = request.proposedDate ? new Date(request.proposedDate + "T00:00:00") : null
  const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          request.direction === "incoming" ? "bg-pitch-600/15 text-forest-900" : "bg-ink/5 text-ink/60"
        }`}
      >
        {request.direction === "incoming" ? "Received" : "Sent"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {request.teamDisplayName} <span className="text-ink/40">vs</span> {request.opponentText}
        </p>
        <p className="text-xs text-ink/50">
          {dateLabel} · {request.venuePreference}
        </p>
      </div>
      <Link
        href="/fixtures"
        className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
      >
        Review
      </Link>
    </li>
  )
}

function EmptyState({
  icon,
  title,
  body,
  actionHref,
  actionLabel,
}: {
  icon: React.ReactNode
  title: string
  body: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6">
      {icon}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink/55">{body}</p>
      </div>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
