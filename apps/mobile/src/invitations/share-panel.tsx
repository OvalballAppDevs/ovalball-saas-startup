import { useState } from "react"
import { Pressable, Share, Text, View } from "react-native"
import * as Clipboard from "expo-clipboard"

import type { InvitationShareData } from "@ovalball/contracts/invitations"

import { QrCode } from "./qr"
import { Button } from "../components/ui"
import { Check, Copy, QrCode as QrIcon } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE MOMENT THE CREDENTIAL EXISTS -- the website's `InvitationShare` panel, natively.
 *
 * One fresh invitation, three forms of the same secret: the LINK, the human CODE somebody can read down
 * a phone, and a QR of the link a phone camera can scan. Copy and share use the phone's own clipboard
 * and share sheet. Nothing here stores anything: when the panel closes, the secret is gone, and the
 * product says so rather than implying it can be looked up later. A resend shows the same panel with
 * a warning that the previous link and code no longer work.
 */
export function InvitationSharePanel({ share, onDone }: { share: InvitationShareData; onDone?: () => void }) {
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState<"link" | "code" | null>(null)

  async function copy(kind: "link" | "code", value: string) {
    await Clipboard.setStringAsync(value)
    setCopied(kind)
    setTimeout(() => setCopied(null), 2000)
  }

  async function shareLink() {
    try {
      await Share.share({ message: share.code ? `${share.url}\n\nOr enter the code ${share.code}` : share.url, url: share.url })
    } catch {
      // The person dismissed the sheet, or the platform has none. Nothing to report.
    }
  }

  return (
    <View style={{ gap: space.md }}>
      {share.replacesPrevious && (
        <View style={{ backgroundColor: colour.warningSurface, borderRadius: radius.md, padding: space.md }}>
          <Text style={[type.small, { color: colour.ink }]}>A new link and a new code. The link and code they were sent before no longer work.</Text>
        </View>
      )}
      {share.outcome.length > 0 && (
        <View>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>What accepting gives them</Text>
          {share.outcome.map((line) => (
            <Text key={line} style={[type.small, { color: colour.ink }]}>{line}</Text>
          ))}
        </View>
      )}

      <Row label="Invitation link" value={share.url} copied={copied === "link"} onCopy={() => void copy("link", share.url)} mono={false} />
      {share.code && <Row label="Code to read out" value={share.code} copied={copied === "code"} onCopy={() => void copy("code", share.code!)} mono />}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Share" variant="secondary" onPress={() => void shareLink()} style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={showQr ? "Hide QR code" : "Show QR code"} accessibilityState={{ expanded: showQr }} onPress={() => setShowQr((v) => !v)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: showQr ? colour.mint100 : colour.surface, opacity: pressed ? 0.7 : 1 })}>
          <QrIcon size={18} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.ink }]}>{showQr ? "Hide QR" : "QR Code"}</Text>
        </Pressable>
      </View>

      {showQr && (
        <View style={{ alignItems: "center", gap: space.sm }}>
          <QrCode value={share.url} accessibilityLabel="QR code of the invitation link" />
          <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Scanning this opens the same invitation link.</Text>
        </View>
      )}

      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {share.sentTo ? `Emailed to ${share.sentTo}. ` : "No email is sent from the phone; share the link or the code yourself. "}
        {share.expiresLabel ? `Open until ${share.expiresLabel}. ` : ""}
        The link and the code are shown now and cannot be looked up later.
      </Text>
      {onDone && <Button label="Done" variant="secondary" onPress={onDone} />}
    </View>
  )
}

function Row({ label, value, copied, onCopy, mono }: { label: string; value: string; copied: boolean; onCopy: () => void; mono: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text selectable numberOfLines={mono ? 1 : 2} accessibilityLabel={mono ? `${label} ${value.split("").join(" ")}` : `${label} ${value}`} style={[mono ? type.heading : type.small, { color: colour.ink, flex: 1, letterSpacing: mono ? 1.5 : 0 }]}>
          {value}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`} onPress={onCopy} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: copied ? colour.mint100 : "transparent", opacity: pressed ? 0.6 : 1 })}>
          {copied ? <Check size={18} color={colour.forest800} /> : <Copy size={18} color={colour.inkMuted} />}
        </Pressable>
      </View>
    </View>
  )
}
