"use server"

import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { loadStaffPlayers } from "@/lib/players/staff-players"

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
export async function exportPlayerMovementsCsv(clubId: string, reason: string): Promise<ExportPlayerMovementsResult> {
  const supabase = await createClient()
  const canExport = await hasCapability(supabase, "manage_fixture_callups", "club", { clubId })
  if (!canExport) return { ok: false, error: "Not authorised to export this club's player movement history." }

  // Identity/Auth Slice 4H, section S: "Export personal data without R and event | club.reporting.export".
  // This file lists named children, the teams they moved between, their dispensation status and the
  // governing-body reference the club recorded. It asked a fixtures capability and left no trace, so
  // nobody could afterwards tell that a club's roll of children had been downloaded, or why.
  //
  // record_club_export is the gate: it requires club.reporting.export (AAL R), refuses an empty reason
  // and emits an export.generated security event naming the kind and the row count. The fixtures check
  // above stays -- it is what decides whether this person may see the data at all.
  const trimmedReason = reason.trim()
  if (trimmedReason.length === 0) return { ok: false, error: "Say briefly why you need this export. It is recorded." }
  if (trimmedReason.length > 500) return { ok: false, error: "That's too long — a sentence or two is enough." }

  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)
  if (teamIds.length === 0) {
    // Still recorded. An export that returns nothing is still an attempt to take the roll away, and
    // the reason for it is still worth having.
    const { error } = await supabase.rpc("record_club_export", {
      p_club_id: clubId, p_kind: "player_movements", p_reason: trimmedReason, p_row_count: 0,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, csv: "player,source_team,target_team,fixture_date,request_date,status,decided_by,eligibility_status,eligibility_reference\n" }
  }

  const { data: rows } = await supabase
    .from("fixture_player_call_up")
    .select(
      "id, status, created_at, decided_at, eligibility_rule_reference, player_id, source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text), player_team_dispensation:eligibility_requirement_id(status, governing_body_reference)"
    )
    .or(`source_team_id.in.(${teamIds.join(",")}),target_team_id.in.(${teamIds.join(",")})`)
    .order("created_at", { ascending: false })

  const { error: recordError } = await supabase.rpc("record_club_export", {
    p_club_id: clubId,
    p_kind: "player_movements",
    p_reason: trimmedReason,
    p_row_count: (rows ?? []).length,
  })
  if (recordError) return { ok: false, error: recordError.message }

  const header = "player,source_team,target_team,fixture_date,opponent,request_date,status,eligibility_status,eligibility_reference\n"
  const exportPlayers = await loadStaffPlayers(supabase, (rows ?? []).map((r) => r.player_id))
  const lines = (rows ?? []).map((r) => {
    const player = exportPlayers.get(r.player_id)?.displayName || "Unknown player"
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
