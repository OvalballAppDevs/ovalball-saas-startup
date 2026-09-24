import { useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { CameraView, useCameraPermissions } from "expo-camera"

import { invitationSecretFromScannedText } from "@ovalball/contracts/invitations"

import { webUrl } from "../src/config/environment"
import { APP_SCHEMES } from "../src/links/intents"
import { holdJoinSecret } from "../src/onboarding/join-secret"
import { EntranceLink, EntranceScreen } from "../src/components/entrance"
import { Button } from "../src/components/ui"
import { colour, radius, space, type } from "../src/design/tokens"

/**
 * SCAN AN INVITATION -- the recipient's half of the website's QR (CA-M11.1).
 *
 * The website prints a QR of the invitation LINK and nothing else. So this scanner accepts exactly one
 * thing: a URL on the Ovalball site (or the app's own scheme) whose path is `/join` and which carries a
 * token or a code. Any other QR -- another site, another path, a bare string -- is refused, never
 * followed, never opened. What it accepts is handed to the same invitation screen a tapped link
 * reaches, held in memory only, for the same preview, sign-in and acceptance the website performs.
 */
export default function ScanInvitation() {
  const router = useRouter()
  const [permission, requestPermission] = useCameraPermissions()
  const [problem, setProblem] = useState<string | null>(null)
  const handled = useRef(false)

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission()
  }, [permission, requestPermission])

  function onScanned(data: string) {
    if (handled.current) return
    const secret = invitationSecretFromScannedText(data, webUrl, APP_SCHEMES)
    if (!secret) {
      setProblem("That QR code is not an Ovalball invitation.")
      return
    }
    handled.current = true
    holdJoinSecret(secret)
    router.replace("/join")
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/get-started"))

  return (
    <EntranceScreen title="Scan the QR code" subtitle="Point the camera at the invitation's QR code. It opens the same invitation the link opens." footer={<EntranceLink label="Back" onPress={back} />}>
      <View style={{ marginTop: space.lg, gap: space.md }}>
        {permission?.granted ? (
          <View style={{ height: 300, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest950 }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(result) => onScanned(result.data)} />
          </View>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>Ovalball needs the camera to read the code. Nothing is recorded.</Text>
            {permission && !permission.granted && <Button label="Allow the Camera" onPress={() => void requestPermission()} />}
          </View>
        )}
        {problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>
        )}
        <Button label="Enter a Code Instead" variant="secondary" onPress={() => { holdJoinSecret({ token: null, code: null }); router.replace({ pathname: "/join", params: { mode: "code" } } as never) }} />
      </View>
    </EntranceScreen>
  )
}
