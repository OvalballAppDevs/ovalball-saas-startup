import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { usePathname, useRouter } from "expo-router"

import { useSession } from "../src/auth/session"
import { resolveIntent } from "../src/links/intents"
import { EntranceScreen } from "../src/components/entrance"
import { Button } from "../src/components/ui"
import { colour, space, type } from "../src/design/tokens"

/**
 * A LINK OVALBALL COULD NOT PLACE.
 *
 * WITHOUT THIS THE APP SHOWED "No route matched with those values" -- expo-router's own developer
 * error, complete with the raw URL, to somebody who had done nothing worse than tap a link in an
 * email. That is the messaging equivalent of showing a database error, and the product has a rule
 * about that.
 *
 * IT TRIES ONE MORE TIME BEFORE GIVING UP. A link whose ROUTE this build does not have may still be
 * one the intent resolver understands -- a shape that has changed, a path from an older email -- so
 * the current path is offered to it, and a recognised intent is followed. Only a genuinely
 * unrecognisable link reaches the message below.
 *
 * AND IT KNOWS WHERE "BACK" IS. Signed in, back is the app; signed out, back is signing in. A dead
 * end that offers a button to another dead end is not an improvement.
 */
export default function NotFound() {
  const pathname = usePathname()
  const router = useRouter()
  const { status } = useSession()
  const [recognised, setRecognised] = useState(false)

  useEffect(() => {
    if (status !== "signed-in") return
    const intent = resolveIntent(`ovalball:/${pathname}`)
    if (intent.kind === "MESSAGES") {
      setRecognised(true)
      router.replace("/messages")
    } else if (intent.kind === "MESSAGE_THREAD") {
      setRecognised(true)
      router.replace({
        pathname: "/messages/[kind]/[id]",
        params: { kind: intent.conversationKind, id: intent.conversationId },
      })
    }
  }, [pathname, status, router])

  if (recognised) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }} accessible accessibilityLabel="Opening" />
    )
  }

  return (
    <EntranceScreen
      title="We couldn't open that"
      subtitle="That link doesn't lead anywhere in the Ovalball app. It may be out of date, or it may be part of the product that is still on the website."
    >
      <View style={{ marginTop: space.xl, gap: space.md }}>
        <Button
          label={status === "signed-in" ? "Go to Home" : "Go to Sign In"}
          onPress={() => router.replace(status === "signed-in" ? "/(tabs)" : "/sign-in")}
        />
        <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center" }]}>
          If you followed a link from an email, ask for a new one — reset and invitation links are
          deliberately short-lived.
        </Text>
      </View>
    </EntranceScreen>
  )
}
