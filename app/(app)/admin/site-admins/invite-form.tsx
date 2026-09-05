"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { inviteSiteAdmin } from "./actions"
import { ADMIN_PROFILES } from "./profiles"

export function InviteSiteAdminForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [adminRole, setAdminRole] = useState<string>("full")
  const [status, setStatus] = useState<"idle" | "saving" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  function reset() {
    setOpen(false)
    setStatus("idle")
    setInviteLink(null)
    setEmail("")
    setAdminRole("full")
  }

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Invite Site Administrator
      </Button>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setStatus("saving")
    setError(null)
    const result = await inviteSiteAdmin(email.trim(), adminRole)
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
        <p className="text-sm font-medium text-ink">Invitation sent to {email}</p>
        <p className="mt-1 text-sm text-ink/55">
          No email provider is connected yet in development, so share this link with them directly:
        </p>
        <code className="mt-2 block truncate rounded-md bg-ink/5 px-3 py-2 text-xs text-ink/70">{inviteLink}</code>
        <Button type="button" variant="outline" className="mt-3 h-9" onClick={reset}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Invite Site Administrator</p>
      <p className="mt-1 text-sm text-ink/55">
        Grants global Ovalball administrative access, entirely separate from club membership. The recipient must
        accept while signed in with this exact email address.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="site-admin-invite-email" className="text-ink/80">
            Email address
          </Label>
          <Input
            id="site-admin-invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="site-admin-invite-role" className="text-ink/80">
            Admin access profile
          </Label>
          <select
            id="site-admin-invite-role"
            value={adminRole}
            onChange={(e) => setAdminRole(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            {ADMIN_PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-3 text-xs text-ink/45">{ADMIN_PROFILES.find((p) => p.value === adminRole)?.description}</p>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" className="h-9" disabled={!email.trim() || status === "saving"}>
          {status === "saving" ? "Sending…" : "Send invitation"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
