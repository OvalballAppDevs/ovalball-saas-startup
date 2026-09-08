"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { askGuardianForPlayingInformation } from "./actions"

/**
 * What a club can do about missing playing information: ask for it.
 *
 * Not edit it. Gender is protected identity information about a child, and
 * running the team a child plays for is not the authority to record it. The
 * server refuses a club that tries; this offers the club the action it does
 * have, so the Needs Attention item is not a dead end.
 */
export function AskGuardianButton({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const firstName = playerName.split(" ")[0]

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-9"
        disabled={working || message !== null}
        onClick={async () => {
          setWorking(true)
          const result = await askGuardianForPlayingInformation(playerId)
          setWorking(false)
          setMessage(
            result.ok
              ? result.sent > 0
                ? `Asked ${result.sent === 1 ? "their guardian" : `their ${result.sent} guardians`}.`
                : `${firstName} has no guardian on Ovalball to ask yet.`
              : result.error
          )
        }}
      >
        {working ? "Asking…" : "Ask their guardian"}
      </Button>
      {message && (
        <p role="status" aria-atomic="true" className="max-w-56 text-right text-xs text-ink/60">
          {message}
        </p>
      )}
    </div>
  )
}
