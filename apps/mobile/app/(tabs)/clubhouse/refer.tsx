import { useCallback, useState } from "react"
import { Linking, Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { REFERRAL_OFFER_SUMMARY } from "@ovalball/contracts/club/finance"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { webUrl } from "../../../src/config/environment"
import { readClubReferrals, type ClubReferral } from "../../../src/clubhouse/referrals"
import { libraryAsset } from "../../../src/media/stock-assets"
import { CardSkeleton, EmptyState } from "../../../src/components/ui"
import { ChevronDown, ChevronUp, CircleHelp, HeartHandshake, Image as ImageIcon, Share2 } from "../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"
import { ActionGroup, ActionRow, Body, FlowScreen, PhotoHero, SectionTitle } from "../../../src/people/ui"

const HERO = libraryAsset("rugby-team-community-01")

/**
 * REFER CLUBS -- "bring another club to Ovalball", the Clubhouse's one referral screen (People &
 * Invitations; the Clubhouse card, Add to Club and a club's directory page all lead here or into Refer a
 * Club, never to a second referral system).
 *
 * WHAT IS TRUE, AND NOTHING ELSE. A referral is one club recommending Ovalball to one other club
 * (`create_partner_invitation`, per directory club); it is connected when that club joins Ovalball, and
 * the reward is the existing offer, in the existing terms' own words. The counts are the club's own
 * referrals (`club_referral_summary`, Club Admins only) -- invited, joined, not joined yet -- never clicks,
 * opens, scans or shares, which nothing records.
 *
 * ONE LINK PER CLUB (the owner's decision of 2026-10-05): "Share Your Club Link" and "Share a Poster" share the
 * club's own reusable link, which becomes an ordinary referral when a club signs up through it -- the same
 * records, the same first-referrer rule, never a second system (20270740000000).
 */
export default function ReferClubs() {
  const router = useRouter()
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const [canRefer, setCanRefer] = useState<boolean | null>(null)
  const [canView, setCanView] = useState(false)
  const [referrals, setReferrals] = useState<ClubReferral[] | null>(null)
  const [howOpen, setHowOpen] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let live = true
      void (async () => {
        if (!clubId) {
          if (live) setCanRefer(false)
          return
        }
        const { data } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
        const keys = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
        if (!live) return
        setCanRefer(keys.has("club.partners.manage"))
        const view = keys.has("club.referrals.view")
        setCanView(view)
        if (view) {
          const rows = await readClubReferrals(supabase, clubId)
          if (live) setReferrals(rows)
        }
      })()
      return () => {
        live = false
      }
    }, [clubId])
  )

  // THE THREE NUMBERS ADD UP. Every referral that is no longer pending is a club that reached Ovalball --
  // including one whose offer was later reversed, or that did not qualify (the referred club was already a
  // subscriber, say) -- so Invited is always Joined plus Not Joined Yet.
  const invited = referrals?.length ?? 0
  const notYet = (referrals ?? []).filter((r) => r.status === "pending").length
  const joined = invited - notYet

  return (
    <FlowScreen title="Refer Clubs">
      <PhotoHero image={HERO} title="Grow Rugby Together" body="Recommend Ovalball to other clubs and help more teams, players and volunteers get connected." />
      <Body>
        {canRefer === null && <CardSkeleton lines={2} />}
        {canRefer !== null && (
          <ActionGroup>
            <ActionRow
              first
              icon={<Share2 size={20} color={colour.forest800} />}
              title="Share Your Club Link"
              caption={canRefer ? "Send your club's referral link or QR code. It's the same one every time." : "Sharing your club's link needs your club's partnership permission."}
              disabled={!canRefer}
              onPress={() => router.push("/clubhouse/refer-link" as never)}
            />
            <ActionRow
              icon={<ImageIcon size={20} color={colour.forest800} />}
              title="Share a Poster"
              caption={canRefer ? "A poster with your club's crest and its referral QR code." : "Sharing a poster needs your club's partnership permission."}
              disabled={!canRefer}
              onPress={() => router.push("/clubhouse/refer-link?view=poster" as never)}
            />
            <ActionRow
              icon={<HeartHandshake size={20} color={colour.forest800} />}
              title="Refer a Club"
              caption={canRefer ? "Choose the club, then share a link, QR code or poster with them." : "Referring a club needs your club's partnership permission."}
              disabled={!canRefer}
              onPress={() => router.push("/clubhouse/refer-club" as never)}
            />
            <ActionRow
              icon={<CircleHelp size={20} color={colour.forest800} />}
              title="How It Works"
              caption="What the other club gets, and how it helps."
              trailing={howOpen ? <ChevronUp size={18} color={colour.inkSubtle} /> : <ChevronDown size={18} color={colour.inkSubtle} />}
              onPress={() => setHowOpen((v) => !v)}
            />
          </ActionGroup>
        )}

        {howOpen && (
          <View style={{ gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
            <How n={1} title="Refer a club" body="Choose a club from the Club Directory that isn't on Ovalball yet, and tell somebody there about it." />
            <How n={2} title="What they get" body="Ovalball for their club: teams, fixtures, training and people in one place, as your club has it." />
            <How n={3} title="They join Ovalball" body="When that club joins, the referral is connected to your club, whichever link they used." />
            <How n={4} title="The offer" body={REFERRAL_OFFER_SUMMARY} />
            <Pressable accessibilityRole="link" accessibilityLabel="Read the referral terms" onPress={() => void Linking.openURL(`${webUrl}/legal/referral-terms`)} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
              <Text style={[type.smallMedium, { color: colour.forest800, textDecorationLine: "underline" }]}>Read the Referral Terms</Text>
            </Pressable>
          </View>
        )}

        <View style={{ gap: space.md }}>
          <SectionTitle title="Your Referrals" />
          {!canView && canRefer !== null && <Text style={[type.small, { color: colour.inkMuted }]}>Your club&apos;s referrals are shown to its Club Admins.</Text>}
          {canView && referrals === null && <CardSkeleton lines={2} />}
          {canView && referrals !== null && (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Stat label="Invited" value={invited} />
              <Stat label="Joined" value={joined} />
              <Stat label="Not Joined Yet" value={notYet} />
            </View>
          )}
          {canView && referrals !== null && referrals.length === 0 && <EmptyState title="No referrals yet" body="Refer a club and it appears here." />}
          {canView &&
            (referrals ?? []).map((r) => (
              <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{r.referredClubName}</Text>
                  <Text style={[type.small, { color: colour.inkMuted }]}>{referralStatusLabel(r.status)}</Text>
                </View>
              </View>
            ))}
        </View>
      </Body>
    </FlowScreen>
  )
}

/** One status vocabulary, in a club's words, for what the existing referral records actually say. */
function referralStatusLabel(status: ClubReferral["status"]): string {
  if (status === "pending") return "Not on Ovalball yet"
  if (status === "registered") return "Joined Ovalball"
  if (status === "qualified") return "Joined and qualified for the offer"
  if (status === "reversed") return "Offer reversed"
  return "Did not qualify"
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
      <Text style={[type.title, { color: colour.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>{label}</Text>
    </View>
  )
}

function How({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{body}</Text>
      </View>
    </View>
  )
}
