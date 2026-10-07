import { useEffect, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useRouter } from "expo-router"

import { AUTH_WORDING } from "@ovalball/contracts/auth"
import { myTeamRequestLine, readMyTeamRequests, type MyTeamRequest } from "@ovalball/contracts/team/team-code"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { holdJoinSecret } from "./join-secret"
import { Card } from "../components/ui"
import { Clock, ExternalLink, KeyRound, LifeBuoy, Search } from "../components/icons"
import { colour, space, type } from "../design/tokens"

/**
 * SIGNED IN, HOLDING NOTHING (CA-M11). An account with no club, team, family or player relationship is
 * a real state -- a new person whose club has not yet approved them, or somebody whose last role was
 * removed. It is not an error and not a broken club screen: it says what is true and offers the only
 * real ways forward. It grants nothing and decides nothing.
 */
export function NoContextOnboarding() {
  const router = useRouter()
  // A REQUEST MADE WITH A TEAM'S CODE (20270741000000) is often somebody's only link to Ovalball so far
  // -- a parent who has just added their child -- and it is the answer to "what happens now".
  const [waiting, setWaiting] = useState<MyTeamRequest[]>([])
  useEffect(() => {
    readMyTeamRequests(supabase).then(setWaiting).catch(() => setWaiting([]))
  }, [])
  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
      {waiting.length > 0 && (
        <Card style={{ gap: space.sm }}>
          {/* Not "for the team": a request waiting on a dispensation is the club's to decide first (20270742000000). */}
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Waiting for a Decision</Text>
          {waiting.map((r) => (
            <View key={r.membershipId} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ paddingTop: 2 }}>
                <Clock size={16} color={colour.inkSubtle} />
              </View>
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{myTeamRequestLine(r)}</Text>
            </View>
          ))}
          <Text style={[type.caption, { color: colour.inkMuted }]}>You&apos;ll get a notification as soon as it has been decided.</Text>
        </Card>
      )}
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>No rugby here yet</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{AUTH_WORDING.noAccess} If you have asked to join a club, you will see it here once somebody there has approved it.</Text>
      </Card>

      <Card onPress={() => { holdJoinSecret({ token: null, code: null }); router.push("/join" as never) }} accessibilityLabel="Enter or scan an invitation">
        <Row icon={<KeyRound size={19} color={colour.forest800} />} title="Enter or scan an invitation" body="A code or QR code from your club or team, or a link you were sent." />
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


