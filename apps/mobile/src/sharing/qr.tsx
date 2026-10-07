import { useMemo } from "react"
import { View } from "react-native"
import Svg, { Rect } from "react-native-svg"
// The SAME encoder the website uses (`qrcode`), through its pure core -- no canvas, no DOM, no server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCore = require("qrcode/lib/core/qrcode") as { create: (text: string, options: { errorCorrectionLevel: "M" }) => { modules: { size: number; data: Uint8Array } } }

import { colour } from "../design/tokens"

/**
 * A QR OF A LINK, AND NOTHING ELSE -- the one encoder for every QR in the app: an invitation, a team's
 * joining link, a club referral, a tournament, and the same symbol printed on a poster. The website's
 * `invitationQrSvg` encodes the invitation link with error-correction M; this draws the same symbol
 * from the same library. The value passed in is the link itself, so the QR can never carry a payload
 * the link does not -- and an expired or revoked invitation stops working however long its QR survives,
 * because the server decides when the link is opened.
 */
/** The symbol's modules for a value -- the one encoder, shared by the on-screen QR and the Joining Pass. */
export function qrModules(value: string): { size: number; data: Uint8Array } | null {
  try {
    return QRCore.create(value, { errorCorrectionLevel: "M" }).modules
  } catch {
    return null
  }
}

export function QrCode({ value, size = 220, accessibilityLabel }: { value: string; size?: number; accessibilityLabel: string }) {
  const modules = useMemo(() => qrModules(value), [value])
  if (!modules) return null
  const count = modules.size
  const cell = size / (count + 2) // one module of quiet zone each side, as the website's margin: 1
  const rects: { x: number; y: number }[] = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (modules.data[row * count + col]) rects.push({ x: col, y: row })
    }
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size, backgroundColor: "#ffffff", borderRadius: 8 }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={0} y={0} width={size} height={size} fill="#ffffff" />
        {rects.map((r) => (
          <Rect key={`${r.x}-${r.y}`} x={(r.x + 1) * cell} y={(r.y + 1) * cell} width={cell + 0.2} height={cell + 0.2} fill={colour.ink} />
        ))}
      </Svg>
    </View>
  )
}
