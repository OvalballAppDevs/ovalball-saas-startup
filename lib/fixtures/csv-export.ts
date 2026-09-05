import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import { loadOpponentGroupLabels } from "@/lib/calendar/resolve-entry-participant"
import { resolveHomeAwayGroupIds } from "@/lib/fixtures/resolve-home-away-groups"

import { csvEscape, FIXTURE_CSV_COLUMNS, fixtureCsvSchemaVersionLine } from "./csv-schema"
import { resolvedTeamName } from "@/app/(app)/admin/fixtures/query"

type OverviewRow = Database["public"]["Views"]["admin_fixture_overview"]["Row"]

/**
 * The ONE row-building function behind both the Site Admin global export
 * (app/(app)/admin/fixtures/actions.ts) and the club-scoped export
 * (app/(app)/fixtures/actions.ts) -- previously duplicated verbatim
 * between the two, now genuinely shared so the schema can never drift
 * between them (Reconciliation complaint 20's "ONE versioned schema").
 * competition's human-readable column is "Name · Season" (never just the
 * bare competition name) so a club with the same competition running
 * across several seasons' exports can tell editions apart at a glance,
 * matching complaint 25's "human-readable name" alongside the stable
 * competition_edition_id.
 */
/**
 * Canonical fixture single-source-of-truth pass: previously re-derived
 * home/away names from resolvedTeamName() alone, with no idea a side
 * could be a Mini-Rugby Group -- the exact same divergence bug fixed on
 * the on-screen table (attachGroupLabels in query.ts). Same shared
 * predicate and label loader, so an exported CSV names a group fixture
 * identically to what the table and Calendar already show for it.
 */
export async function buildFixtureCsv(supabase: SupabaseClient<Database>, rows: OverviewRow[]): Promise<string> {
  const referencedGroupIds = rows.flatMap((row) => {
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds({
      owning_team_id: row.owning_team_id ?? "",
      home_team_id: row.home_team_id,
      owning_scheduling_group_id: row.owning_scheduling_group_id,
      opponent_scheduling_group_id: row.opponent_scheduling_group_id,
    })
    return [homeGroupId, awayGroupId]
  })
  const groupLabelById = await loadOpponentGroupLabels(supabase, referencedGroupIds)

  const lines = [fixtureCsvSchemaVersionLine(), FIXTURE_CSV_COLUMNS.join(",")]
  for (const row of rows) {
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds({
      owning_team_id: row.owning_team_id ?? "",
      home_team_id: row.home_team_id,
      owning_scheduling_group_id: row.owning_scheduling_group_id,
      opponent_scheduling_group_id: row.opponent_scheduling_group_id,
    })
    const homeTeamName = (homeGroupId && groupLabelById.get(homeGroupId)) || resolvedTeamName(row.home_team_category, row.home_team_age_group, row.home_team_gender, row.home_team_squad_designation, row.home_team_name)
    const awayTeamName = (awayGroupId && groupLabelById.get(awayGroupId)) || resolvedTeamName(row.away_team_category, row.away_team_age_group, row.away_team_gender, row.away_team_squad_designation, row.away_team_name)
    const competitionLabel = row.competition_name ? (row.season_canonical_name ? `${row.competition_name} · ${row.season_canonical_name}` : row.competition_name) : ""
    lines.push(
      [
        row.id ?? "",
        row.rugby_code ?? "",
        row.season_id ?? "",
        row.season_canonical_name ?? "",
        row.kickoff_date ?? "",
        row.kickoff_time ?? "",
        row.home_club_directory_id ?? "",
        row.home_club_name ?? "",
        row.home_team_id ?? "",
        homeTeamName,
        row.away_club_directory_id ?? "",
        row.away_club_name ?? "",
        row.away_team_id ?? "",
        awayTeamName,
        row.competition_edition_id ?? "",
        competitionLabel,
        row.pitch_id ?? "",
        row.pitch_name ?? "",
        row.venue_id ?? "",
        row.venue_name ?? "",
        row.game_type ?? "",
        row.status ?? "",
        row.source ?? "",
        row.home_score !== null && row.home_score !== undefined ? String(row.home_score) : "",
        row.away_score !== null && row.away_score !== undefined ? String(row.away_score) : "",
        row.result_status ?? "",
        row.notes ?? "",
        row.created_at ?? "",
        row.updated_at ?? "",
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  return lines.join("\r\n") + "\r\n"
}
