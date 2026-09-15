import { CATEGORY_LABEL, type Capability, type PermissionGroup } from "./types"

export function GroupCard({ group, capabilities }: { group: PermissionGroup; capabilities: Capability[] }) {
  const capByKey = new Map(capabilities.map((c) => [c.key, c]))

  return (
    <div className={`rounded-lg border border-ink/10 bg-white p-4 ${!group.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-ink">{group.name}</p>
            {group.isSystem && <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-ink-muted uppercase">System</span>}
            {!group.isActive && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-destructive-text uppercase">Inactive</span>}
          </div>
          {group.description && <p className="mt-0.5 text-sm text-ink-muted">{group.description}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            Grants: {group.mapsToRole ?? group.mapsToTeamPermission} &middot; assigned to {group.assignedCount} {group.assignedCount === 1 ? "person" : "people"}
          </p>
        </div>
      </div>

      {group.capabilityKeys.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {group.capabilityKeys.map((key) => {
            const cap = capByKey.get(key)
            return (
              <span key={key} className="rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs text-ink/60" title={cap ? (CATEGORY_LABEL[cap.category] ?? cap.category) : undefined}>
                {cap?.label ?? key}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
