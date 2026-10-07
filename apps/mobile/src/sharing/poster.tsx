import { useEffect, useMemo, useRef, useState } from "react"
import { Modal, PixelRatio, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import Svg, { Defs, G, Image as SvgImage, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg"
import * as Clipboard from "expo-clipboard"
import * as Sharing from "expo-sharing"
import { Directory, File, Paths } from "expo-file-system"

import { RING_PATH } from "../components/brand"
import { Button } from "../components/ui"
import { Check, Copy, Share2, X } from "../components/icons"
import { webUrl } from "../config/environment"
import { libraryAsset } from "../media/stock-assets"
import { TOUCH_TARGET, colour, font, radius, space, type } from "../design/tokens"
import { posterCopy, wrapLines, type PosterCopy, type PosterIdentity, type PosterLine, type PosterSubject } from "./poster-layout"
import { qrModules } from "./qr"

/**
 * THE POSTER -- one link, as one picture (People & Invitations; replaces the Joining Pass).
 *
 * One composition for an invitation, a team's joining link and a club referral: Ovalball's mark, a rugby
 * photograph fading into forest, the words stacked like a matchday programme, and a white card holding the
 * club's real crest and the real QR of the link. It is drawn as vector art from the link the caller already
 * holds and the club's canonical identity, exported at 1080 x 1350, and shared through the phone's own share
 * sheet (WhatsApp, Messages, Mail, AirDrop, Save Image). Nothing is stored and nothing is issued: the picture
 * works exactly as long as the link does, for exactly whom it does, because the server decides when the
 * link is opened. It is never the only way to share -- the link and the code sit beside it.
 *
 * The QR keeps the four-module quiet zone the symbol needs, on white, never over the photograph.
 */
const W = 1080
const H = 1350
const M = 84
const WORDMARK_ON_DARK = require("../../assets/welcome/ovalball-wordmark-on-dark.png")
/** The wordmark asset is 1778 x 236. */
const WORDMARK_RATIO = 1778 / 236
/** The ring's box in RING_PATH's own coordinates (see brand.tsx). */
const RING = { x: 309.4, y: 278.0, w: 679.7, h: 419.8 }
/** Reviewed, bundled photographs (no crest, no brand, no legible text): the club's own matchday for an
 * invitation or a team, the clubhouse at first light for a referral. */
const PHOTO = {
  INVITATION: libraryAsset("matchday-floodlit-01"),
  TEAM_JOIN: libraryAsset("rugby-team-huddle-womens-01"),
  REFERRAL: libraryAsset("rugby-team-community-01"),
} as const

export interface PosterShare {
  /** The canonical link the QR encodes -- an invitation's `/join?t=`, or a referral's own link. */
  url: string
  code: string | null
  expiresLabel: string | null
}

export function PosterSheet({
  visible,
  onClose,
  share,
  identity,
  subject,
  title = "Poster",
}: {
  visible: boolean
  onClose: () => void
  share: PosterShare
  identity: PosterIdentity
  subject: PosterSubject
  title?: string
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }}>
          <Text accessibilityRole="header" style={[type.title, { flex: 1, color: colour.ink }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
            <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}>
          {visible && <PosterPanel share={share} identity={identity} subject={subject} title={title} />}
        </ScrollView>
      </View>
    </Modal>
  )
}

/**
 * THE POSTER AND ITS ACTIONS, for a sheet or a screen's own Poster tab: the preview, Share Poster (the
 * picture through the phone's share sheet) and Copy Link. One implementation, wherever it is shown.
 */
export function PosterPanel({ share, identity, subject, title = "Poster" }: { share: PosterShare; identity: PosterIdentity; subject: PosterSubject; title?: string }) {
  const { width: screenWidth } = useWindowDimensions()
  const exportArt = useRef<Svg>(null)
  const [crestReady, setCrestReady] = useState(!identity.crestUrl)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // A crest that never loads must not hold the button forever: after a few seconds the poster is shared
  // with the club's name alone rather than not at all.
  useEffect(() => {
    if (crestReady) return
    const id = setTimeout(() => setCrestReady(true), 4000)
    return () => clearTimeout(id)
  }, [crestReady])

  const copy = useMemo(() => posterCopy(identity, subject, share, webUrl), [identity, subject, share])
  const previewWidth = Math.min(screenWidth - space.lg * 2, 420)

  async function sharePoster() {
    setProblem(null)
    setBusy(true)
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setProblem("This device can't share a picture.")
        return
      }
      // The EXPORT canvas, not the preview: toDataURL draws a view at its own size times the screen's scale
      // (a size passed to it enlarges the canvas, not the drawing). The hidden copy is exactly W x H pixels.
      const base64 = await new Promise<string>((resolve, reject) => {
        const svg = exportArt.current as unknown as { toDataURL?: (cb: (data: string) => void) => void } | null
        if (!svg?.toDataURL) return reject(new Error("no canvas"))
        svg.toDataURL((data) => resolve(data.replace(/^data:image\/png;base64,/, "")))
      })
      const folder = new Directory(Paths.cache, "ovalball-poster")
      if (!folder.exists) folder.create({ intermediates: true })
      const target = new File(folder, "Ovalball Poster.png")
      if (target.exists) target.delete()
      target.write(base64, { encoding: "base64" })
      try {
        await Sharing.shareAsync(target.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: title })
      } finally {
        // The picture can carry a credential: once the share sheet has handed it on, the phone keeps no copy.
        if (target.exists) target.delete()
      }
    } catch {
      setProblem("Couldn't make the picture. Share the link instead.")
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    await Clipboard.setStringAsync(share.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const spoken = [copy.stack.map((l) => l.text).join(" "), copy.standfirst, `A QR code of the link${share.code ? `, code ${share.code.split("").join(" ")}` : ""}`, copy.expiry].filter(Boolean).join(". ")
  return (
    <View style={{ gap: space.md, alignItems: "center" }}>
      <PosterPreview width={previewWidth} share={share} identity={identity} subject={subject} copy={copy} accessibilityLabel={`${title}. ${spoken}.`} />
      {/* The export copy: off screen, hidden from VoiceOver, sized so its pixels are exactly W x H. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", left: -10000, top: 0 }}>
        <Svg ref={exportArt} width={W / PixelRatio.get()} height={H / PixelRatio.get()} viewBox={`0 0 ${W} ${H}`}>
          <PosterArt share={share} identity={identity} subject={subject} copy={copy} onCrestLoad={() => setCrestReady(true)} />
        </Svg>
      </View>

      <View style={{ alignSelf: "stretch", gap: space.sm }}>
        <Button
          label="Share Poster"
          icon={<Share2 size={16} color={colour.onForest} />}
          onPress={() => void sharePoster()}
          busy={busy || !crestReady}
          accessibilityHint="Opens the share sheet with the poster as a picture"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Link copied" : "Copy Link"}
          onPress={() => void copyLink()}
          style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: copied ? colour.mint100 : colour.surface, opacity: pressed ? 0.8 : 1 })}
        >
          {copied ? <Check size={18} color={colour.forest800} /> : <Copy size={18} color={colour.forest800} />}
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{copied ? "Link Copied" : "Copy Link"}</Text>
        </Pressable>
        {problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Share sends it as a picture: to WhatsApp, Messages or Mail, or Save Image to keep it in your photos. It is the same link
          as everywhere else, and it stops working when the link does.
        </Text>
      </View>
    </View>
  )
}

/** The poster at any width, for a screen to show inline (a share screen's Poster tab). */
export function PosterPreview({
  width,
  share,
  identity,
  subject,
  copy: given,
  accessibilityLabel,
}: {
  width: number
  share: PosterShare
  identity: PosterIdentity
  subject: PosterSubject
  copy?: PosterCopy
  accessibilityLabel?: string
}) {
  const copy = useMemo(() => given ?? posterCopy(identity, subject, share, webUrl), [given, identity, subject, share])
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `Poster. ${copy.stack.map((l) => l.text).join(" ")}. A QR code of the link.`}
      style={{ width, height: width * (H / W), borderRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest900 }}
    >
      <Svg width={width} height={width * (H / W)} viewBox={`0 0 ${W} ${H}`}>
        <PosterArt share={share} identity={identity} subject={subject} copy={copy} />
      </Svg>
    </View>
  )
}

const LEAD = { size: 132, em: 0.37, lead: 0.96 }
const ACCENT = { size: 96, em: 0.37, lead: 0.98 }
const JOINER = { size: 34, em: 0.5, lead: 1.35 }
const PLACE = { size: 44, em: 0.5, lead: 1.25 }

interface PlacedLine {
  text: string
  y: number
  size: number
  tone: PosterLine["tone"] | "standfirst"
}

/** Lay the stack out between `top` and `bottom`, shrinking it in steps until it fits. */
function layoutStack(copy: PosterCopy, top: number, bottom: number, referral: boolean): PlacedLine[] {
  let placed: PlacedLine[] = []
  for (const scale of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
    placed = []
    let y = top
    for (const line of copy.stack) {
      const spec = line.tone === "lead" ? LEAD : line.tone === "accent" ? ACCENT : line.tone === "joiner" ? JOINER : PLACE
      const size = spec.size * scale * (referral && line.tone !== "joiner" ? 1.55 : 1)
      for (const text of wrapLines(line.text, W - M * 2, size, spec.em, 2)) {
        y += size * spec.lead
        placed.push({ text, y, size, tone: line.tone })
      }
      y += line.tone === "joiner" ? 2 : 10 * scale
    }
    if (copy.standfirst) {
      const size = 40 * scale
      y += 18
      for (const text of wrapLines(copy.standfirst, W - M * 2, size, 0.5, 3)) {
        y += size * 1.3
        placed.push({ text, y, size, tone: "standfirst" })
      }
    }
    if (y <= bottom) return placed
  }
  return placed
}

/** The poster itself, in the 1080 x 1350 canvas's own units. */
function PosterArt({ share, identity, subject, copy, onCrestLoad }: { share: PosterShare; identity: PosterIdentity; subject: PosterSubject; copy: PosterCopy; onCrestLoad?: () => void }) {
  const modules = useMemo(() => qrModules(share.url), [share.url])
  const referral = subject.variant === "REFERRAL"

  const ringW = 96
  const ringH = ringW * (RING.h / RING.w)
  const wordH = 34

  // THE WHITE CARD: the club's crest on the left, the QR on the right, how to use it under the crest.
  const card = { x: M, y: 860, w: W - M * 2, h: 380 }
  const qrSize = 312
  const qr = { x: card.x + card.w - 34 - qrSize, y: card.y + (card.h - qrSize) / 2 }
  const quiet = 4
  const count = modules?.size ?? 0
  const cell = count > 0 ? qrSize / (count + quiet * 2) : 0
  const leftW = qr.x - card.x - 68
  const crest = { x: card.x + 40, y: card.y + 40, size: 132 }
  const scanLines = wrapLines(copy.scanLine, leftW, 30, 0.52, 2)
  const codeLines = copy.codeLine ? wrapLines(copy.codeLine, leftW, 22, 0.52, 3) : []

  const lines = layoutStack(copy, 250, card.y - 44, referral)
  const footLines = wrapLines([copy.expiry, copy.footnote].filter(Boolean).join(". "), W - M * 2, 24, 0.5, 2)

  return (
    <G>
      <Defs>
        <LinearGradient id="posterFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colour.forest950} stopOpacity={0.45} />
          <Stop offset="0.45" stopColor={colour.forest900} stopOpacity={0.55} />
          <Stop offset="1" stopColor={colour.forest900} stopOpacity={1} />
        </LinearGradient>
        {/* Behind the mark: a light photograph (a green pitch, a pale sky) must not swallow the wordmark's green. */}
        <LinearGradient id="posterTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colour.forest950} stopOpacity={0.7} />
          <Stop offset="1" stopColor={colour.forest950} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill={colour.forest900} />
      <SvgImage x={0} y={0} width={W} height={720} href={PHOTO[subject.variant]} preserveAspectRatio="xMidYMid slice" />
      <Rect x={0} y={0} width={W} height={722} fill="url(#posterFade)" />
      <Rect x={0} y={0} width={W} height={300} fill="url(#posterTop)" />

      {/* The mark and the wordmark: the brand without a slogan. */}
      <G transform={`translate(${M} ${84}) scale(${ringW / RING.w}) translate(${-RING.x} ${-RING.y})`}>
        <Path d={RING_PATH} fill={colour.chalk} fillRule="evenodd" />
      </G>
      <SvgImage x={M + ringW + 18} y={84 + (ringH - wordH) / 2} width={wordH * WORDMARK_RATIO} height={wordH} href={WORDMARK_ON_DARK} />

      {lines.map((l, i) =>
        l.tone === "lead" || l.tone === "accent" ? (
          <SvgText key={i} x={M - 4} y={l.y - l.size * 0.12} fill={l.tone === "accent" ? colour.mint300 : colour.chalk} fontFamily={font.display} fontSize={l.size} letterSpacing={2}>{l.text}</SvgText>
        ) : (
          <SvgText key={i} x={M} y={l.y - l.size * 0.25} fill={l.tone === "joiner" ? colour.mint300 : colour.chalk} fillOpacity={l.tone === "standfirst" ? 0.92 : 1} fontFamily={l.tone === "place" ? font.bodySemi : font.bodyMedium} fontSize={l.size}>{l.text}</SvgText>
        )
      )}

      <Rect x={card.x} y={card.y} width={card.w} height={card.h} rx={32} fill="#ffffff" />
      {identity.crestUrl ? (
        <SvgImage x={crest.x} y={crest.y} width={crest.size} height={crest.size} href={{ uri: identity.crestUrl }} preserveAspectRatio="xMidYMid meet" onLoad={onCrestLoad} />
      ) : (
        <G>
          <Rect x={crest.x} y={crest.y} width={crest.size} height={crest.size} rx={66} fill={colour.mint100} />
          <SvgText x={crest.x + crest.size / 2} y={crest.y + crest.size / 2 + 22} fill={colour.forest800} fontFamily={font.display} fontSize={64} textAnchor="middle">{initialsOf(identity.clubName)}</SvgText>
        </G>
      )}
      <Line x1={qr.x - 34} y1={card.y + 40} x2={qr.x - 34} y2={card.y + card.h - 40} stroke={colour.ink} strokeOpacity={0.12} strokeWidth={2} />
      {scanLines.map((l, i) => (
        <SvgText key={`s${i}`} x={crest.x} y={crest.y + crest.size + 52 + i * 38} fill={colour.ink} fontFamily={font.bodySemi} fontSize={30}>{l}</SvgText>
      ))}
      {codeLines.map((l, i) => (
        <SvgText key={`c${i}`} x={crest.x} y={crest.y + crest.size + 52 + scanLines.length * 38 + 8 + i * 30} fill={colour.ink} fillOpacity={0.62} fontFamily={font.body} fontSize={22}>{l}</SvgText>
      ))}
      {modules && (
        <G>
          {Array.from({ length: count * count }, (_, i) => i).filter((i) => modules.data[i]).map((i) => (
            <Rect key={i} x={qr.x + (quiet + (i % count)) * cell} y={qr.y + (quiet + Math.floor(i / count)) * cell} width={cell + 0.4} height={cell + 0.4} fill={colour.ink} />
          ))}
        </G>
      )}

      {footLines.map((line, i) => (
        <SvgText key={`f${i}`} x={M} y={H - 66 + i * 32} fill={colour.chalk} fillOpacity={0.72} fontFamily={font.body} fontSize={24}>{line}</SvgText>
      ))}
    </G>
  )
}

function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter((w) => w && !/^(rufc|rfc|rugby|club|the)$/i.test(w))
  return (words.slice(0, 2).map((w) => w[0]).join("") || name.slice(0, 2)).toUpperCase()
}
