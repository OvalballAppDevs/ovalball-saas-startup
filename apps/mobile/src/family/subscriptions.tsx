import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"

import { resolveFamilyScope } from "@ovalball/contracts"
import { formatMinor, loadFamilySubscriptionDetail, type FamilySubscriptionDetail } from "@ovalball/contracts/subscriptions/family-detail"

import { supabase } from "../auth/supabase"
import { useSession } from "../auth/session"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { useFamily } from "./family"
import { invalidateAttention } from "../attention/cache"
import { PersonAvatar } from "../components/identity"
import { CircleAlert, ExternalLink, Receipt } from "../components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { colour, space, type } from "../design/tokens"

/**
 * A FAMILY'S MEMBERSHIPS (CA-M9): what applies, whom it covers, what it costs, where it stands, and
 * the one next step. One card per child with a programme, read through the shared contract from the
 * same rows the website reads.
 *
 * THE DIRECT DEBIT IS SET UP ON THE WEBSITE, DELIBERATELY. The provider's authorisation page is reached
 * through a single-use, payer-bound URL the website's server creates; the app explains the task and
 * hands off to that page, and reads the canonical state again when it comes back. No bank details are
 * ever typed into Ovalball, on any client.
 */
export function FamilySubscriptions() {
  const { sessionContext, active } = useAppContexts()
  const { session } = useSession()
  const { selectedPlayerId, projection } = useFamily()
  const [rows, setRows] = useState<FamilySubscriptionDetail[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sessionContext || !active || !session?.user) return
    setProblem(null)
    try {
      const children = resolveFamilyScope(sessionContext, active).filter((c) => !selectedPlayerId || c.playerId === selectedPlayerId)
      const seen = new Set<string>()
      const details = await Promise.all(
        children
          .filter((c) => (seen.has(c.playerId) ? false : (seen.add(c.playerId), true)))
          .map((c) => loadFamilySubscriptionDetail(supabase, { playerId: c.playerId, playerName: c.firstName, clubId: c.clubId, userId: session.user.id }).catch(() => null))
      )
      setRows(details.filter((d): d is FamilySubscriptionDetail => d !== null))
    } catch (caught) {
      const failure = friendly(caught, "your memberships")
      logDetail("family subscriptions", failure)
      setProblem(failure.message)
    }
  }, [sessionContext, active, session?.user, selectedPlayerId])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      // Coming back from the website's provider hand-off re-reads the canonical state.
      invalidateAttention()
      void load()
    }, [load])
  )

  if (problem) return <ErrorState message={problem} onRetry={() => void load()} />
  if (rows === null) return <CardSkeleton lines={4} />
  if (rows.length === 0) {
    return <EmptyState title="No subscription action" body="Nothing needs your attention right now. A club that collects membership through Ovalball appears here once it sets up a programme." icon={<Receipt size={22} color={colour.inkSubtle} />} />
  }

  return (
    <View style={{ gap: space.md }}>
      {rows.map((row) => {
        const member = projection.members.find((m) => m.playerId === row.summary.playerId) ?? null
        const tone = row.summary.attention === "failed" ? "caution" : row.summary.attention === "setup_required" ? "caution" : "positive"
        const label = row.summary.attention === "failed" ? "Action required" : row.summary.attention === "setup_required" ? "Setup required" : (row.summary.statusLabel ?? "Set up")
        return (
          <Card key={row.summary.playerId} style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <PersonAvatar name={row.summary.playerName} url={member?.avatarUrl ?? null} initials={member?.initials} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{`${row.summary.programmeName} · ${row.summary.playerName}`}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{member?.clubName ?? "Club membership"}</Text>
              </View>
              <StatusPill label={label} tone={tone} />
            </View>

            <View style={{ gap: 6 }}>
              {row.monthlyAmountMinor !== null && <Line label="Amount" value={`${formatMinor(row.monthlyAmountMinor, row.currency)} a month`} />}
              <Line label="Collected" value={row.frequencyLabel} />
              {!!row.siblingDiscount && <Line label="Discount" value={row.siblingDiscount.description} />}
              {!!row.directDebit && <Line label="Direct Debit" value={row.directDebit.statusLabel} />}
              {!!row.ongoing && <Line label="Membership" value={row.ongoing.statusLabel} />}
              {!!row.thisMonth && <Line label="This month" value={`${formatMinor(row.thisMonth.amountDueMinor, row.currency)} · ${row.thisMonth.statusLabel}${row.thisMonth.prorated ? " (part month)" : ""}`} />}
              {row.youAreThePayer && <Line label="Payer" value="You" />}
            </View>

            {!!row.nextStep && (
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: 12, backgroundColor: colour.warningSurface }}>
                <CircleAlert size={16} color={colour.warning} strokeWidth={2.2} />
                <Text style={[type.small, { color: colour.warning, flex: 1 }]}>{row.nextStep}</Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${row.nextStep ? "Set up on the Ovalball website" : "Manage on the Ovalball website"}. Opens the website`}
              onPress={() => void Linking.openURL(`${webUrl}${row.webPath}`)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{row.nextStep ? "Set up on the website" : "Manage on the website"}</Text>
              <ExternalLink size={14} color={colour.forest800} />
            </Pressable>
          </Card>
        )
      })}
      <Text style={[type.caption, { color: colour.inkSubtle }]}>Bank details are only ever entered on the payment provider's own secure page, never in Ovalball.</Text>
    </View>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
