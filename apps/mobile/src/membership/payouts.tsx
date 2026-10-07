import { useCallback, useEffect, useState } from "react"
import { AccessibilityInfo, Pressable, Text, View } from "react-native"
import { formatFinanceDate } from "@ovalball/contracts/club/finance"
import { PAYOUTS_EXPLAINED, loadClubPayouts, payoutLines, payoutStatusLabel, signedMoney, type ClubPayout } from "@ovalball/contracts/membership/payouts"

import { supabase } from "../auth/supabase"
import { ChevronDown, ChevronUp } from "../components/icons"
import { Card, CardSkeleton } from "../components/ui"
import { TOUCH_TARGET, colour, font, space, type } from "../design/tokens"
import { ToneChip } from "./setup-ui"

/**
 * WHAT REACHED THE CLUB'S BANK (20270754000000, Part 2 §29) -- each GoCardless payout, explained from GoCardless's
 * own items: what members paid through Ovalball, GoCardless's fees (VAT included), Ovalball's fee, refunds and
 * failures, the club's other GoCardless activity, and what was paid in. The same read and the same lines as the
 * website (packages/contracts/src/membership/payouts.ts); nothing here does arithmetic.
 *
 * "Collected" on the overview is money GoCardless has confirmed; a payout is when it reaches the bank, days later.
 * The section says so once, at the top, so the two are never mistaken for each other.
 */
export function PayoutsSection({ clubId, errorMessage }: { clubId: string; errorMessage: (cause: unknown) => string }) {
  const [payouts, setPayouts] = useState<ClubPayout[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPayouts(await loadClubPayouts(supabase, clubId))
      setProblem(null)
    } catch (cause) {
      setProblem(errorMessage(cause))
    }
  }, [clubId, errorMessage])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        Payouts
      </Text>
      <Text style={[type.small, { color: colour.inkMuted }]}>{PAYOUTS_EXPLAINED}</Text>
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.danger }]}>
          {problem}
        </Text>
      ) : payouts === null ? (
        <View accessible accessibilityLabel="Loading payouts">
          <CardSkeleton lines={3} />
        </View>
      ) : payouts.length === 0 ? (
        <Card>
          <Text style={[type.body, { color: colour.ink }]}>No payouts yet.</Text>
          <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>The first arrives a few working days after GoCardless collects a payment.</Text>
        </Card>
      ) : (
        payouts.map((p) => (
          <PayoutCard
            key={p.id}
            payout={p}
            open={open === p.id}
            onToggle={() => {
              const next = open === p.id ? null : p.id
              setOpen(next)
              if (next) AccessibilityInfo.announceForAccessibility(`Breakdown of the payout of ${signedMoney(p.amountMinor, p.currency)} shown`)
            }}
          />
        ))
      )}
    </View>
  )
}

function PayoutCard({ payout: p, open, onToggle }: { payout: ClubPayout; open: boolean; onToggle: () => void }) {
  const date = p.arrivalDate ? formatFinanceDate(p.arrivalDate, "long") : "Date to follow"
  const status = payoutStatusLabel(p.status)
  const tone = p.status === "paid" ? "settled" : p.status === "bounced" ? "attention" : "moving"
  const lines = payoutLines(p)
  const spoken = lines.map((l) => `${l.label} ${signedMoney(l.amountMinor, p.currency)}${l.note ? `, ${l.note}` : ""}`).join(". ")
  return (
    <Card style={{ padding: 0 }}>
      <View
        accessible
        accessibilityLabel={`Payout ${date}. ${status}. ${signedMoney(p.amountMinor, p.currency)} paid into the club's bank.${p.reference ? ` Reference ${p.reference}.` : ""}`}
        style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.xs }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
          <Text style={[type.bodyMedium, { color: colour.ink }]}>{date}</Text>
          <ToneChip label={status} tone={tone} />
        </View>
        <Text style={[type.title, { color: colour.forest800, fontVariant: ["tabular-nums"] }]}>{signedMoney(p.amountMinor, p.currency)}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{p.reference ? `Paid into the club's bank · reference ${p.reference}` : "Paid into the club's bank"}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide Breakdown" : "Show Breakdown"}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.lg, opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{open ? "Hide Breakdown" : "Show Breakdown"}</Text>
        {open ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
      </Pressable>
      {open && (
        <View accessible accessibilityLabel={spoken} style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 }}>
          {lines.map((l, i) => {
            const last = i === lines.length - 1
            return (
              <View key={l.key} style={{ paddingVertical: 4, borderTopWidth: last ? 1 : 0, borderStyle: "dashed", borderTopColor: colour.line, marginTop: last ? space.xs : 0 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md }}>
                  <Text style={[last ? type.bodyMedium : type.small, { color: colour.ink, flexShrink: 1 }]}>{l.label}</Text>
                  <Text style={[last ? type.heading : type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"], fontFamily: last ? font.bodyMedium : undefined }]}>
                    {signedMoney(l.amountMinor, p.currency)}
                  </Text>
                </View>
                {!!l.note && <Text style={[type.caption, { color: colour.inkMuted }]}>{l.note}</Text>}
              </View>
            )
          })}
          {p.items === 0 ? (
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: space.xs }]}>GoCardless's breakdown for this payout isn't available.</Text>
          ) : !p.balanced ? (
            <Text style={[type.caption, { color: colour.warning, marginTop: space.xs }]}>These lines don't add up to the payout. The amount paid in is GoCardless's own figure.</Text>
          ) : null}
        </View>
      )}
    </Card>
  )
}
