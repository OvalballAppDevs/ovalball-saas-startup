"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { sendSafeguardingOfficerMessage } from "../../actions"

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!body.trim()) return
    setWorking(true)
    setError(null)
    const result = await sendSafeguardingOfficerMessage(conversationId, body)
    setWorking(false)
    if (result.ok) {
      setBody("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Reply..."
        className="rounded-md border border-ink/15 px-2.5 py-1.5 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" size="sm" className="w-fit" disabled={working || !body.trim()} onClick={handleSend}>
        Send
      </Button>
    </div>
  )
}
