import { useEffect, useState } from "react"
import { Linking, Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { webUrl } from "../../../src/config/environment"
import { readClubCreditBalancePence, readClubReferrals, poundsLabel, type ClubReferral } from "../../../src/clubhouse/referrals"
import { CardSkeleton, EmptyState } from "../../../src/components/ui"
import { SubmitButton } from "../../../src/components/form"
import { CalendarDays, Check, ChevronRight, UserPlus } from "../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"

/**
 * REFER A CLUB — a genuinely wired, deliberately minimal screen (Clubhouse Home's own directive: "a
 * truthful shell... for now" is acceptable here, and this is more than a shell -- it reads the real
 * platform referral domain, `club_referral_summary`/`club_credit_balance_pence`, the same RPCs the web
 * club-billing surface already uses). It does NOT invent a generic shareable invite link: Ovalball's
 * real invitation mechanism (`create_partner_invitation`) is per-directory-club, reached from a club's
 * own card on the map -- so the one CTA here is "Find a Club to Invite," which opens exactly that real
 * flow, rather than fabricating a universal referral code this product does not have.
 *
 * Gated on `club.referrals.view` -- a club-scope capability. A team-context viewer, or a club-context
 * viewer who does not hold it, sees the real reward explanation but not the club's own figures, and is
 * told plainly why (never a silent empty state pretending there is nothing to see).
 */
export default function ReferAClub() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)

  const [canView, setCanView] = useState<boolean | null>(null)
  const [referrals, setReferrals] = useState<ClubReferral[] | null>(null)
  const [creditPence, setCreditPence] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      if (!clubId) {
        if (live) setCanView(false)
        return
      }
      const { data, error } = await supabase.rpc("my_capabilities", {
        p_scope_type: "club",
        p_club_id: clubId,
      })
      if (!live) return
      const allowed = !error && (data ?? []).some((row) => row.capability_key === "club.referrals.view" && row.allowed === true)
      setCanView(allowed)
      if (!allowed) return
      const [refs, credit] = await Promise.all([readClubReferrals(supabase, clubId), readClubCreditBalancePence(supabase, clubId)])
      if (live) {
        setReferrals(refs)
        setCreditPence(credit)
      }
    })()
    return () => {
      live = false
    }
  }, [clubId])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <ReferHeader onBack={() => router.back()} insets={insets} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        <View style={{ borderRadius: radius.lg, backgroundColor: colour.forest800, padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }}>
              <UserPlus size={20} color={colour.onForest} strokeWidth={2} />
            </View>
            <Text style={[type.title, { color: colour.onForest }]}>Get 1 month free</Text>
          </View>
          <Text style={[type.small, { color: colour.onForestMuted }]}>
            Know a rugby club that isn&apos;t on Ovalball yet? If they start a paid subscription and
            their first payment is successfully collected, your club gets one month of its current
            plan free.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <Step number={1} label="Invite a club" body="Find them in the directory and invite them to Ovalball." />
          <Step number={2} label="They join and subscribe" body="Their first payment has to be successfully collected -- not just a signup." />
          <Step number={3} label="Your club is credited" body="One month free is applied automatically once it qualifies." />
        </View>

        {canView === null && <CardSkeleton lines={2} />}

        {canView === false && (
          <EmptyState
            title="Referral figures aren't shown here"
            body="Viewing your club's referral activity needs club-level access. Ask your Club Admin, or check Ovalball Billing on the web."
            icon={<CalendarDays size={22} color={colour.inkSubtle} />}
          />
        )}

        {canView === true && (
          <View style={{ gap: space.sm }}>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Credit earned so far</Text>
              <Text style={[type.title, { color: colour.ink, marginTop: 2 }]}>{creditPence === null ? "—" : poundsLabel(creditPence)}</Text>
            </View>
            {referrals !== null && referrals.length === 0 && (
              <Text style={[type.small, { color: colour.inkMuted }]}>No referrals yet -- invite a club to get started.</Text>
            )}
            {referrals !== null &&
              referrals.map((r) => (
                <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, paddingVertical: space.md, paddingHorizontal: space.lg }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
                      {r.referredClubName}
                    </Text>
                    <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{referralStatusLabel(r.status)}</Text>
                  </View>
                  {r.status === "qualified" && r.rewardAmountPence !== null ? (
                    <Text style={[type.smallMedium, { color: colour.pitch600 }]}>+{poundsLabel(r.rewardAmountPence)}</Text>
                  ) : r.status === "qualified" ? (
                    <Check size={18} color={colour.pitch600} strokeWidth={2.4} />
                  ) : null}
                </View>
              ))}
          </View>
        )}

        <SubmitButton label="Find a Club to Invite" onPress={() => router.push("/clubhouse/map" as never)} />

        <Pressable accessibilityRole="link" accessibilityLabel="Referral terms" onPress={() => void Linking.openURL(`${webUrl}/legal/referral-terms`)} style={{ alignItems: "center", minHeight: TOUCH_TARGET, justifyContent: "center" }}>
          <Text style={[type.small, { color: colour.forest800, textDecorationLine: "underline" }]}>Referral terms</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function referralStatusLabel(status: ClubReferral["status"]): string {
  if (status === "pending") return "Invited -- not on Ovalball yet"
  if (status === "registered") return "Joined Ovalball -- not yet subscribed"
  if (status === "qualified") return "Qualified -- reward applied"
  if (status === "reversed") return "Reward reversed"
  return "Did not qualify"
}

function Step({ number, label, body }: { number: number; label: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{body}</Text>
      </View>
    </View>
  )
}

function ReferHeader({ onBack, insets }: { onBack: () => void; insets: { top: number } }) {
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Clubhouse"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        Refer a Club
      </Text>
    </View>
  )
}
