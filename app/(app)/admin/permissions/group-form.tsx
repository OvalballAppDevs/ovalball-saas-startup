"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { CLUB_ROLE_LABEL, TEAM_PERMISSION_OPTIONS, type ClubRole } from "@/lib/permissions/role-labels"

import { createPermissionGroup, updatePermissionGroup } from "./actions"
import { CATEGORY_LABEL, type Capability, type PermissionGroup } from "./types"

/** Labels come from the canonical CLUB_ROLE_LABEL; the explanatory hint stays page-specific (this role-mapping dialog is the one place that needs it). */
const ROLE_OPTIONS: { value: ClubRole; label: string; hint: string }[] = [
  { value: "CLUB_ADMIN", label: CLUB_ROLE_LABEL.CLUB_ADMIN, hint: "Full club administration -- people, teams, profile, fixtures." },
  { value: "FIXTURE_SECRETARY", label: CLUB_ROLE_LABEL.FIXTURE_SECRETARY, hint: "Fixture requests and calendar sharing club-wide, no people/profile management." },
  { value: "BASIC_USER", label: CLUB_ROLE_LABEL.BASIC_USER, hint: "Club-wide membership with no club-wide administrative authority." },
]

function groupCapabilities(capabilities: Capability[]): [string, Capability[]][] {
  const byCategory = new Map<string, Capability[]>()
  for (const c of capabilities) {
    const list = byCategory.get(c.category) ?? []
    list.push(c)
    byCategory.set(c.category, list)
  }
  return [...byCategory.entries()]
}

/**
 * A group's real enforcement mapping (which real role/team-permission
 * value it resolves to) is only choosable at CREATE time, from a fixed
 * list of already-implemented values -- editing an existing group can
 * only change its name/description/documented capability list, never
 * what it actually grants. This is the boundary this feature is built
 * around: configuring existing functionality, never inventing new
 * authorization.
 */
export function GroupForm({
  capabilities,
  editing,
  triggerLabel,
  triggerVariant = "default",
  triggerClassName = "h-10",
}: {
  capabilities: Capability[]
  editing?: PermissionGroup
  triggerLabel: string
  triggerVariant?: "default" | "outline" | "ghost"
  triggerClassName?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(editing?.name ?? "")
  const [description, setDescription] = useState(editing?.description ?? "")
  const [scopeType, setScopeType] = useState<"club" | "team">(editing?.scopeType === "team" ? "team" : "club")
  const [mapsToRole, setMapsToRole] = useState<"BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY">(editing?.mapsToRole ?? "CLUB_ADMIN")
  const [mapsToTeamPermission, setMapsToTeamPermission] = useState<"view_only" | "coach" | "manager" | "team_admin">(
    editing?.mapsToTeamPermission ?? "team_admin"
  )
  const [selectedCaps, setSelectedCaps] = useState<Set<string>>(new Set(editing?.capabilityKeys ?? []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleCap(key: string) {
    setSelectedCaps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = editing
      ? await updatePermissionGroup({ groupId: editing.id, name, description, capabilityKeys: [...selectedCaps] })
      : await createPermissionGroup({
          name,
          description,
          scopeType,
          mapsToRole: scopeType === "club" ? mapsToRole : null,
          mapsToTeamPermission: scopeType === "team" ? mapsToTeamPermission : null,
          capabilityKeys: [...selectedCaps],
        })
    setSaving(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={triggerVariant} className={triggerClassName} />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New permission group"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Name, description, and the documented capability list can change. What this group actually grants cannot."
              : "Choose which real access level this group grants, then document what it includes."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="group-name" className="text-ink/80">
              Name
            </Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-11 border-ink/15 bg-white" autoFocus />
          </div>
          <div>
            <Label htmlFor="group-description" className="text-ink/80">
              Description
            </Label>
            <textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>

          {!editing && (
            <div>
              <Label className="text-ink/80">Scope</Label>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setScopeType("club")}
                  className={`h-9 rounded-full border px-3.5 text-sm ${scopeType === "club" ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70"}`}
                >
                  Club-wide
                </button>
                <button
                  type="button"
                  onClick={() => setScopeType("team")}
                  className={`h-9 rounded-full border px-3.5 text-sm ${scopeType === "team" ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70"}`}
                >
                  Team-scoped
                </button>
              </div>
            </div>
          )}

          {!editing && scopeType === "club" && (
            <div>
              <Label className="text-ink/80">Grants the real access level of</Label>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {ROLE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-2.5 rounded-lg border border-ink/10 bg-white p-3 text-sm">
                    <input type="radio" checked={mapsToRole === opt.value} onChange={() => setMapsToRole(opt.value)} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-ink">{opt.label}</span>
                      <span className="block text-xs text-ink/50">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!editing && scopeType === "team" && (
            <div>
              <Label className="text-ink/80">Grants the real team permission of</Label>
              <select
                value={mapsToTeamPermission}
                onChange={(e) => setMapsToTeamPermission(e.target.value as typeof mapsToTeamPermission)}
                className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                {TEAM_PERMISSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label className="text-ink/80">Documented capabilities</Label>
            <p className="mt-0.5 text-xs text-ink/45">
              What this group is documented to include -- for clarity, not the enforcement itself.
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {groupCapabilities(capabilities).map(([category, caps]) => (
                <div key={category}>
                  <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{CATEGORY_LABEL[category] ?? category}</p>
                  <div className="mt-1 flex flex-col gap-1">
                    {caps.map((cap) => (
                      <label key={cap.key} className="flex items-center gap-2 text-sm text-ink/80">
                        <input type="checkbox" checked={selectedCaps.has(cap.key)} onChange={() => toggleCap(cap.key)} className="accent-pitch-600" />
                        {cap.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button type="button" className="h-10 w-full" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create group"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
