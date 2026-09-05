/**
 * The ONE fixture export CSV schema (Section BC/BD: "one CSV schema
 * shared between import and export... include stable identifiers
 * alongside human-readable fields"). `fixture_id` makes the export
 * round-trippable as an update via the import engine's fixture_id
 * detection (lib/fixtures/import-engine.ts). Shared by the Site Admin
 * global export and the club-scoped export -- one schema, never two.
 *
 * Reconciliation pass complaints 20-25: v1 (the columns up to and
 * including updated_at) was missing rugby_code, season, stable club/team
 * ids on both sides, and a real pitch identity -- the user inspected a
 * real exported file directly and found exactly those gaps. v2 adds
 * them without removing anything v1 already had, so a v1 file's columns
 * remain a strict prefix-compatible subset (a human diffing old vs new
 * exports sees only additions). FIXTURE_CSV_SCHEMA_VERSION is written as
 * a leading `# schema_version=N` comment line ahead of the header row on
 * every export -- parse-csv.ts strips any line starting with `#` before
 * treating the next line as headers, so old (v1, unversioned) files
 * import exactly as before. v3 adds venue_id/venue_name (Venue instruction
 * Section 20) directly after pitch_id/pitch_name, the same stable-id +
 * human-readable pairing every other identity column already uses.
 */
export const FIXTURE_CSV_SCHEMA_VERSION = 3

export const FIXTURE_CSV_COLUMNS = [
  "fixture_id",
  "rugby_code",
  "season_id",
  "season_label",
  "date",
  "kickoff",
  "home_club_directory_id",
  "home_club",
  "home_team_id",
  "home_team",
  "away_club_directory_id",
  "away_club",
  "away_team_id",
  "away_team",
  "competition_edition_id",
  "competition",
  "pitch_id",
  "pitch_name",
  "venue_id",
  "venue_name",
  "game_type",
  "status",
  "source",
  "home_score",
  "away_score",
  "result_status",
  "notes",
  "created_at",
  "updated_at",
] as const

export type FixtureCsvColumn = (typeof FIXTURE_CSV_COLUMNS)[number]

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function fixtureCsvSchemaVersionLine(): string {
  return `# schema_version=${FIXTURE_CSV_SCHEMA_VERSION}`
}
