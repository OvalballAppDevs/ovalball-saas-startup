"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { toPublicInvitationError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/client"

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<"idle" | "accepting" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setStatus("accepting")
    setError(null)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc("accept_invitation", { p_token: token })
    if (rpcError) {
      setStatus("error")
      setError(toPublicInvitationError(rpcError))
      return
    }
    router.push("/dashboard")
  }

  return (
    <div>
      <Button type="button" className="h-11 px-6" disabled={status === "accepting"} onClick={handleAccept}>
        {status === "accepting" ? "Accepting…" : "Accept invitation"}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  )
}
