import { useState } from "react"
import { AccessibilityInfo, Linking, Platform, Pressable, Share, Text, View, useWindowDimensions } from "react-native"
import * as Clipboard from "expo-clipboard"

import { emailShareUrl, smsShareUrl, whatsappShareUrl } from "@ovalball/contracts/invitations"

import { Check, Copy, Ellipsis, Mail, MessageSquare, Send } from "../components/icons"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * ONE WAY TO HAND A LINK ON -- the same five doors for an invitation, a team's joining link and a club
 * referral (People & Invitations).
 *
 * WhatsApp, Messages and Email are TRANSPORTS: each opens the person's own app with the prefilled message
 * and the one canonical link, and the person chooses who it goes to. Nothing here creates a record, and
 * Ovalball sends nothing itself -- so nothing here ever says "sent". If WhatsApp is not on the phone, the
 * system share sheet opens instead, with the same words.
 */
export function ShareActions({
  url,
  message,
  subjectLine,
  email,
}: {
  url: string
  /** The prefilled message -- `shareMessage()` from the contracts, carrying `url` once. */
  message: string
  subjectLine: string
  /** The address an email is addressed to, when the screen knows it. */
  email?: string | null
}) {
  const [copied, setCopied] = useState(false)

  async function systemShare() {
    try {
      await Share.share({ message, url: Platform.OS === "ios" ? url : undefined })
    } catch {
      // The person dismissed the sheet, or the platform has none. Nothing to report.
    }
  }

  async function open(target: string) {
    try {
      if (await Linking.canOpenURL(target)) {
        await Linking.openURL(target)
        return
      }
    } catch {
      // Fall through to the system sheet.
    }
    await systemShare()
  }

  async function copyLink() {
    await Clipboard.setStringAsync(url)
    setCopied(true)
    AccessibilityInfo.announceForAccessibility("Link copied")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share via WhatsApp"
        accessibilityHint="Opens WhatsApp with the message and the link ready to send"
        onPress={() => void open(whatsappShareUrl(message))}
        style={({ pressed }) => ({ minHeight: 52, borderRadius: radius.md, backgroundColor: colour.pitch600, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg, opacity: pressed ? 0.85 : 1 })}
      >
        <WhatsAppGlyph />
        <Text style={[type.bodyMedium, { color: colour.forest950, fontFamily: "Inter_600SemiBold" }]}>Share via WhatsApp</Text>
      </Pressable>
      {/* Four across at ordinary sizes, two by two once the words would not fit beneath their icons, and one
          to a row at the very largest sizes, where even "Messages" is wider than half the screen. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Door label={copied ? "Copied" : "Copy Link"} accessibilityLabel={copied ? "Link copied" : "Copy Link"} icon={copied ? <Check size={20} color={colour.forest800} /> : <Copy size={20} color={colour.forest800} />} onPress={() => void copyLink()} active={copied} />
        <Door label="Messages" accessibilityLabel="Share by Messages" icon={<MessageSquare size={20} color={colour.forest800} />} onPress={() => void open(smsShareUrl(message, Platform.OS === "ios" ? "ios" : "android"))} />
        <Door label="Email" accessibilityLabel="Share by email" icon={<Mail size={20} color={colour.forest800} />} onPress={() => void open(emailShareUrl(message, subjectLine, email))} />
        <Door label="More" accessibilityLabel="More ways to share" icon={<Ellipsis size={20} color={colour.forest800} />} onPress={() => void systemShare()} />
      </View>
    </View>
  )
}

function Door({ label, accessibilityLabel, icon, onPress, active = false }: { label: string; accessibilityLabel: string; icon: React.ReactNode; onPress: () => void; active?: boolean }) {
  const { fontScale } = useWindowDimensions()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: fontScale > 2 ? "100%" : fontScale > LARGE_TEXT_SCALE ? "45%" : 0, minHeight: TOUCH_TARGET + 26, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: active ? colour.mint100 : colour.surface, opacity: pressed ? 0.75 : 1 })}
    >
      {icon}
      <Text style={[type.caption, { color: colour.ink, textAlign: "center" }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

/** A send arrow in our own ink: the label names WhatsApp, and its brand artwork is not ours to draw. */
function WhatsAppGlyph() {
  return <Send size={18} color={colour.forest950} />
}
