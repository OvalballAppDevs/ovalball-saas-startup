import QRCode from "qrcode"

import { getSiteUrl } from "@/lib/site-url"
import { invitationJoinUrl as sharedJoinUrl } from "@ovalball/contracts/invitations/share"

/**
 * SHARING AN INVITATION, WITHOUT INVENTING A SECOND WAY IN.
 *
 * Slice 5 issues one credential with two forms: a 256-bit token that lives in a
 * link, and a ten-character human code somebody can read down a phone. Both
 * resolve through `preview_invitation` and the canonical redemption path in
 * `lib/invitations/redeem.ts` to the same `access_invitations` row and the same
 * redemption transaction.
 *
 * This file is the one place those become something to hand to a person. There
 * is exactly ONE share URL shape -- `/join?t=…`, the canonical redemption route
 * -- and the QR encodes that same URL rather than carrying any authority of its
 * own. A second URL format, or a QR with its own payload, would be a second
 * joining system wearing a different hat.
 *
 * NOTHING HERE PERSISTS A SECRET. The token and the code exist only in the
 * response `issue_invitation` and `resend_invitation` return, and only their
 * hashes are stored -- so this is the single moment either can be shown, and the
 * product has to say so rather than implying they can be looked up later.
 */

/** The canonical redemption route. Every link, every QR, every share. */
export function invitationJoinUrl(token: string): string {
  // CA-M11.1: one URL shape for both clients, from the shared package.
  return sharedJoinUrl(token, getSiteUrl())
}

/**
 * A QR of that same link, as an inline SVG.
 *
 * Rendered on the SERVER, so no QR library reaches the browser bundle and the
 * token is never handed to client-side code that did not already have it.
 * Error-correction level M survives a print-out or a phone screen being
 * photographed; the quiet-zone margin is the standard 4 modules reduced to 1
 * because the card around it already provides the quiet zone.
 */
export async function invitationQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 220 })
}


/**
 * WHAT AN INVITATION WILL DO, FROM THE INVITATION'S OWN RECORD.
 *
 * `intended_outcome` is authored and validated by `issue_invitation` and is what
 * redemption will actually apply -- so describing it from anywhere else, or
 * rebuilding it from what the form was set to, would be describing a different
 * invitation from the one that was sent. The shape is
 * `{ roles: string[], teams: [{ id, roles: string[] }] }`.
 */

/** The outcome as the flat list a row or a share panel prints. */

/** "25 September 2026", in the one format invitations use. */

export { describeIntendedOutcome, invitationExpiryLabel, outcomeLines, type InvitationOutcome } from "@ovalball/contracts/invitations/share"
