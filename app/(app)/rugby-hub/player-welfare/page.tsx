import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubTeamOptions, getSourceMetadata, getWelfareBundle, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { formatWelfareValue, labelForObligation, WELFARE_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Player Welfare | Rugby Hub",
  description: "Concussion and player-welfare guidance from official rugby sources.",
}

export default async function PlayerWelfarePage() {
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
      <h1 className="mt-3 font-display text-display-l text-ink">Player Welfare</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
        Concussion and player-welfare guidance for {team ? `${team.clubName}'s ${team.teamDisplayName}` : "your team"}, published by the governing body. This is guidance, never an Ovalball medical
        clearance decision.
      </p>

      <div className="mt-8">{teamId ? <WelfareContent supabase={supabase} teamId={teamId} /> : <ReviewStatusNotice tone="unavailable" message="No team relationship available to show player-welfare guidance for." />}</div>
    </div>
  )
}

async function WelfareContent({ supabase, teamId }: { supabase: Awaited<ReturnType<typeof createClient>>; teamId: string }) {
  const result = await getWelfareBundle(supabase, teamId, "GENERAL")

  if (result.status === "error") return <ReviewStatusNotice tone="unavailable" message="Player-welfare guidance is temporarily unavailable. Please try again shortly." />
  if (result.status === "no-mapping") return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official player-welfare identity for this context." />
  if (result.status === "empty") return <ReviewStatusNotice tone="reviewing" message="Detailed player-welfare guidance for this context is being reviewed and isn't published here yet." />

  const rows = result.rows
  const sourceMetadata = await getSourceMetadata(supabase, rows.map((r) => r.primary_source_key))

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <RegulatoryFactCard
          key={`${row.fact_id ?? ""}-${row.section_key}`}
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
