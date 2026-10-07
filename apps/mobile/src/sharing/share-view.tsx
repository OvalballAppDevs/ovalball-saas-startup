import { useState } from "react"
import { AccessibilityInfo, Pressable, Text, View } from "react-native"
import * as Clipboard from "expo-clipboard"

import { shareMessage, shareSubjectLine, type InvitationShareData, type ShareSubject } from "@ovalball/contracts/invitations"

import { QrCode } from "./qr"
import { ShareActions } from "./share-actions"
import { PosterPanel } from "./poster"
import type { PosterIdentity, PosterSubject } from "./poster-layout"
import { Button } from "../components/ui"
import { Check, Copy, Info } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE MOMENT A LINK EXISTS -- one share screen for every invitation, joining link and referral
 * (People & Invitations; it replaces the old share panel and the Joining Pass sheet).
 *
 * LINK & QR: the link as selectable text, the human code where there is one, the QR of the link (the
 * one encoder), and the five doors -- WhatsApp, Copy Link, Messages, Email, More -- all carrying the SAME
 * link in the same prefilled words. POSTER: the same link as one picture. The QR and the poster are
 * supplementary: a person on the phone that holds the link never has to scan anything.
 *
 * Nothing here stores anything: when the screen closes, the secret is gone, and the product says so
 * rather than implying it can be looked up later. A reissue says the previous link and code stopped.
 */
export function ShareView({
  share,
  subject,
  poster,
  email,
  explainer,
  onDone,
  doneLabel = "Done",
  initialTab = "link",
}: {
  share: InvitationShareData
  subject: ShareSubject
  /** Only where the club being shared is known (its canonical name and crest). */
  poster?: { identity: PosterIdentity; subject: PosterSubject }
  /** Who an email is addressed to, when known. Never drawn on the poster. */
  email?: string | null
  /** What happens when somebody uses the link, in one sentence. */
  explainer?: string
  onDone?: () => void
  doneLabel?: string
  /** Which side opens first: Refer Clubs' "Share a Poster" opens on the poster. */
  initialTab?: "link" | "poster"
}) {
  const [tab, setTab] = useState<"link" | "poster">(poster ? initialTab : "link")
  const message = shareMessage(subject, share.url)

  return (
    <View style={{ gap: space.lg }}>
      {poster && (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colour.line }}>
          {(["link", "poster"] as const).map((key) => {
            const on = tab === key
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={key === "link" ? "Link and QR" : "Poster"}
                onPress={() => setTab(key)}
                style={{ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: on ? colour.pitch600 : "transparent", marginBottom: -1 }}
              >
                <Text style={[type.smallMedium, { color: on ? colour.forest800 : colour.inkMuted, fontFamily: on ? "Inter_600SemiBold" : "Inter_500Medium" }]}>{key === "link" ? "Link & QR" : "Poster"}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {tab === "link" || !poster ? (
        <View style={{ gap: space.lg }}>
          {share.replacesPrevious && (
            <View style={{ backgroundColor: colour.warningSurface, borderRadius: radius.md, padding: space.md }}>
              <Text style={[type.small, { color: colour.ink }]}>A new link and a new code. The link and code they were sent before no longer work.</Text>
            </View>
          )}
          {share.outcome.length > 0 && (
            <View style={{ gap: 2 }}>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>What accepting gives them</Text>
              {share.outcome.map((line) => (
                <Text key={line} style={[type.small, { color: colour.ink }]}>{line}</Text>
              ))}
            </View>
          )}

          <CopyRow label="Link" value={share.url} />
          {share.code && <CopyRow label="Code to read out" value={share.code} mono />}

          {/* SHOWN ONCE, SAID WHERE IT MATTERS: beside the link and code themselves, not in the last caption
              on the screen. Only Ovalball's hash of them is kept, so the recovery is a new one. */}
          {share.code && (
            <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
              <Info size={16} color={colour.warning} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
                {subject.kind === "INVITATION"
                  ? "Share it before you leave this screen: the link and code can't be shown again. If it's lost, reissue it from People."
                  : "Share it before you leave this screen: the link and code can't be shown again. If it's lost, make a new one."}
              </Text>
            </View>
          )}

          <View style={{ alignItems: "center", gap: space.sm }}>
            <QrCode value={share.url} size={208} accessibilityLabel="QR code of the link. Scanning it opens the same link." />
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Scanning this opens the same link.</Text>
          </View>

          <ShareActions url={share.url} message={message} subjectLine={shareSubjectLine(subject)} email={email} />

          {!!explainer && (
            <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.infoSurface }}>
              <Info size={16} color={colour.info} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{explainer}</Text>
            </View>
          )}

          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {share.sentTo ? `Emailed to ${share.sentTo}. ` : "Ovalball doesn't send it from the phone: share it in your own words. "}
            {share.expiresLabel ? `Open until ${share.expiresLabel}.` : ""}
          </Text>
        </View>
      ) : (
        <PosterPanel share={{ url: share.url, code: share.code, expiresLabel: share.expiresLabel }} identity={poster.identity} subject={poster.subject} />
      )}

      {onDone && <Button label={doneLabel} variant="secondary" onPress={onDone} />}
    </View>
  )
}

function CopyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await Clipboard.setStringAsync(value)
    setCopied(true)
    AccessibilityInfo.announceForAccessibility(`${label} copied`)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <View style={{ gap: 4 }}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
        {/* The code is read aloud, so it is never cut short -- at the largest sizes it wraps at its hyphen.
            The link may be: Copy Link copies all of it. */}
        <Text selectable numberOfLines={mono ? undefined : 2} accessibilityLabel={mono ? `${label} ${value.split("").join(" ")}` : `${label} ${value}`} style={[mono ? type.heading : type.small, { color: colour.ink, flex: 1, letterSpacing: mono ? 1.5 : 0, paddingVertical: space.sm }]}>
          {value}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`} onPress={() => void copy()} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: copied ? colour.mint100 : "transparent", opacity: pressed ? 0.6 : 1 })}>
          {copied ? <Check size={18} color={colour.forest800} /> : <Copy size={18} color={colour.inkMuted} />}
        </Pressable>
      </View>
    </View>
  )
}
