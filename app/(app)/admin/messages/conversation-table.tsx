import { ClubAvatar } from "@/components/club/club-avatar"

import { ContentViewer } from "./content-viewer"

interface ConversationRow {
  conversation_key: string | null
  kind: string | null
  fixture_id: string | null
  fixture_request_id: string | null
  fixture_owning_club_name: string | null
  fixture_opponent_club_name: string | null
  fixture_owning_team_name: string | null
  fixture_opponent_team_name: string | null
  fixture_owning_club_logo_path: string | null
  fixture_opponent_club_logo_path: string | null
  request_requesting_club_name: string | null
  request_opponent_club_name: string | null
  request_requesting_team_name: string | null
  request_target_team_name: string | null
  request_requesting_club_logo_path: string | null
  request_opponent_club_logo_path: string | null
  message_count: number | null
  open_report_count: number | null
  last_activity_at: string | null
}

/**
 * Real club crests, never a generic "U1" placeholder -- ClubAvatar is the
 * one shared crest component this codebase already uses everywhere else,
 * degrading to initials only when a club genuinely has no logo uploaded.
 */
export function ConversationTable({ rows, canRevealContent, logoUrl }: { rows: ConversationRow[]; canRevealContent: boolean; logoUrl: (path: string | null) => string | null }) {
  if (rows.length === 0) {
    return <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/50">No conversations match these filters.</p>
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-ink/8 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
            <th scope="col" className="px-4 py-3">
              Conversation
            </th>
            <th scope="col" className="px-4 py-3">
              Type
            </th>
            <th scope="col" className="px-4 py-3">
              Messages
            </th>
            <th scope="col" className="px-4 py-3">
              Moderation
            </th>
            <th scope="col" className="px-4 py-3">
              Last activity
            </th>
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clubA = r.fixture_owning_club_name ?? r.request_requesting_club_name ?? "Unresolved"
            const clubB = r.fixture_opponent_club_name ?? r.request_opponent_club_name ?? "Unresolved"
            const teamA = r.fixture_owning_team_name ?? r.request_requesting_team_name
            const teamB = r.fixture_opponent_team_name ?? r.request_target_team_name
            const logoA = r.fixture_owning_club_logo_path ?? r.request_requesting_club_logo_path
            const logoB = r.fixture_opponent_club_logo_path ?? r.request_opponent_club_logo_path
            return (
              <tr key={r.conversation_key} className="border-b border-ink/6 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <ClubAvatar logoUrl={logoUrl(logoA)} name={clubA} size="xs" />
                      <ClubAvatar logoUrl={logoUrl(logoB)} name={clubB} size="xs" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {clubA} {teamA ? `(${teamA})` : ""} vs {clubB} {teamB ? `(${teamB})` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/60 capitalize">{r.kind}</td>
                <td className="px-4 py-3 text-ink/60">{r.message_count}</td>
                <td className="px-4 py-3">
                  {r.open_report_count && r.open_report_count > 0 ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{r.open_report_count} open report{r.open_report_count > 1 ? "s" : ""}</span>
                  ) : (
                    <span className="text-xs text-ink/35">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/50">{r.last_activity_at ? new Date(r.last_activity_at).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  {canRevealContent && (
                    <ContentViewer
                      fixtureId={r.fixture_id}
                      fixtureRequestId={r.fixture_request_id}
                      label={`${clubA} vs ${clubB}`}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
