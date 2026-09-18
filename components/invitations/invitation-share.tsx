"use client"

import { useState } from "react"
import { Check, Copy, QrCode } from "lucide-react"

import { Button } from "@/components/ui/button"

export interface InvitationShareData {
  /** The canonical /join link. */
  url: string
  /** The ten-character human code, in XXXXX-XXXXX form. */
  code: string | null
  /** Pre-rendered on the server, of the same url. */
  qrSvg: string | null
  /** Already-worded outcome lines, from the invitation's own record. */
  outcome: string[]
  expiresLabel: string | null
  /** Who it was sent to, where the invitation is bound to an address. */
  sentTo?: string | null
  /** A resend rotates both secrets, so the previous link stops working. */
  replacesPrevious?: boolean
}

/**
 * ONE INVITATION, READY TO HAND TO SOMEBODY.
 *
 * Three ways to pass on the SAME credential: a link to send, a code to read out,
 * and a QR to hold up or print. They are not three systems -- the QR encodes the
 * link, and the code and the link resolve to the same invitation and the same
 * redemption. None of them is the only way to do anything.
 *
 * IT SAYS IT WILL NOT BE SHOWN AGAIN, BECAUSE IT WILL NOT. Ovalball stores only
 * hashes of the token and the code, deliberately, so there is no "show me that
 * code again" to build and nothing to reconstruct it from. A product that leaves
 * that unsaid invites somebody to close the panel and come back for it.
 */
export function InvitationShare({ invitation }: { invitation: InvitationShareData }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null)
  const [showQr, setShowQr] = useState(false)

  async function copy(what: "link" | "code", value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500)
    } catch {
      // A browser that refuses the clipboard is not an error state worth a
      // dialog: the value is on screen and selectable, which is the fallback.
      setCopied(null)
    }
  }

  return (
    <div className="rounded-lg border border-pitch-600/30 bg-pitch-50/40 px-4 py-4">
      <p className="text-sm font-semibold text-ink">Invitation ready</p>
      {invitation.sentTo && <p className="mt-0.5 text-sm text-ink-muted">Emailed to {invitation.sentTo}.</p>}
      {invitation.outcome.length > 0 && (
        <p className="mt-1 text-sm text-ink-muted">Accepting it gives them {invitation.outcome.join(" · ")}.</p>
      )}
      {invitation.expiresLabel && <p className="mt-0.5 text-sm text-ink-muted">Expires {invitation.expiresLabel}.</p>}
      {invitation.replacesPrevious && (
        <p className="mt-1 text-sm font-medium text-ink">The link and code they were sent before no longer work.</p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor="invitation-link" className="text-xs font-medium text-ink-muted">
          Invitation Link
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="invitation-link"
            readOnly
            value={invitation.url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-2.5 font-mono text-xs text-ink outline-none focus-visible:border-pitch-600"
          />
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => copy("link", invitation.url)}>
            {copied === "link" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
            <span className="ml-1.5">{copied === "link" ? "Copied" : "Copy Link"}</span>
          </Button>
        </div>
      </div>

      {invitation.code && (
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="invitation-code" className="text-xs font-medium text-ink-muted">
            Invitation Code
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="invitation-code"
              readOnly
              value={invitation.code}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 w-40 shrink-0 rounded-lg border border-ink/15 bg-white px-2.5 font-mono text-sm tracking-[0.12em] text-ink outline-none focus-visible:border-pitch-600"
            />
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => copy("code", invitation.code!)}>
              {copied === "code" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              <span className="ml-1.5">{copied === "code" ? "Copied" : "Copy Code"}</span>
            </Button>
          </div>
          <p className="text-xs text-ink-muted">They can type this at ovalball.com/join instead of using the link.</p>
        </div>
      )}

      {invitation.qrSvg && (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" className="h-9" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
            <QrCode aria-hidden="true" className="size-4" />
            <span className="ml-1.5">{showQr ? "Hide QR Code" : "Show QR Code"}</span>
          </Button>
          {showQr && (
            <figure className="mt-3 w-fit rounded-lg border border-ink/10 bg-white p-3">
              {/* The SVG is generated server-side from the same link. It is
                  decoration for anything that cannot scan it, so it is hidden
                  from assistive technology and the caption carries the meaning. */}
              <div aria-hidden="true" className="[&>svg]:size-40" dangerouslySetInnerHTML={{ __html: invitation.qrSvg }} />
              <figcaption className="mt-2 max-w-40 text-xs text-ink-muted">
                Scanning this opens the same invitation link.
              </figcaption>
            </figure>
          )}
        </div>
      )}

      {/* Said plainly, because it is true and cannot be worked around: only
          hashes are kept, so there is nothing to show again. */}
      <p className="mt-3 text-xs text-ink-muted">
        Copy what you need now &mdash; Ovalball does not keep the link or the code, so this is the only time they can be shown. If
        they are lost, resend the invitation to issue new ones.
      </p>
    </div>
  )
}
