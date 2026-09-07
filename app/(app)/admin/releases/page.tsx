import { redirect } from "next/navigation"
import { Radio } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { APP_BUILD_SHA, APP_VERSION } from "@/lib/version"

import { PlatformModePanel } from "./platform-mode-panel"
import { ReleasePanel, type ReleaseRow } from "./release-panel"

export const dynamic = "force-dynamic"

export const metadata = { title: "Release & Platform Mode" }

/**
 * Release history and the Beta ↔ Live switch.
 *
 * Every Site Admin can read this page: knowing whether Ovalball is
 * charging clubs is operational context, not a privilege. Changing either
 * thing needs the `site.system.*` capability, which the panels are told
 * about so they render a read-only view rather than a broken control.
 */
export default async function AdminReleasesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const [canManageMode, canManageReleases] = await Promise.all([
    hasCapability(supabase, "site.system.beta.manage", "site"),
    hasCapability(supabase, "site.system.release.manage", "site"),
  ])

  const [{ data: modeEvents }, { data: releaseRows }] = await Promise.all([
    supabase
      .from("platform_mode_events")
      .select("id, previous_mode, new_mode, reason, changed_at, changed_by")
      .order("seq", { ascending: false })
      .limit(25),
    supabase
      .from("platform_releases")
      .select("id, version, build_sha, title, status, released_at")
      .order("released_at", { ascending: false })
      .limit(50),
  ])

  const events = modeEvents ?? []
  const current = events[0]

  // One lookup for every actor named in the history, rather than a join
  // per row. A null profile just means the row was recorded by the system.
  const actorIds = Array.from(new Set(events.map((e) => e.changed_by).filter((id): id is string => Boolean(id))))
  const { data: actorRows } = actorIds.length
    ? await supabase.from("profiles").select("id, first_name, surname").in("id", actorIds)
    : { data: [] }

  const actorNames = new Map(
    (actorRows ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "A Site Admin"])
  )

  const releases: ReleaseRow[] = (releaseRows ?? []).map((r) => ({
    id: r.id,
    version: r.version,
    buildSha: r.build_sha,
    title: r.title,
    status: r.status as "draft" | "published",
    releasedAt: r.released_at,
  }))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Radio className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Release &amp; platform mode</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        What Ovalball is running, and whether it is charging clubs. Beta and Live decide only what
        Ovalball collects from clubs &mdash; they have no effect on payments a club collects from its
        own members.
      </p>

      <PlatformModePanel
        mode={(current?.new_mode as "beta" | "live") ?? "beta"}
        since={current?.changed_at ?? null}
        changedByName={current?.changed_by ? (actorNames.get(current.changed_by) ?? null) : null}
        canManage={canManageMode}
      />

      <ReleasePanel
        releases={releases}
        canManage={canManageReleases}
        suggestedVersion={APP_VERSION}
        suggestedBuildSha={APP_BUILD_SHA}
      />

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink">Mode history</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Append-only. Nothing here can be edited or removed, which is what makes it usable as the
          answer to &ldquo;was Ovalball charging on this date&rdquo;.
        </p>

        {/* A time rail rather than numbered markers: this is a chronology
            that continues downward and cannot be rewritten, which is
            exactly what the line says. Numbers would imply a fixed
            sequence of steps. */}
        <ol className="mt-5 space-y-6 border-l border-ink/15 pl-6">
          {events.map((event) => (
            <li key={event.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -left-[1.6875rem] top-1.5 size-2.5 rounded-full ring-4 ring-chalk ${
                  event.new_mode === "live" ? "bg-pitch-600" : "bg-ink/30"
                }`}
              />
              <p className="text-sm font-medium text-ink">
                {event.previous_mode
                  ? `${labelFor(event.previous_mode)} → ${labelFor(event.new_mode)}`
                  : `${labelFor(event.new_mode)} — first recorded`}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {formatDateTime(event.changed_at)}
                {" · "}
                {event.changed_by ? (actorNames.get(event.changed_by) ?? "A Site Admin") : "the system"}
              </p>
              {event.reason ? (
                <p className="mt-1.5 max-w-xl text-sm text-ink/70">{event.reason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function labelFor(mode: string): string {
  return mode === "live" ? "Live" : "Beta"
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
