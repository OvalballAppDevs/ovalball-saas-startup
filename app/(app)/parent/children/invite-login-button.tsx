"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { invitePlayerAccount } from "./actions"

/**
 * Email is optional and this is an explicit, separate step -- never
 * bundled into Add-a-Child -- with the required consent disclaimer shown
 * before anything is sent.
 */
export function InviteLoginButton({ playerId, playerFirstName }: { playerId: string; playerFirstName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (sent) {
    return <p className="text-sm text-forest-800">Login invitation sent to {email}.</p>
  }

  if (!open) {
    return (
      <button type="button" className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950" onClick={() => setOpen(true)}>
        Give {playerFirstName} their own login
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-ink/10 bg-chalk px-3 py-3">
      <p className="text-sm font-medium text-ink">Give {playerFirstName} access to Ovalball?</p>
      <p className="mt-1.5 text-xs text-ink/60">
        {playerFirstName} will receive their own Ovalball account linked to their player profile. As their Parent/Guardian, you will keep your Parent controls and can manage the permissions Ovalball
        makes available for their account. You can change these permissions later in Player Access settings. {playerFirstName}&rsquo;s account does not give them Parent, Team Admin, or Club Admin
        permissions.
      </p>
      <Input type="email" placeholder="Child email — optional" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2" />
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={pending || !email.trim()}
          onClick={async () => {
            setPending(true)
            setError(null)
            const result = await invitePlayerAccount(playerId, playerFirstName, email.trim())
            setPending(false)
            if (!result.ok) {
              setError(result.error)
              return
            }
            setSent(true)
            router.refresh()
          }}
        >
          {pending ? "Sending…" : "Send invitation"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
