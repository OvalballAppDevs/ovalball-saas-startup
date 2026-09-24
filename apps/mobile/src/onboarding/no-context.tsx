import { Linking, Text, View } from "react-native"
import { useRouter } from "expo-router"

import { AUTH_WORDING } from "@ovalball/contracts/auth"

import { webUrl } from "../config/environment"
import { holdJoinSecret } from "./join-secret"
import { Card } from "../components/ui"
import { ExternalLink, KeyRound, LifeBuoy, Search } from "../components/icons"
import { colour, space, type } from "../design/tokens"

/**
 * SIGNED IN, HOLDING NOTHING (CA-M11). An account with no club, team, family or player relationship is
 * a real state -- a new person whose club has not yet approved them, or somebody whose last role was
 * removed. It is not an error and not a broken club screen: it says what is true and offers the only
 * real ways forward. It grants nothing and decides nothing.
 */
export function NoContextOnboarding() {
  const router = useRouter()
  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>No rugby here yet</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{AUTH_WORDING.noAccess} If you have asked to join a club, you will see it here once somebody there has approved it.</Text>
      </Card>

      <Card onPress={() => { holdJoinSecret({ token: null, code: null }); router.push("/join" as never) }} accessibilityLabel="Enter an invitation or team code">
        <Row icon={<KeyRound size={19} color={colour.forest800} />} title="Enter an invitation or team code" body="A code from your club or team, or a link you were sent." />
      </Card>

      <Card onPress={() => { if (webUrl) void Linking.openURL(`${webUrl}/signup`) }} accessibilityLabel="Find or set up your club. Opens the Ovalball website">
        <Row icon={<Search size={19} color={colour.forest800} />} title="Find or set up your club" body="Ask to join a club that is on Ovalball, or bring yours in." external />
      </Card>

      <Card onPress={() => router.push("/support" as never)} accessibilityLabel="Get help from Ovalball">
        <Row icon={<LifeBuoy size={19} color={colour.forest800} />} title="Get help" body="Not sure where you should be? Ask Ovalball support." />
      </Card>
    </View>
  )
}

function Row({ icon, title, body, external = false }: { icon: React.ReactNode; title: string; body: string; external?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{body}</Text>
      </View>
      {external && <ExternalLink size={16} color={colour.inkSubtle} />}
    </View>
  )
}


