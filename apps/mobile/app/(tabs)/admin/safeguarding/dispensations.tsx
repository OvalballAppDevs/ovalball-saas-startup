import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { DISPENSATION_STATUS_LABEL, readOfficerDispensations, type OfficerDispensation } from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../src/admin/screen"
import { supabase } from "../../../../src/auth/supabase"
import { ArrowRightLeft } from "../../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { useSafeguardingOfficerAccess } from "../../../../src/safeguarding/access"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * THE CLUB'S DISPENSATIONS, FOR THE OFFICER (CA-M11.1). The officer's grant is one branch of the
 * dispensation table's own policy, and the rows are whatever that policy allows this person. Read-only
 * by construction: the officer's key carries no decision, and the screen offers none.
 */
export default function SafeguardingDispensationsScreen() {
  const { clubId } = useSafeguardingOfficerAccess()
  const [rows, setRows] = useState<OfficerDispensation[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setError(null)
    try {
      setRows(await readOfficerDispensations(supabase, clubId))
    } catch (cause) {
      const translated = friendly(cause, "the club's dispensations")
      logDetail("admin:safeguarding:dispensations", translated)
      setError(translated)
      setRows([])
    }
  }, [clubId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const tone = (status: string): "positive" | "caution" | "neutral" => (status === "approved" ? "positive" : status === "rejected" || status === "revoked" || status === "expired" ? "neutral" : "caution")

  return (
    <AdminScreen section="Dispensations" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Dispensations
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Age-grade dispensations across the club's sides, as they stand. They are decided by the people authorised to decide them; this is the officer's view of the record.</Text>
      </View>

      {rows === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {rows && rows.length === 0 && !error && <EmptyState title="No dispensations" body="A dispensation appears here when one is requested for a player at this club." icon={<ArrowRightLeft size={22} color={colour.inkSubtle} />} />}

      {rows && rows.length > 0 && (
        <View style={{ gap: space.md }}>
          {rows.map((d) => (
            <Card key={d.id}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{d.playerName}</Text>
                <StatusPill label={DISPENSATION_STATUS_LABEL[d.status] ?? d.status} tone={tone(d.status)} />
              </View>
              <Text style={[type.small, { color: colour.inkMuted, marginTop: space.xs }]}>
                {d.sourceTeamName} → {d.targetTeamName} · {d.seasonName}
              </Text>
              <Text style={[type.caption, { color: colour.inkSubtle, marginTop: space.xs }]}>Rule: {d.eligibilityRuleReference}</Text>
              {d.governingBodyReference && <Text style={[type.caption, { color: colour.inkSubtle, marginTop: 1 }]}>Governing body reference: {d.governingBodyReference}</Text>}
              <Text style={[type.caption, { color: colour.inkSubtle, marginTop: 1 }]}>Requested {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
            </Card>
          ))}
        </View>
      )}
    </AdminScreen>
  )
}
