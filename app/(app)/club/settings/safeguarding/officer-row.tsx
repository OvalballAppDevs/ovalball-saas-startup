"use client"

import { useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

import {
  deactivateSafeguardingOfficer,
  inviteSafeguardingOfficer,
  messageSafeguardingOfficer,
  resendSafeguardingOfficerInvitation,
  revokeSafeguardingOfficerInvitation,
  updateSafeguardingOfficerContact,
} from "./actions"

export interface OfficerData {
  id: string
  officerType: "primary" | "deputy"
  contactName: string
  contactEmail: string
  status: "not_invited" | "invite_sent" | "active" | "inactive"
  pendingInvitationId: string | null
}

const STATUS_LABEL: Record<OfficerData["status"], string> = {
  not_invited: "Not invited",
  invite_sent: "Invite sent",
  active: "Active",
  inactive: "Inactive",
}

const STATUS_BADGE_STYLE: Record<OfficerData["status"], string> = {
  not_invited: "bg-ink/8 text-ink-muted",
  invite_sent: "bg-amber-500/10 text-amber-700",
  active: "bg-pitch-600/10 text-pitch-700",
  inactive: "bg-destructive/10 text-destructive-text",
}

/**
 * clubId, clubName and the sender's name are deliberately NOT props any
 * more. They used to be passed down and then handed to the server actions,
 * which meant the browser chose where a safeguarding invitation token or
 * message was emailed. The actions now resolve all three from the officer
 * assignment and the authenticated session.
 */
export function OfficerRow({
  officer,
  canManageContact,
  canMessage,
}: {
  officer: OfficerData
  canManageContact: boolean
  canMessage: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const [name, setName] = useState(officer.contactName)
  const [email, setEmail] = useState(officer.contactEmail)
  const [messageBody, setMessageBody] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSaveContact() {
    setWorking(true)
    setError(null)
    const result = await updateSafeguardingOfficerContact(officer.id, name, email)
    setWorking(false)
    if (result.ok) setEditing(false)
    else setError(result.error)
  }

  async function handleInvite() {
    setWorking(true)
    setError(null)
    setNotice(null)
    const result = await inviteSafeguardingOfficer(officer.id)
    setWorking(false)
    if (result.ok) setNotice("Invitation sent.")
    else setError(result.error)
  }

  async function handleResend() {
    setWorking(true)
    setError(null)
    setNotice(null)
    const result = await resendSafeguardingOfficerInvitation(officer.id)
    setWorking(false)
    if (result.ok) setNotice("Invitation resent.")
    else setError(result.error)
  }

  async function handleDeactivate() {
    if (!confirm(`Remove ${officer.contactName} as Safeguarding Officer? This can be undone by nominating a replacement.`)) return
    setWorking(true)
    setError(null)
    const result = await deactivateSafeguardingOfficer(officer.id)
    setWorking(false)
    if (!result.ok) setError(result.error)
  }

  async function handleSendMessage() {
    if (!messageBody.trim()) return
    setWorking(true)
    setError(null)
    setNotice(null)
    const result = await messageSafeguardingOfficer(officer.id, messageBody)
    setWorking(false)
    if (result.ok) {
      setMessaging(false)
      setMessageBody("")
      if (result.mode === "email") {
        setNotice("This message will be sent by email -- this officer doesn't have an active Ovalball account yet.")
      }
    } else {
      setError(result.error)
    }
  }

  return (
    <li className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            {officer.contactName}
            <span className="text-xs font-normal text-ink-muted">{officer.officerType === "primary" ? "Primary" : "Deputy"}</span>
          </p>
          <p className="truncate text-xs text-ink-muted">{officer.contactEmail}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_STYLE[officer.status]}`}>{STATUS_LABEL[officer.status]}</span>
      </div>

      {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}
      {notice && <p className="mt-2 text-xs text-forest-800">{notice}</p>}

      {editing && canManageContact ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-ink/10 bg-mint-100/30 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-md border border-ink/15 px-2.5 py-1.5 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-md border border-ink/15 px-2.5 py-1.5 text-sm" />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={working} onClick={handleSaveContact}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canManageContact && officer.status !== "inactive" && (
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={working} onClick={() => setEditing(true)}>
              Edit contact
            </Button>
          )}
          {canManageContact && officer.status === "not_invited" && (
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={working} onClick={handleInvite}>
              Invite to Ovalball
            </Button>
          )}
          {canManageContact && officer.status === "invite_sent" && (
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={working} onClick={handleResend}>
              Resend invite
            </Button>
          )}
          {canManageContact && officer.status === "invite_sent" && officer.pendingInvitationId && (
            <RevokeInviteButton invitationId={officer.pendingInvitationId} disabled={working} />
          )}
          {/* Offered for a pending officer too, not only an accepted one.
              The server has always had the email fallback for exactly that
              case, but this trigger required status === "active", so the
              fallback was unreachable from the product: a club whose officer
              had not yet accepted had no way to contact them through
              Ovalball at all. The label names the transport, so nobody is
              led to believe a pending officer has an in-app account. */}
          {canMessage && officer.status !== "inactive" && (
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={working} onClick={() => setMessaging((v) => !v)}>
              {officer.status === "active" ? "Message Safeguarding Officer" : "Email Safeguarding Officer"}
            </Button>
          )}
          {canManageContact && officer.status !== "inactive" && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive-text hover:bg-destructive/10" disabled={working} onClick={handleDeactivate}>
              Remove assignment
            </Button>
          )}
        </div>
      )}

      {messaging && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-ink/10 bg-mint-100/30 p-3">
          <p className="text-xs text-ink/60">
            {officer.status === "active"
              ? "This will send an Ovalball message to this officer."
              : "This officer doesn't have an active Ovalball account -- this will be sent by email instead."}
          </p>
          <textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            rows={3}
            placeholder="Your message..."
            className="rounded-md border border-ink/15 px-2.5 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={working || !messageBody.trim()} onClick={handleSendMessage}>
              Send
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => setMessaging(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function RevokeInviteButton({ invitationId, disabled }: { invitationId: string; disabled: boolean }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setWorking(true)
    setError(null)
    const result = await revokeSafeguardingOfficerInvitation(invitationId)
    setWorking(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive-text hover:bg-destructive/10" disabled={disabled || working} onClick={handleRevoke}>
        Revoke invite
      </Button>
      {error && <span className="text-xs text-destructive-text">{error}</span>}
    </>
  )
}

export function ConversationLink({ conversationId }: { conversationId: string }) {
  return (
    <Link href={`/club/settings/safeguarding/messages/${conversationId}`} className="text-sm font-medium text-forest-800 underline underline-offset-2">
      View conversation
    </Link>
  )
}
