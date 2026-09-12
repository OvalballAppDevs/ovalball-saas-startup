import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, getRugbyHubTeamOptions, getRulesBundle, getRulesBundleByIdentity, getSourceMetadata, resolveActiveRugbyHubTeamId, type RulesByIdentityRow, type RulesRow } from "@/lib/app-context/rugby-hub-data"
import { formatRulesValue, groupPitchDimensions, RULES_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Rules | Rugby Hub",
  description: "Age-grade playing rules sourced from official RFU and RFL regulations.",
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ identity?: string }> }) {
  const { identity: browseIdentityKey } = await searchParams
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

      <div className="mt-8">
        {browseIdentityKey ? (
          <BrowseRulesContent supabase={supabase} identityKey={browseIdentityKey} />
        ) : teamId ? (
          <RulesContent supabase={supabase} teamId={teamId} />
        ) : (
          <ReviewStatusNotice tone="unavailable" message="No team relationship available to show rules for." />
        )}
      </div>
    </div>
  )
}

/**
 * Broad-browse mode: reached from a search result, never from the personal
 * navigation. Shows a real identity's PUBLISHED rules regardless of the
 * viewer's own team -- broad exploration, not a personalised view -- with
 * a banner that says exactly that, so it is never mistaken for "your own
 * team's rules". If the identity_key doesn't resolve to real content, this
 * says so rather than silently falling back to the viewer's own team.
 */
async function BrowseRulesContent({ supabase, identityKey }: { supabase: Awaited<ReturnType<typeof createClient>>; identityKey: string }) {
  const result = await getRulesBundleByIdentity(supabase, identityKey)

  if (result.status === "error") return <ReviewStatusNotice tone="unavailable" message="Rules for this age group are temporarily unavailable. Please try again shortly." />
  if (result.status === "empty" || result.status === "no-mapping") return <ReviewStatusNotice tone="reviewing" message="No published rules were found for that age group." />

  const rows = result.rows
  const codeLabel = rows[0]?.identity_rugby_code === "league" ? "Rugby League" : "Rugby Union"
  const identityLabel = rows[0]?.identity_label ?? "this age group"

  return (
    <div>
      <div className="mb-4 rounded-xl border border-mint-300/60 bg-mint-100/50 px-4 py-3">
        <p className="text-sm text-forest-900">
          Showing rules for <span className="font-semibold">{identityLabel}</span> ({codeLabel}) &mdash; not necessarily your own team&apos;s rules.
        </p>
      </div>
      <RulesCards rows={rows} supabase={supabase} />
    </div>
  )
}

async function RulesContent({ supabase, teamId }: { supabase: Awaited<ReturnType<typeof createClient>>; teamId: string }) {
  const identity = await getRugbyHubIdentityContext(supabase, teamId)

  if (identity.mappingType === "NO_DIRECT_MAPPING") {
    return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group. Ovalball does not invent one — check with your club for locally-agreed playing arrangements." />
  }
  if (!identity.regulatoryIdentityId) {
    return <ReviewStatusNotice tone="reviewing" message="This age group hasn't been mapped to a regulatory identity yet — age-grade rules aren't available here for it." />
  }

  const result = await getRulesBundle(supabase, teamId, identity)

  if (result.status === "error") return <ReviewStatusNotice tone="unavailable" message="Rules for this context are temporarily unavailable. Please try again shortly." />
  if (result.status === "no-mapping") return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group." />
  if (result.status === "empty") return <ReviewStatusNotice tone="reviewing" message="Detailed rules for this age group are being reviewed and aren't published here yet." />

  return <RulesCards rows={result.rows} supabase={supabase} />
}

/** "General Law" vs "Your Age Grade's Variation" -- the Tier-1/Tier-2 merge distinction. Only get_rugby_hub_rules/get_rugby_hub_rules_by_identity carry is_tier1_variation; other regulatory domains (Safeguarding, Player Welfare) don't have the concept and show no badge. */
function tierLabelFor(row: RulesRow | RulesByIdentityRow): string | null {
  if (row.is_tier1_variation == null) return null
  return row.is_tier1_variation ? "Your Age Grade's Variation" : "General Law"
}

async function RulesCards({ rows, supabase }: { rows: RulesRow[] | RulesByIdentityRow[]; supabase: Awaited<ReturnType<typeof createClient>> }) {
  const sourceMetadata = await getSourceMetadata(supabase, rows.map((r) => r.primary_source_key))
  const { length, width, rest } = groupPitchDimensions(rows)

  // A section can now hold more than one fact (e.g. Tackle & Breakdown) --
  // grouped here so the section-level anchor and heading render once, with
  // each fact getting its own display_title-derived card title instead of
  // colliding on the shared section label.
  const sectionOrder: string[] = []
  const bySection = new Map<string, (RulesRow | RulesByIdentityRow)[]>()
  for (const row of rest) {
    if (!bySection.has(row.section_key)) {
      bySection.set(row.section_key, [])
      sectionOrder.push(row.section_key)
    }
    bySection.get(row.section_key)!.push(row)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(length || width) && (
        <div className="sm:col-span-2">
          <RegulatoryFactCard
            anchorId="section-PITCH"
            title="Pitch"
            valueDisplay={[length ? `Length: ${formatRulesValue(length)}` : null, width ? `Width: ${formatRulesValue(width)}` : null].filter(Boolean).join(" · ")}
            tierLabel={tierLabelFor(length ?? width!)}
            sourceKey={length?.primary_source_key ?? width?.primary_source_key ?? null}
            locator={length?.primary_source_locator ?? width?.primary_source_locator ?? null}
            sourceMetadata={sourceMetadata.get((length ?? width)?.primary_source_key ?? "")}
          />
        </div>
      )}
      {sectionOrder.map((sectionKey) => {
        const sectionRows = bySection.get(sectionKey)!
        const sectionLabel = RULES_SECTION_LABELS[sectionKey] ?? sectionKey

        if (sectionRows.length === 1) {
          const row = sectionRows[0]
          return (
            <RegulatoryFactCard
              key={row.fact_id}
              anchorId={`section-${sectionKey}`}
              title={row.display_title ?? sectionLabel}
              valueDisplay={formatRulesValue(row)}
              isOverlay={row.is_overlay ?? false}
              tierLabel={tierLabelFor(row)}
              sourceKey={row.primary_source_key}
              locator={row.primary_source_locator}
              sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
            />
          )
        }

        return (
          <div key={sectionKey} id={`section-${sectionKey}`} className="scroll-mt-24 sm:col-span-2">
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{sectionLabel}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sectionRows.map((row) => (
                <RegulatoryFactCard
                  key={row.fact_id}
                  title={row.display_title ?? sectionLabel}
                  valueDisplay={formatRulesValue(row)}
                  isOverlay={row.is_overlay ?? false}
                  tierLabel={tierLabelFor(row)}
                  sourceKey={row.primary_source_key}
                  locator={row.primary_source_locator}
                  sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
