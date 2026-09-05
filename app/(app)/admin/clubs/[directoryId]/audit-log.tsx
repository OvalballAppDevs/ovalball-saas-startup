import type { Json } from "@/types/database.types"

interface AuditEntry {
  id: string
  action: string
  changedAt: string
  changedByLabel: string
  before: Json | null
  after: Json | null
}

/**
 * audit_row_change (existing trigger, not new this feature) stores a full
 * before/after row snapshot -- diffed here into just the fields that
 * actually changed, since a Site Admin reviewing "what changed on this
 * club" cares about that, not a wall of unchanged columns repeated every
 * entry. club_directory/clubs never hold personal member data (that's
 * profiles/club_memberships, audited separately), so there's nothing
 * sensitive in these snapshots to avoid storing.
 */
export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink/50">No changes recorded yet for this club.</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {actionLabel(entry.action)}
              {entry.action === "update" && entry.before && entry.after && (
                <span className="ml-1.5 font-normal text-ink/50">
                  &middot; {diffFields(entry.before, entry.after).join(", ") || "no field changes"}
                </span>
              )}
            </p>
            <p className="text-xs text-ink/40">{formatTimestamp(entry.changedAt)}</p>
          </div>
          <p className="mt-1 text-xs text-ink/45">{entry.changedByLabel}</p>
        </li>
      ))}
    </ul>
  )
}

function actionLabel(action: string): string {
  switch (action) {
    case "insert":
      return "Record created"
    case "update":
      return "Record updated"
    case "delete":
      return "Record deleted"
    default:
      return action
  }
}

function diffFields(before: Json, after: Json): string[] {
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const changed: string[] = []
  for (const key of Object.keys(a)) {
    if (key === "updated_at" || key === "updated_by") continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changed.push(humanizeField(key))
    }
  }
  return changed
}

function humanizeField(key: string): string {
  return key.replace(/_/g, " ")
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
