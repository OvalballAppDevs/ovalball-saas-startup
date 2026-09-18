"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { InvitationShare, type InvitationShareData } from "@/components/invitations/invitation-share"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createInvitation, type StaffRoleOption } from "./actions"

/**
 * The roles on offer come from the role catalogue, narrowed by the database to what an invitation is
 * allowed to carry -- not from a list written here. A second list in TypeScript is a second
 * catalogue, and it drifts silently, because nothing fails when the two disagree.
 *
 * Team Administration is absent for that reason rather than by a filter: it is already
 * `visible = false` in the catalogue, because it is a capability bundle held on top of Coach or Team
 * Manager rather than a role somebody is invited into.
 */
interface InviteFormProps {
  clubId: string
  clubName: string
  teams: { id: string; displayName: string }[]
  roleOptions: StaffRoleOption[]
}

export function InviteForm({ clubId, clubName, teams, roleOptions }: InviteFormProps) {
  const clubRoleOptions = roleOptions.filter((option) => !option.heldAtTeam)
  const teamRoleOptions = roleOptions.filter((option) => option.heldAtTeam)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [declaredRole, setDeclaredRole] = useState("")
  const [clubRole, setClubRole] = useState("")
  const [selectedTeams, setSelectedTeams] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<"idle" | "saving" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<InvitationShareData | null>(null)

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Invite someone
      </Button>
    )
  }

  const teamAssignments = Object.entries(selectedTeams)
    .filter(([, roleKey]) => roleKey)
    // The team NAME travels with the assignment so the result panel can say
    // "Under 12 Boys: Coach" without a second lookup inventing its own wording.
    .map(([teamId, roleKey]) => ({ teamId, roleKey, teamName: teams.find((t) => t.id === teamId)?.displayName }))

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
      setShare(result.share)
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "sent" && share) {
    return (
      <div className="flex flex-col gap-3">
        {/* THE MOMENT THE CREDENTIAL EXISTS.
            This used to print the raw link under an apology about development
            email, and threw the human code away entirely -- so the one artefact
            a volunteer can read down a phone was generated, hashed and
            discarded, every time. */}
        <InvitationShare invitation={share} />
        <Button
          type="button"
          variant="outline"
          className="h-9 self-start"
          onClick={() => {
            setOpen(false)
            setStatus("idle")
            setShare(null)
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
            Email Address
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
            Their Real-World Role (Optional)
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
          Club-Wide Role (Optional)
        </Label>
        <select
          id="invite-club-role"
          value={clubRole}
          onChange={(e) => setClubRole(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600 sm:w-64"
        >
          <option value="">None</option>
          {clubRoleOptions.map((option) => (
            <option key={option.roleKey} value={option.roleKey}>
              {option.label}
            </option>
          ))}
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
                  {teamRoleOptions.map((option) => (
                    <option key={option.roleKey} value={option.roleKey}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

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
