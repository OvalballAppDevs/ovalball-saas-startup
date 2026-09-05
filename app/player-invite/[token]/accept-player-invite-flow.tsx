"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

/**
 * The accepting user's own real Supabase Auth session links their own
 * auth.uid() to the invited player_id -- there is no password field here
 * at all (never the Parent setting one on the child's behalf).
 */
export function AcceptPlayerInviteFlow({ token, playerFirstName }: { token: string; playerFirstName: string }) {
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setPending(true)
    setError(null)
    const supabase = createClient()
    const { error: acceptError } = await supabase.rpc("accept_player_account_invitation", { p_token: token })
    setPending(false)
    if (acceptError) {
      setError(acceptError.message)
      return
    }
    setAccepted(true)
  }

  if (accepted) {
    return (
      <div className="mt-8 rounded-lg border border-forest-200 bg-forest-50 p-5">
        <p className="text-sm font-medium text-ink">You&rsquo;re connected to {playerFirstName}&rsquo;s player profile.</p>
        <a href="/dashboard" className="mt-3 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Go to your dashboard
        </a>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <Button type="button" className="h-11 px-6" disabled={pending} onClick={handleAccept}>
        {pending ? "Connecting…" : "Accept and connect"}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  )
}
