"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2, Clock, HelpCircle, MinusCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

import { disconnectGoCardless } from "./actions"

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-ink/8 text-ink/70",
  info: "bg-pitch-50 text-forest-800",
  warning: "bg-amber-100 text-amber-900",
  success: "bg-mint-100 text-forest-950",
  danger: "bg-destructive/10 text-destructive",
}

/**
 * Connection (OAuth) and verification (GoCardless creditor readiness) are
 * independent axes of state -- a club can be validly Connected while
 * verification is still Action Required, and that is not a contradiction.
 * They get their own badges rather than being flattened into one label.
 */
const CONNECTION_META = {
  connected: { label: "Connected", tone: "success", Icon: CheckCircle2 },
  disconnected: { label: "Disconnected", tone: "neutral", Icon: MinusCircle },
} as const

/**
 * verification_status mirrors GoCardless's own creditor verification_status
 * values (action_required / in_review / successful) plus an Ovalball-added
 * "unknown" fail-safe for when we haven't confirmed a real value. See
 * lib/payments/domain/state-machine.ts for the shared type.
 */
const VERIFICATION_META: Record<string, { label: string; tone: string; Icon: typeof CheckCircle2; explanation: string | null }> = {
  successful: {
    // Not "Live" -- this is a sandbox-only feature, and "Live" could read
    // as "Ovalball is production-live" to a club admin rather than
    // "GoCardless has verified this account".
    label: "Verified",
    tone: "success",
    Icon: CheckCircle2,
    explanation: null,
  },
  in_review: {
    label: "Pending",
    tone: "warning",
    Icon: Clock,
    explanation: "GoCardless is reviewing this account's verification. This usually resolves without any action from you.",
  },
  action_required: {
    label: "Action Required",
    tone: "danger",
    Icon: AlertCircle,
    explanation: "Your GoCardless account is connected, but GoCardless requires additional account verification before all payment features are available.",
  },
  unknown: {
    label: "Not Yet Confirmed",
    tone: "neutral",
    Icon: HelpCircle,
    explanation: "Ovalball hasn't yet confirmed this account's verification status with GoCardless.",
  },
}

function StatusBadge({ label, tone, Icon }: { label: string; tone: string; Icon: typeof CheckCircle2 }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {label}
    </span>
  )
}

/**
 * Connect/disconnect UI. There is no field anywhere on this page for a
 * token, secret, or API key -- "Connect GoCardless" navigates the browser
 * to our own server route (/api/gocardless/oauth/start), which redirects
 * to GoCardless; the token itself never reaches this component or any
 * client bundle.
 */
export function GoCardlessConnectPanel({
  clubId,
  connected,
  verificationStatus,
  connectedAt,
  canConnect,
}: {
  clubId: string
  connected: boolean
  verificationStatus: string | null
  connectedAt: string | null
  canConnect: boolean
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const connectionMeta = connected ? CONNECTION_META.connected : CONNECTION_META.disconnected
  const verificationMeta = VERIFICATION_META[verificationStatus ?? "unknown"] ?? VERIFICATION_META.unknown

  async function handleDisconnect() {
    if (!reason.trim()) {
      setError("A reason is required to disconnect GoCardless.")
      return
    }
    setError(null)
    const result = await disconnectGoCardless(clubId, reason)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDisconnecting(false)
    setReason("")
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">GoCardless</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink/50">Connection</span>
            <StatusBadge label={connectionMeta.label} tone={connectionMeta.tone} Icon={connectionMeta.Icon} />
          </div>
        </div>
        {canConnect && !connected && (
          <Button className="h-10" nativeButton={false} render={<a href={`/api/gocardless/oauth/start?clubId=${clubId}`} />}>
            Connect GoCardless
          </Button>
        )}
        {canConnect && connected && !disconnecting && (
          <Button type="button" variant="ghost" className="h-10" onClick={() => setDisconnecting(true)}>
            Disconnect
          </Button>
        )}
      </div>

      {connected && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-ink/50">Verification</dt>
              <dd className="mt-1">
                <StatusBadge label={verificationMeta.label} tone={verificationMeta.tone} Icon={verificationMeta.Icon} />
              </dd>
            </div>
            <div>
              <dt className="text-ink/50">Connected</dt>
              <dd className="mt-1.5 font-medium text-ink">{connectedAt ? new Date(connectedAt).toLocaleDateString("en-GB") : "—"}</dd>
            </div>
          </dl>
          {verificationMeta.explanation && <p className="mt-3 text-xs text-ink/60">{verificationMeta.explanation}</p>}
        </>
      )}

      <p className="mt-4 text-xs text-ink/50">Your club&rsquo;s bank details are held by GoCardless, never by Ovalball. Ovalball only sees connection and verification status.</p>

      {disconnecting && (
        <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-ink">Disconnect GoCardless?</p>
          <p className="mt-1 text-xs text-ink/60">
            Existing subscriptions and payment history are preserved, but no new collections can be scheduled until reconnected. This does not cancel live GoCardless subscriptions on GoCardless&rsquo;s side -- do that first if required.
          </p>
          <input type="text" placeholder="Reason for disconnecting" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600" />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="destructive" className="h-9" onClick={handleDisconnect}>
              Confirm disconnect
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => setDisconnecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
