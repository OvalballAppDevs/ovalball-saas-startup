import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"
import { SUBSCRIPTION_STATE_LABEL, formatMinor, loadTeamSubscriptions, type SubscriptionState, type TeamSubscriptionSummary } from "@ovalball/contracts/team/subscriptions"

import { supabase } from "../../src/auth/supabase"
import { useAppContexts } from "../../src/context/contexts"
import { useTeamAuthority } from "../../src/team/authority"
import { NotForYou, TeamScreen } from "../../src/team/screen"
import { DestinationFoundation } from "../../src/components/destination"
import { FamilySubscriptions } from "../../src/family/subscriptions"
import { isFamilyFacingContext } from "@ovalball/contracts"
import { AppHeader } from "../../src/components/app-header"
import { ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { PersonAvatar } from "../../src/components/identity"
import { Receipt } from "../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../src/components/ui"
import { colour, radius, space, type } from "../../src/design/tokens"

/**
 * SUBSCRIPTIONS -- whether each player in the squad is set up to pay (CA-M7).
 *
 * IN A TEAM CONTEXT, for somebody the server says holds `finance.subscription.view` at the team (or
 * the club), this is the squad's operational subscription state from `team_subscription_status`: who
 * is paid, due, failed, not set up, or owes nothing this month. Nothing about HOW they pay -- no bank,
 * no mandate, no payment identifier, no payer identity -- because the operation cannot return one.
 * Payments themselves stay with the club, and a family's own subscription stays in the family product.
 *
 * Everywhere else the route keeps its foundation card, honest about what it will hold and where the
 * job lives today. The route exists either way: hiding a row removes a shortcut, never an authority.
 */
const TONE: Record<SubscriptionState, "positive" | "caution" | "neutral"> = { PAID: "positive", DUE: "neutral", FAILED: "caution", NOT_SET_UP: "caution", NOT_EXPECTED: "neutral" }

export default function Subscriptions() {
  const { active } = useAppContexts()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [summary, setSummary] = useState<TeamSubscriptionSummary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const teamContext = active?.kind === "team"

  const load = useCallback(async () => {
    if (!teamId || !authority.subscriptionView) return
    setProblem(null)
    try {
      setSummary(await loadTeamSubscriptions(supabase, teamId))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string; message?: string }
      if (e.code === "42501") {
        setRefused(true)
        return
      }
      setProblem("Couldn't load the squad's subscription state. Try again.")
    }
  }, [teamId, authority.subscriptionView])

  useEffect(() => {
    setSummary(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  // A FAMILY'S MEMBERSHIPS (CA-M9): what applies, whom it covers, what it costs and what to do next.
  if (active && isFamilyFacingContext(active.kind)) {
    return <FamilySubscriptionsScreen />
  }

  if (!teamContext) {
    return (
      <DestinationFoundation
        icon={<Receipt size={30} color={colour.forest800} strokeWidth={1.9} />}
        title="Subscriptions"
        intro="Whether each player in your squad is set up to pay. Payments themselves are handled by the club."
        willHold={["Who is paid, due, failed or not set up yet", "Chasing the ones that need chasing, without leaving the app", "For a parent: what you owe and when it goes out"]}
        webPath="/dashboard"
        webLabel="Open Subscriptions on the Web"
      />
    )
  }

  return (
    <TeamScreen section="Subscriptions" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && (!authority.subscriptionView || refused) && (
        <NotForYou title="Subscription state is not part of your view" body="Whether the squad is set up to pay is shown to the people the club has given that job to. Payments themselves are handled by the club." />
      )}
      {authority.subscriptionView && !refused && (
        <>
          {problem && !summary && <ErrorState message={problem} onRetry={load} />}
          {!problem && summary === null && <CardSkeleton lines={4} />}
          {summary && !summary.programmeExists && (
            <EmptyState title="The club does not collect through Ovalball" body="Subscription state appears here once the club sets up a programme." icon={<Receipt size={22} color={colour.inkSubtle} />} />
          )}
          {summary && summary.programmeExists && summary.rows.length === 0 && <EmptyState title="No players in this team yet" body="Subscription state appears here once players have joined the squad." />}
          {summary && summary.programmeExists && summary.rows.length > 0 && (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>This month</Text>
                <Text style={[type.small, { color: summary.attentionCount > 0 ? colour.warning : colour.forest800, fontFamily: "Inter_600SemiBold" }]}>
                  {summary.attentionCount === 0 ? "No subscription issues" : summary.attentionCount === 1 ? "1 needs following up" : `${summary.attentionCount} need following up`}
                </Text>
              </View>
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {summary.rows.map((row, index) => (
                  <View key={row.playerId} accessible accessibilityLabel={`${row.playerName}, ${SUBSCRIPTION_STATE_LABEL[row.state]}${row.amountDueMinor !== null ? `, ${formatMinor(row.amountDueMinor, row.currency)}` : ""}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <PersonAvatar name={row.playerName} url={null} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                        {row.playerName}
                      </Text>
                      {row.amountDueMinor !== null && <Text style={[type.caption, { color: colour.inkMuted }]}>{formatMinor(row.amountDueMinor, row.currency)} this month</Text>}
                    </View>
                    <StatusPill label={SUBSCRIPTION_STATE_LABEL[row.state]} tone={TONE[row.state]} />
                  </View>
                ))}
              </View>
            </>
          )}
          <Text style={[type.caption, { color: colour.inkSubtle }]}>Whether somebody is set up, not how they pay. Bank and payment details never appear here.</Text>
        </>
      )}
    </TeamScreen>
  )
}

function FamilySubscriptionsScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => undefined} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>Subscriptions & Payments</Text>
        <FamilySubscriptions />
      </ScrollView>
    </View>
  )
}
