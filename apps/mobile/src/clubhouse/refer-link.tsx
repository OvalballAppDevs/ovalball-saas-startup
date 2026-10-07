import { useCallback, useEffect, useState } from "react"
import { View } from "react-native"
import { useRouter } from "expo-router"

import { clubReferralUrl, readClubReferralSlug } from "@ovalball/contracts/clubhouse/referral-link"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { friendly, logDetail } from "../errors/translate"
import { ShareView } from "../sharing/share-view"
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { space } from "../design/tokens"
import { Body, FlowScreen, SectionTitle } from "../people/ui"

/**
 * YOUR CLUB'S REFERRAL LINK -- the one reusable link a club shares to recommend Ovalball (One Referral Link
 * per Club, the owner's decision of 2026-10-05), from Refer Clubs' "Share Your Club Link" and "Share a Poster".
 *
 * THE SAME SHARE SCREEN AS EVERY INVITATION: the link, its QR, WhatsApp first, and the club's Rise Together
 * poster. It holds no secret, so it carries no code and no "shown once" warning: it is the club's public
 * address and the same link every time. Using it records nothing until a club in the Club Directory signs up
 * through it and Ovalball approves its claim; the existing first-referrer rule then decides who is credited.
 */
export function ShareClubLink({ clubId, startOn = "link" }: { clubId: string; startOn?: "link" | "poster" }) {
  const router = useRouter()
  const { club } = useAppContexts()
  const [slug, setSlug] = useState<string | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setSlug(await readClubReferralSlug(supabase, clubId))
    } catch (cause) {
      const failure = friendly(cause, "your club's link")
      logDetail("refer-link:load", failure)
      setProblem(failure.message)
    }
  }, [clubId])
  useEffect(() => void load(), [load])

  const clubName = club.clubId === clubId && club.name ? club.name : "Your club"

  return (
    <FlowScreen title="Share Your Club's Referral">
      <Body>
        {slug === undefined && !problem && <CardSkeleton lines={4} />}
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {slug === null && <EmptyState title="No referral link yet" body="Your club needs to be active on Ovalball to share a referral link." />}
        {slug && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Your Club Referral Link" detail="Share it with other clubs to recommend Ovalball. It's the same link every time." />
            <ShareView
              share={{ url: clubReferralUrl(webUrl, slug), code: null, outcome: [], expiresLabel: null, sentTo: null }}
              subject={{ kind: "REFERRAL", clubName, referredClubName: null }}
              poster={{ identity: { clubName, crestUrl: club.clubId === clubId ? club.crestUrl : null }, subject: { variant: "REFERRAL" } }}
              initialTab={startOn}
              explainer={`When a club in the Club Directory joins Ovalball through this link, the referral is connected to ${clubName} automatically. Club Admins can follow it under Your Referrals.`}
              onDone={() => (router.canGoBack() ? router.back() : router.dismissTo("/clubhouse/refer" as never))}
            />
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
