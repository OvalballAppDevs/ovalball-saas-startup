"use server"

import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export type ExportPlayerMovementsResult = { ok: true; csv: string } | { ok: false; error: string }

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * PLAYER REQUESTS Section 11: the full authorized export behind the
 * dashboard's small recent-5 log. Unlike that glance view, this
 * includes eligibility/dispensation status and reference where a
 * call-up is linked to one -- still never raw governing-body evidence
 * beyond the reference the club itself recorded.
 */
export async function exportPlayerMovementsCsv(clubId: string): Promise<ExportPlayerMovementsResult> {
  const supabase = await createClient()
  const canExport = await hasCapability(supabase, "manage_fixture_callups", "club", { clubId })
  if (!canExport) return { ok: false, error: "Not authorized to export this club's player movement history." }

  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)
  if (teamIds.length === 0) return { ok: true, csv: "player,source_team,target_team,fixture_date,request_date,status,decided_by,eligibility_status,eligibility_reference\n" }

  const { data: rows } = await supabase
    .from("fixture_player_call_up")
    .select(
      "id, status, created_at, decided_at, eligibility_rule_reference, players(first_name, surname), source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text), player_team_dispensation:eligibility_requirement_id(status, governing_body_reference)"
    )
    .or(`source_team_id.in.(${teamIds.join(",")}),target_team_id.in.(${teamIds.join(",")})`)
    .order("created_at", { ascending: false })

  const header = "player,source_team,target_team,fixture_date,opponent,request_date,status,eligibility_status,eligibility_reference\n"
  const lines = (rows ?? []).map((r) => {
    const player = r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown player"
    const fields = [
      player,
      r.source_team?.display_name ?? "",
      r.target_team?.display_name ?? "",
      r.fixtures?.kickoff_date ?? "",
      r.fixtures?.raw_opposition_text ?? "",
      r.created_at,
      r.status,
      r.player_team_dispensation?.status ?? "",
      r.player_team_dispensation?.governing_body_reference ?? r.eligibility_rule_reference,
    ]
    return fields.map((f) => csvField(String(f ?? ""))).join(",")
  })

  return { ok: true, csv: header + lines.join("\n") }
}
