"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { MessageCircle, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/profile/user-avatar"

import { getFixtureMessageRecipients, sendAdminFixtureMessage, type MessageRecipient } from "../actions"

export interface FixtureMessage {
  id: string
  senderName: string
  body: string
  createdAt: string
  isSiteAdminMessage: boolean
}

/**
 * The ONE embedded conversation section on this page -- no separate
 * preview card linking out to a duplicate view. Sending requires the
 * manage_fixture_support capability (send_fixture_support_message, which
 * flags the message is_site_admin_message so it renders visibly as
 * Ovalball support, never indistinguishable from either club's own
 * messages); a Site Admin without that capability sees the history (if
 * their role permits, per canSeeContent upstream) but no send box.
 *
 * Design pass (frontend-design -> ui-ux-pro-max -> Impeccable, refinement
 * only, existing forest-950/chalk/pitch-green tokens -- reuses the
 * pre-existing UserAvatar primitive rather than inventing a new avatar
 * treatment): a plain bordered box with flat text bubbles read as an
 * afterthought next to the rest of this page's polished hero card. A
 * support message now carries its own icon-badged identity (ShieldCheck,
 * not just a text pill) and a slightly stronger accent so it's instantly
 * distinct scanning a long thread; every message gets an avatar so the
 * list reads as a real conversation, not a log.
 */
export function MessagePanel({
  fixtureId,
  messages,
  canSend,
  showSupportCapabilityHint = true,
}: {
  fixtureId: string
  messages: FixtureMessage[]
  canSend: boolean
  /** The "ask a Full Site Admin to grant this" hint is Site-Admin-specific and meaningless (and misleading) for a club viewer who was never eligible for fixture-support posting in the first place -- set false for a non-Site-Admin viewer so they just see read-only history instead. */
  showSupportCapabilityHint?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<MessageRecipient[] | null>(null)

  useEffect(() => {
    getFixtureMessageRecipients(fixtureId).then(setRecipients)
  }, [fixtureId])

  async function handleSend() {
    setSending(true)
    setError(null)
    const result = await sendAdminFixtureMessage(fixtureId, body)
    setSending(false)
    if (result.ok) {
      setBody("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/12 bg-ink/[0.015] px-4 py-8 text-center">
          <MessageCircle className="size-5 text-ink/25" aria-hidden="true" />
          <p className="text-sm text-ink/45">No messages on this fixture yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="flex items-start gap-2.5">
              {m.isSiteAdminMessage ? (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-forest-800/25 bg-forest-800 text-white">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                </div>
              ) : (
                <UserAvatar avatarUrl={null} name={m.senderName} size="sm" />
              )}
              <div
                className={`min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 ${
                  m.isSiteAdminMessage ? "border-forest-800/20 bg-forest-800/[0.06]" : "border-ink/10 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    {m.senderName}
                    {m.isSiteAdminMessage && (
                      <span className="rounded-full bg-forest-800/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-forest-900 uppercase">
                        Ovalball support
                      </span>
                    )}
                  </p>
                  <p className="shrink-0 text-xs text-ink/40">{new Date(m.createdAt).toLocaleString("en-GB")}</p>
                </div>
                <p className="mt-1 text-sm break-words text-ink/70">{m.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canSend ? (
        <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-ink/[0.015] p-3.5">
          <p className="text-xs text-ink/45">
            {recipients === null
              ? "Checking who will receive this…"
              : recipients.length === 0
                ? "No club officials with a relationship to this fixture were found -- this message would have no recipient."
                : `Sends to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}: ${recipients.map((r) => `${r.name} (${r.roleLabel})`).join(", ")}`}
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Send an operational message about this fixture (e.g. kickoff time change)…"
            rows={2}
            className="w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-ink/40">
              <ShieldCheck className="size-3.5 text-forest-800/60" aria-hidden="true" />
              Posts visibly as Ovalball support, audited to your account.
            </p>
            <Button type="button" className="h-9 shrink-0" disabled={sending || !body.trim()} onClick={handleSend}>
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        </div>
      ) : showSupportCapabilityHint ? (
        <p className="rounded-lg border border-dashed border-ink/15 bg-ink/[0.02] px-3.5 py-2.5 text-xs text-ink/45">
          Fixture support access is required to post here as Ovalball support -- a Full Site Admin can grant it from
          Site Admin Management.
        </p>
      ) : null}
    </div>
  )
}
