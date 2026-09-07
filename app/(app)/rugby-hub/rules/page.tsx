import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, getRugbyHubTeamOptions, getRulesBundle, getSourceMetadata, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { formatRulesValue, groupPitchDimensions, RULES_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Rules | Rugby Hub",
  description: "Age-grade playing rules sourced from official RFU and RFL regulations.",
}

export default async function RulesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)
  const teamOptions = await getRugbyHubTeamOptions(supabase, ctx)
  const team = teamOptions.find((t) => t.teamId === teamId)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Rules</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
        Playing rules for {team ? `${team.clubName}'s ${team.teamDisplayName}` : "your team"}. This reflects the
        currently published rules for this age group and rugby code &mdash; it is not necessarily the complete
        official regulation. Check with your club or the governing body directly for anything not covered here.
      </p>

      <div className="mt-8">{teamId ? <RulesContent supabase={supabase} teamId={teamId} /> : <ReviewStatusNotice tone="unavailable" message="No team relationship available to show rules for." />}</div>
    </div>
  )
}

async function RulesContent({ supabase, teamId }: { supabase: Awaited<ReturnType<typeof createClient>>; teamId: string }) {
  const identity = await getRugbyHubIdentityContext(supabase, teamId)

  if (identity.mappingType === "NO_DIRECT_MAPPING") {
    return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group. Ovalball does not invent one -- check with your club for locally-agreed playing arrangements." />
  }
  if (!identity.regulatoryIdentityId) {
    return <ReviewStatusNotice tone="reviewing" message="This age group hasn't been mapped to a regulatory identity yet -- age-grade rules aren't available here for it." />
  }

  const result = await getRulesBundle(supabase, teamId, identity)

  if (result.status === "error") return <ReviewStatusNotice tone="unavailable" message="Rules for this context are temporarily unavailable. Please try again shortly." />
  if (result.status === "no-mapping") return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group." />
  if (result.status === "empty") return <ReviewStatusNotice tone="reviewing" message="Detailed rules for this age group are being reviewed and aren't published here yet." />

  const rows = result.rows
  const sourceMetadata = await getSourceMetadata(supabase, rows.map((r) => r.primary_source_key))
  const { length, width, rest } = groupPitchDimensions(rows)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(length || width) && (
        <div className="sm:col-span-2">
          <RegulatoryFactCard
            title="Pitch"
            valueDisplay={[length ? `Length: ${formatRulesValue(length)}` : null, width ? `Width: ${formatRulesValue(width)}` : null].filter(Boolean).join(" · ")}
            sourceKey={length?.primary_source_key ?? width?.primary_source_key ?? null}
            locator={length?.primary_source_locator ?? width?.primary_source_locator ?? null}
            sourceMetadata={sourceMetadata.get((length ?? width)?.primary_source_key ?? "")}
          />
        </div>
      )}
      {rest.map((row) => (
        <RegulatoryFactCard
          key={row.fact_id}
          title={RULES_SECTION_LABELS[row.section_key] ?? row.section_key}
          valueDisplay={formatRulesValue(row)}
          isOverlay={row.is_overlay ?? false}
          sourceKey={row.primary_source_key}
          locator={row.primary_source_locator}
          sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
        />
      ))}
    </div>
  )
}
