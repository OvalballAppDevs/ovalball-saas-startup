"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TEAM_PERMISSION_OPTIONS as TEAM_PERMISSIONS } from "@/lib/permissions/role-labels"

import { createInvitation } from "./actions"

interface InviteFormProps {
  clubId: string
  clubName: string
  teams: { id: string; displayName: string }[]
}

export function InviteForm({ clubId, clubName, teams }: InviteFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [declaredRole, setDeclaredRole] = useState("")
  const [clubRole, setClubRole] = useState<"" | "CLUB_ADMIN" | "FIXTURE_SECRETARY">("")
  const [selectedTeams, setSelectedTeams] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<"idle" | "saving" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Invite someone
      </Button>
    )
  }

  const teamAssignments = Object.entries(selectedTeams)
    .filter(([, permission]) => permission)
    .map(([teamId, teamPermission]) => ({ teamId, teamPermission: teamPermission as (typeof TEAM_PERMISSIONS)[number]["value"] }))

  const canSubmit = email.trim().length > 0 && (clubRole || teamAssignments.length > 0)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setStatus("saving")
    setError(null)
    const result = await createInvitation({
      clubId,
      clubName,
      email: email.trim(),
      declaredRole,
      clubRole: clubRole || null,
      teamAssignments,
    })
    if (result.ok) {
      setStatus("sent")
      setInviteLink(result.inviteLink)
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "sent" && inviteLink) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm font-medium text-ink">Invitation created for {email}</p>
        <p className="mt-1 text-sm text-ink/55">
          No email provider is connected yet in development, so share this link with them directly:
        </p>
        <code className="mt-2 block truncate rounded-md bg-ink/5 px-3 py-2 text-xs text-ink/70">{inviteLink}</code>
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-9"
          onClick={() => {
            setOpen(false)
            setStatus("idle")
            setInviteLink(null)
            setEmail("")
            setDeclaredRole("")
            setClubRole("")
            setSelectedTeams({})
          }}
        >
          Done
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Invite someone</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="invite-email" className="text-ink/80">
            Email address
          </Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="invite-declared-role" className="text-ink/80">
            Their real-world role (optional)
          </Label>
          <Input
            id="invite-declared-role"
            value={declaredRole}
            onChange={(e) => setDeclaredRole(e.target.value)}
            placeholder="e.g. Team Manager"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="invite-club-role" className="text-ink/80">
          Club-wide role (optional)
        </Label>
        <select
          id="invite-club-role"
          value={clubRole}
          onChange={(e) => setClubRole(e.target.value as typeof clubRole)}
          className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600 sm:w-64"
        >
          <option value="">None</option>
          <option value="CLUB_ADMIN">Club Admin</option>
          <option value="FIXTURE_SECRETARY">Fixture Secretary</option>
        </select>
      </div>

      {teams.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-ink/80">Team roles (optional)</p>
          <div className="mt-2 flex flex-col gap-2">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-ink/70">{team.displayName}</span>
                <select
                  value={selectedTeams[team.id] ?? ""}
                  onChange={(e) => setSelectedTeams((prev) => ({ ...prev, [team.id]: e.target.value }))}
                  className="h-9 flex-1 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                >
                  <option value="">Not assigned</option>
                  {TEAM_PERMISSIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" className="h-9" disabled={!canSubmit || status === "saving"}>
          {status === "saving" ? "Sending…" : "Send invitation"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
