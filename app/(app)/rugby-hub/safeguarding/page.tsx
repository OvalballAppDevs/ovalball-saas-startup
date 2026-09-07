import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { MessageCircleWarning, Shield } from "lucide-react"

import { OfficialSourceLink } from "@/components/rugby-hub/official-source-link"
import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { NoSafeguardingOfficerNotice, SafeguardingOfficerCard } from "@/components/rugby-hub/safeguarding-officer-card"
import { getSessionContext } from "@/lib/app-context/session-context"
import {
  contactableOfficers,
  getRugbyHubTeamOptions,
  getSafeguardingContent,
  getSafeguardingOfficerProjections,
  getSafeguardingRoutes,
  getSourceMetadata,
  resolveActiveRugbyHubTeamId,
} from "@/lib/app-context/rugby-hub-data"
import { SAFEGUARDING_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Safeguarding | Rugby Hub",
  description: "Official safeguarding guidance and reporting information from the RFU and RFL.",
}

export default async function SafeguardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)
  const teamOptions = await getRugbyHubTeamOptions(ctx)
  const team = teamOptions.find((t) => t.teamId === teamId)

  if (!teamId) {
    return (
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
        <h1 className="mt-3 font-display text-display-l text-ink">Safeguarding</h1>
        <div className="mt-8">
          <ReviewStatusNotice tone="unavailable" message="No team relationship available to show safeguarding information for." />
        </div>
      </div>
    )
  }

  const [contentResult, routesResult, officers] = await Promise.all([
    getSafeguardingContent(supabase, teamId, "GENERAL"),
    getSafeguardingRoutes(supabase, teamId),
    team ? getSafeguardingOfficerProjections(supabase, team.clubId) : Promise.resolve([]),
  ])
  const visibleOfficers = contactableOfficers(officers)

  const sourceKeys = [
    ...(contentResult.status === "content" ? contentResult.rows.map((r) => r.primary_source_key) : []),
    ...(routesResult.status === "content" ? routesResult.rows.map((r) => r.primary_source_key) : []),
  ]
  const sourceMetadata = await getSourceMetadata(supabase, sourceKeys)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Safeguarding</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
        Official safeguarding guidance for {team ? `${team.clubName}'s ${team.teamDisplayName}` : "your team"}.
        Ovalball is not a safeguarding authority &mdash; this page presents guidance published by the governing body
        itself, with a link back to the original source.
      </p>

      {/* Section A -- Your Club Contact, deliberately a separate visual block from governing-body guidance below. */}
      <div className="mt-8">
        <h2 className="font-display text-2xl text-ink">Your Club Safeguarding Officer</h2>
        <div className="mt-3 flex flex-col gap-3">
          {visibleOfficers.length === 0 ? <NoSafeguardingOfficerNotice /> : visibleOfficers.map((officer) => <SafeguardingOfficerCard key={officer.safeguardingOfficerAssignmentId} officer={officer} />)}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-2xl text-ink">Official Safeguarding Guidance</h2>
        <div className="mt-3 flex flex-col gap-3">
          {contentResult.status === "error" && <ReviewStatusNotice tone="unavailable" message="Safeguarding guidance is temporarily unavailable. Please try again shortly." />}
          {contentResult.status === "empty" && <ReviewStatusNotice tone="reviewing" message="Detailed safeguarding guidance for this rugby code is being reviewed and isn't published here yet." />}
          {contentResult.status === "content" &&
            contentResult.rows.map((row) => (
              <RegulatoryFactCard
                key={`${row.fact_id ?? ""}-${row.section_key}`}
                title={SAFEGUARDING_SECTION_LABELS[row.section_key] ?? row.section_key}
                body={row.body ?? row.value_text ?? null}
                sourceKey={row.primary_source_key}
                locator={row.primary_source_locator}
                sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
              />
            ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-2xl text-ink">Official Reporting / Support Routes</h2>
        <div className="mt-3 flex flex-col gap-3">
          {routesResult.status === "error" && <ReviewStatusNotice tone="unavailable" message="Official contact routes are temporarily unavailable." />}
          {routesResult.status === "empty" && <ReviewStatusNotice tone="reviewing" message="An official reporting route for this rugby code isn't published here yet." />}
          {routesResult.status === "content" &&
            routesResult.rows.map((route) => (
              <article key={route.route_id} className="flex items-start gap-3 rounded-xl border border-ink/10 bg-white px-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
                  {route.route_type === "EXTERNAL_CHILD_PROTECTION_PARTNER" ? <Shield aria-hidden="true" className="size-[18px]" /> : <MessageCircleWarning aria-hidden="true" className="size-[18px]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{route.label}</h3>
                  <dl className="mt-1.5 flex flex-col gap-0.5 text-[15px] text-ink/80">
                    {route.email && (
                      <div>
                        <a href={`mailto:${route.email}`} className="font-medium text-forest-800 underline underline-offset-2">
                          {route.email}
                        </a>
                      </div>
                    )}
                    {route.phone && <div>{route.phone}</div>}
                    {route.url && (
                      <div>
                        <a href={route.url} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2">
                          {route.url}
                        </a>
                      </div>
                    )}
                  </dl>
                  <OfficialSourceLink sourceKey={route.primary_source_key} locator={route.primary_source_locator} metadata={sourceMetadata.get(route.primary_source_key ?? "")} />
                </div>
              </article>
            ))}
        </div>
      </div>

      <p className="mt-8 text-sm text-ink/50">
        For concerns about how Ovalball itself is used (not rugby-regulatory safeguarding), see{" "}
        <Link href="/legal/safeguarding" className="font-medium text-forest-800 underline underline-offset-2">
          Safeguarding &amp; Online Safety
        </Link>
        .
      </p>
    </div>
  )
}
