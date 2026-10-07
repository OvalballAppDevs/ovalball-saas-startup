import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { readPeopleCapabilities, type PeopleCapabilities } from "@ovalball/contracts/club/people"

import { supabase } from "../auth/supabase"
import { libraryAsset } from "../media/stock-assets"
import { HeartHandshake, IdCard, ShieldCheck, UserPlus, Users } from "../components/icons"
import { CardSkeleton } from "../components/ui"
import { colour, space, type } from "../design/tokens"
import { ActionGroup, ActionRow, Body, FlowScreen, PhotoCard, SectionTitle } from "./ui"

const CARD = libraryAsset("rugby-team-huddle-womens-01")

/**
 * ADD TO CLUB -- "I want this person involved with my club", in one place (People & Invitations).
 *
 * Four doors, one engine. Each opens a small contextual flow -- never a second system: Add Players and
 * Share a Joining Pass issue the team's joining link (TEAM_JOIN_CODE); Add Staff Members and Add Club
 * Administrator issue the one staff invitation (CLUB_STAFF) or give an existing member a role. What each
 * door may do is the server's answer (`my_capabilities` at the club); a door the person cannot use says
 * why rather than disappearing without a word.
 *
 * Referring another club is a different thing -- it brings a CLUB to Ovalball, not a person to this one --
 * so it sits apart at the bottom, plainly labelled, and leads to the one referral screen.
 */
export function AddToClub({ clubId }: { clubId: string }) {
  const router = useRouter()
  const [caps, setCaps] = useState<PeopleCapabilities | null>(null)

  useFocusEffect(
    useCallback(() => {
      let live = true
      void readPeopleCapabilities(supabase, clubId).then((c) => live && setCaps(c))
      return () => {
        live = false
      }
    }, [clubId])
  )

  return (
    <FlowScreen title="Add to Club">
      <Body>
        <SectionTitle title="Bring Your Club Together" detail="Invite players, staff, volunteers and club administrators to join your club on Ovalball." />
        <PhotoCard image={CARD} title="People make rugby happen." body="Send a personal invitation by link or QR code. Choose their role and where they belong at your club." />
        {caps === null ? (
          <CardSkeleton lines={4} />
        ) : (
          <ActionGroup>
            <ActionRow first icon={<UserPlus size={20} color={colour.forest800} />} title="Add Players" caption={caps.joinCodes ? "Invite and register players to your teams." : "Players are invited by each team's own staff."} disabled={!caps.joinCodes} onPress={() => router.push("/admin/people/add-players" as never)} />
            <ActionRow icon={<Users size={20} color={colour.forest800} />} title="Add Staff Members" caption="Invite coaches, managers and volunteers." disabled={!caps.invite && !caps.assignTeam} onPress={() => router.push("/admin/people/add-staff" as never)} />
            <ActionRow icon={<ShieldCheck size={20} color={colour.forest800} />} title="Add Club Administrator" caption={caps.invite ? "Invite someone with club-wide access." : "Only a Club Admin can add another."} disabled={!caps.invite} onPress={() => router.push({ pathname: "/admin/people/invite", params: { preset: "admin" } } as never)} />
            <ActionRow icon={<IdCard size={20} color={colour.forest800} />} title="Share a Joining Pass" caption="A team's QR code to share in person or on WhatsApp." disabled={!caps.joinCodes} onPress={() => router.push({ pathname: "/admin/people/add-players", params: { mode: "pass" } } as never)} />
          </ActionGroup>
        )}

        {caps?.refer && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>Know another club that should be on Ovalball?</Text>
            <ActionGroup>
              <ActionRow first icon={<HeartHandshake size={20} color={colour.forest800} />} title="Refer Clubs" caption="Recommend Ovalball to another club." onPress={() => router.push("/clubhouse/refer" as never)} />
            </ActionGroup>
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
