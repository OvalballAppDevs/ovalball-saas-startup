import Link from "next/link"
import { CalendarDays, ChevronRight, Dumbbell, ShieldCheck } from "lucide-react"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import type { SwitchableContext } from "@/lib/app-context/active-context"
import type { SessionContext } from "@/lib/app-context/session-context"
import { countOutstandingResponses, type AgendaEvent } from "@/lib/parent/agenda-model"
import { loadFamilyAgenda, resolveFamilyScope } from "@/lib/parent/family-agenda"
import { UserAvatar } from "@/components/profile/user-avatar"

/**
 * The Guardian/Player dashboard panel.
 *
 * Reads the SAME loader the agenda does, deliberately: a dashboard that
 * counted outstanding responses its own way would eventually disagree with
 * the page it links to, and the parent would have no way to tell which
 * number was wrong.
 *
 * Not a visual overhaul of the Dashboard -- it is one coherent section
 * added to the existing page, which is what this phase asked for.
 */

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}

export async function FamilyPanel({
  supabase,
  ctx,
  activeContext,
  isGuardian,
}: {
  supabase: SupabaseClient<Database>
  ctx: SessionContext
  activeContext: SwitchableContext
  /**
   * Whether this person actually guardians anybody. Passed in rather than
   * worked out here, because this panel also serves an adult looking at their
   * OWN player card, and guardian controls have no place there.
   */
  isGuardian: boolean
}) {
  const children = resolveFamilyScope(ctx, activeContext)
  if (children.length === 0) return null

  const todayIso = new Date().toISOString().slice(0, 10)
  const events = await loadFamilyAgenda(supabase, children, { startIso: todayIso, endIso: addDays(todayIso, 120) })
  const outstanding = countOutstandingResponses(events, todayIso)
  const isAllChildren = activeContext.kind === "family"

  // Signed URLs, because youth photos are in a private bucket. A child with
  // no picture renders initials, which is a first-class state here, not a
  // placeholder waiting to be filled.
  const avatarUrlByPlayerId = new Map<string, string>()
  for (const c of children) {
    if (!c.avatarStoragePath) continue
    const { data } = await supabase.storage.from("player-avatars").createSignedUrl(c.avatarStoragePath, 3600)
    if (data?.signedUrl) avatarUrlByPlayerId.set(c.playerId, data.signedUrl)
  }

  const nextFor = (playerId: string, kind?: AgendaEvent["kind"]): AgendaEvent | null =>
    events
      .filter((e) => e.playerId === playerId && (!kind || e.kind === kind) && e.date >= todayIso)
      .sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)))[0] ?? null

  return (
    <section className="mt-10" aria-labelledby="family-panel-heading">
      <div className="flex items-center justify-between">
        <h2 id="family-panel-heading" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          {isAllChildren ? "Your children" : "Coming up"}
        </h2>
        <Link href="/agenda" className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          All fixtures
        </Link>
      </div>

      {outstanding > 0 && (
        <Link
          href="/agenda?attendance=needs_response"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          <div>
            <p className="font-display text-base text-amber-900">
              {outstanding} attendance {outstanding === 1 ? "response" : "responses"} needed
            </p>
            <p className="mt-0.5 text-sm text-amber-900/80">In the next 14 days.</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-amber-900" aria-hidden="true" />
        </Link>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {children.map((child) => {
          const nextEvent = nextFor(child.playerId)
          const nextFixture = nextFor(child.playerId, "fixture")
          const nextTraining = nextFor(child.playerId, "training")
          return (
            <li key={`${child.playerId}:${child.teamId}`} className="rounded-lg border border-ink/10 bg-white px-5 py-4">
              <div className="flex items-start gap-3">
                <UserAvatar avatarUrl={avatarUrlByPlayerId.get(child.playerId) ?? null} name={child.fullName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base text-ink">{child.fullName}</p>
                  <p className="text-sm text-ink-muted">
                    {child.clubName} · {child.teamName}
                  </p>

                  {/* In single-child mode the two next events are worth
                      naming separately -- a parent plans around both. In
                      All Children mode that would be six lines of detail
                      before you reach the second child, so the aggregate
                      shows just the next thing. */}
                  {isAllChildren ? (
                    <p className="mt-2 text-sm text-ink">
                      {nextEvent ? (
                        <>
                          Next: {nextEvent.title} · {formatDay(nextEvent.date)}
                          {nextEvent.time ? ` · ${nextEvent.time}` : ""}
                        </>
                      ) : (
                        <span className="text-ink-subtle">Nothing scheduled</span>
                      )}
                    </p>
                  ) : (
                    <dl className="mt-3 flex flex-col gap-1.5">
                      <div className="flex items-start gap-2 text-sm">
                        <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-forest-800" aria-hidden="true" />
                        <dt className="sr-only">Next fixture</dt>
                        <dd className="text-ink">
                          {nextFixture ? (
                            <>
                              {nextFixture.title} · {formatDay(nextFixture.date)}
                              {nextFixture.time ? ` · ${nextFixture.time}` : ""}
                            </>
                          ) : (
                            <span className="text-ink-subtle">No fixture scheduled</span>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <Dumbbell className="mt-0.5 size-3.5 shrink-0 text-ink/50" aria-hidden="true" />
                        <dt className="sr-only">Next training</dt>
                        <dd className="text-ink">
                          {nextTraining ? (
                            <>
                              {formatDay(nextTraining.date)}
                              {nextTraining.time ? ` · ${nextTraining.time}` : ""}
                              {nextTraining.venue ? ` · ${nextTraining.venue}` : ""}
                            </>
                          ) : (
                            <span className="text-ink-subtle">No training scheduled</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}

                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    <Link href="/agenda" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                      Fixtures
                    </Link>
                    <Link href="/calendar" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                      Calendar
                    </Link>
                    <Link href="/rugby-hub" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                      Rugby Hub
                    </Link>
                    {nextFixture?.href && (
                      <Link href={nextFixture.href} className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                        Match Centre
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/*
        Approving another adult's request to become a guardian is a
        guardian's job. An adult player looking at their own card is not being
        asked to vet anybody.
      */}
      {isGuardian && activeContext.kind !== "player" && (
        <Link
          href="/guardian-requests"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Guardian requests awaiting your approval
        </Link>
      )}
    </section>
  )
}
