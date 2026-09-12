import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { getSessionContext } from "@/lib/app-context/session-context"
import {
  getRugbyHubTeamOptions,
  getSourceMetadata,
  getWelfareBundle,
  getWelfareBundleByIdentity,
  resolveActiveRugbyHubTeamId,
  resolveRugbyHubAudience,
  type RugbyCode,
  type RugbyHubAudience,
  type WelfareByIdentityRow,
  type WelfareRow,
} from "@/lib/app-context/rugby-hub-data"
import { formatWelfareValue, labelForObligation, WELFARE_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Player Welfare | Rugby Hub",
  description: "Concussion and player-welfare guidance from official rugby sources.",
}

export default async function PlayerWelfarePage({ searchParams }: { searchParams: Promise<{ code?: string; identity?: string }> }) {
  const { code: browseCode, identity: browseIdentityKey } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  if (browseCode === "union" || browseCode === "league") {
    return <BrowseWelfareContent supabase={supabase} rugbyCode={browseCode} identityKey={browseIdentityKey ?? null} />
  }

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)
  const teamOptions = await getRugbyHubTeamOptions(supabase, ctx)
  const team = teamOptions.find((t) => t.teamId === teamId)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Player Welfare</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
        Concussion and player-welfare guidance for {team ? `${team.clubName}'s ${team.teamDisplayName}` : "your team"}, published by the governing body. This is guidance, never an Ovalball medical
        clearance decision.
      </p>

      <div className="mt-8">
        {teamId ? (
          <WelfareContent supabase={supabase} teamId={teamId} audience={team ? resolveRugbyHubAudience(ctx, team) : "GENERAL"} />
        ) : (
          <ReviewStatusNotice tone="unavailable" message="No team relationship available to show player-welfare guidance for." />
        )}
      </div>
    </div>
  )
}

/**
 * Broad-browse mode: reached from a search result, never from the personal
 * navigation. identity_key is optional -- Player Welfare, like Safeguarding,
 * genuinely has non-identity-scoped general guidance.
 */
async function BrowseWelfareContent({ supabase, rugbyCode, identityKey }: { supabase: Awaited<ReturnType<typeof createClient>>; rugbyCode: RugbyCode; identityKey: string | null }) {
  const result = await getWelfareBundleByIdentity(supabase, rugbyCode, identityKey)
  const sourceMetadata = await getSourceMetadata(supabase, result.status === "content" ? result.rows.map((r) => r.primary_source_key) : [])
  const codeLabel = rugbyCode === "league" ? "Rugby League" : "Rugby Union"
  const identityLabel = result.status === "content" ? result.rows[0]?.identity_label : null

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Player Welfare</h1>
      <div className="mt-6 rounded-xl border border-mint-300/60 bg-mint-100/50 px-4 py-3">
        <p className="text-sm text-forest-900">
          Showing {codeLabel} player-welfare guidance{identityLabel ? ` for ${identityLabel}` : ""} &mdash; not necessarily your own team&apos;s guidance.
        </p>
      </div>
      <div className="mt-8">
        {result.status === "error" && <ReviewStatusNotice tone="unavailable" message="Player-welfare guidance is temporarily unavailable. Please try again shortly." />}
        {result.status === "empty" && <ReviewStatusNotice tone="reviewing" message="No published player-welfare guidance was found for that context." />}
        {result.status === "content" && <WelfareCards rows={result.rows} sourceMetadata={sourceMetadata} />}
      </div>
    </div>
  )
}

async function WelfareContent({ supabase, teamId, audience }: { supabase: Awaited<ReturnType<typeof createClient>>; teamId: string; audience: RugbyHubAudience }) {
  const result = await getWelfareBundle(supabase, teamId, audience)

  if (result.status === "error") return <ReviewStatusNotice tone="unavailable" message="Player-welfare guidance is temporarily unavailable. Please try again shortly." />
  if (result.status === "no-mapping") return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official player-welfare identity for this context." />
  if (result.status === "empty") return <ReviewStatusNotice tone="reviewing" message="Detailed player-welfare guidance for this context is being reviewed and isn't published here yet." />

  const sourceMetadata = await getSourceMetadata(supabase, result.rows.map((r) => r.primary_source_key))
  return <WelfareCards rows={result.rows} sourceMetadata={sourceMetadata} />
}

function WelfareCards({ rows, sourceMetadata }: { rows: WelfareRow[] | WelfareByIdentityRow[]; sourceMetadata: Map<string, { title: string; authorityName: string; canonicalUrl: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <RegulatoryFactCard
          key={`${row.fact_id ?? ""}-${row.section_key}`}
          anchorId={`section-${row.section_key}`}
          title={WELFARE_SECTION_LABELS[row.section_key] ?? row.section_key}
          valueDisplay={row.value_integer != null ? formatWelfareValue(row) : null}
          body={row.body ?? (row.value_integer == null ? row.value_text : null)}
          obligation={labelForObligation(row.obligation_level)}
          sourceKey={row.primary_source_key}
          locator={row.primary_source_locator}
          sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
        />
      ))}
    </div>
  )
}
