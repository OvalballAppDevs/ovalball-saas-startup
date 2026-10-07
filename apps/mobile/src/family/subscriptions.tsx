import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"

import { resolveFamilyScope } from "@ovalball/contracts"
import { familyFeeSentence } from "@ovalball/contracts/membership/family-charge"
import { feePercent } from "@ovalball/contracts/membership/setup"
import { formatMinor, loadFamilySubscriptionDetail, type FamilySubscriptionDetail } from "@ovalball/contracts/subscriptions/family-detail"
import { FAMILY_START_SENTENCE } from "@ovalball/contracts/subscriptions/family"

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
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

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
        // SOMEBODY ELSE PAYS (20270753000000): the reader is told it is in hand and nothing of the payer's -- no amount,
        // no Direct Debit, no task. The server answers `youPay: false` for exactly this reader.
        const someoneElsePays = row.charge?.youPay === false || (!row.youAreThePayer && row.summary.statusLabel === "Set up by someone else")
        const startRequired = !someoneElsePays && row.summary.attention === "start_required"
        const tone = someoneElsePays || row.summary.attention === "none" ? "positive" : "caution"
        const label = someoneElsePays
          ? "Set up by someone else"
          : row.summary.attention === "failed"
            ? "Action required"
            : row.summary.attention === "setup_required"
              ? "Setup required"
              : startRequired
                ? "Start required"
                : (row.summary.statusLabel ?? "Set up")
        // Who pays Ovalball's fee and what the Direct Debit collects (owner-locked: the parent is told which).
        const charge = !someoneElsePays && row.charge?.youPay && row.charge.monthlyAmountMinor !== null ? row.charge : null
        const feeSentence = charge ? familyFeeSentence(charge, member?.clubName ?? "The club") : null
        // The one task, in the family's words: starting a membership whose Direct Debit is already in place says so.
        const task = someoneElsePays ? null : startRequired ? FAMILY_START_SENTENCE : row.nextStep
        const handOff = someoneElsePays ? null : startRequired ? "Start on the Website" : row.nextStep ? "Set Up on the Website" : "Manage on the Website"
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

            {someoneElsePays ? (
              <Text style={[type.small, { color: colour.inkMuted }]}>{row.summary.detail ?? "Someone else looks after the payments for this membership."}</Text>
            ) : (
              <>
                <View style={{ gap: 6 }}>
                  {row.monthlyAmountMinor !== null && <Line label="Amount" value={`${formatMinor(row.monthlyAmountMinor, row.currency)} a month`} />}
                  {charge?.feeBearer === "PAYER" && (charge.monthlyFeeMinor ?? 0) > 0 && (
                    <Line label={`Ovalball's Fee (${feePercent(charge.feeBps)})`} value={`${formatMinor(charge.monthlyFeeMinor ?? 0, row.currency)} a month`} />
                  )}
                  {charge && charge.monthlyCollectMinor !== null && <Line label="Monthly Direct Debit" value={`${formatMinor(charge.monthlyCollectMinor, row.currency)} a month`} />}
                  <Line label="Collected" value={row.frequencyLabel} />
                  {!!row.siblingDiscount && <Line label="Discount" value={row.siblingDiscount.description} />}
                  {!!row.directDebit && <Line label="Direct Debit" value={row.directDebit.statusLabel} />}
                  {!!row.ongoing && <Line label="Membership" value={row.ongoing.statusLabel} />}
                  {!!row.thisMonth && <Line label="This Month" value={`${formatMinor(row.thisMonth.amountDueMinor, row.currency)} · ${row.thisMonth.statusLabel}${row.thisMonth.prorated ? " (part month)" : ""}`} />}
                  {row.youAreThePayer && <Line label="Payer" value="You" />}
                </View>
                {!!feeSentence && <Text style={[type.caption, { color: colour.inkMuted }]}>{feeSentence}</Text>}
              </>
            )}

            {!!task && (
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: 12, backgroundColor: colour.warningSurface }}>
                <CircleAlert size={16} color={colour.warning} strokeWidth={2.2} />
                <Text style={[type.small, { color: colour.warning, flex: 1 }]}>{task}</Text>
              </View>
            )}

            {handOff && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${handOff}. Opens the Ovalball website`}
                onPress={() => void Linking.openURL(`${webUrl}${row.webPath}`)}
                hitSlop={8}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>{handOff}</Text>
                <ExternalLink size={14} color={colour.forest800} />
              </Pressable>
            )}
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
