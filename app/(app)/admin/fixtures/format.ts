export const SOURCE_LABEL: Record<string, string> = {
  club_created: "Club-created",
  site_admin_manual: "Site Admin",
  csv_import: "CSV import",
  competition_import: "Competition import",
}

export const RUGBY_CODE_LABEL: Record<string, string> = {
  union: "Union",
  league: "League",
}

export const RESULT_STATUS_LABEL: Record<string, string> = {
  awaiting_confirmation: "Awaiting confirmation",
  final: "Final",
  disputed: "Disputed",
  amendment_pending: "Amendment pending",
  external_recorded: "External",
  unverified: "Unverified",
}

export function formatFixtureDate(iso: string): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
