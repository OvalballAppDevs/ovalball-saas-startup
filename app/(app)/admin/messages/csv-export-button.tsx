"use client"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ConversationRow {
  conversation_key: string | null
  kind: string | null
  fixture_owning_club_name: string | null
  fixture_opponent_club_name: string | null
  request_requesting_club_name: string | null
  request_opponent_club_name: string | null
  message_count: number | null
  open_report_count: number | null
  last_activity_at: string | null
}

/**
 * Metadata only, by construction -- this reads from the SAME rows already
 * fetched from admin_message_overview (which never selects `body`), so
 * there is no code path here that could accidentally include raw message
 * content. A separate, explicitly privileged raw-content export is not
 * built in this pass -- see the report.
 */
export function CsvExportButton({ rows }: { rows: ConversationRow[] }) {
  function handleExport() {
    const header = ["Conversation", "Type", "Club A", "Club B", "Messages", "Open reports", "Last activity"]
    const lines = rows.map((r) => {
      const clubA = r.fixture_owning_club_name ?? r.request_requesting_club_name ?? ""
      const clubB = r.fixture_opponent_club_name ?? r.request_opponent_club_name ?? ""
      return [r.conversation_key ?? "", r.kind ?? "", clubA, clubB, String(r.message_count ?? 0), String(r.open_report_count ?? 0), r.last_activity_at ?? ""]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")
    })
    const csv = [header.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ovalball-message-metadata-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleExport}>
      <Download className="size-4" />
      Export metadata (CSV)
    </Button>
  )
}
