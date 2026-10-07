import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect } from "expo-router"

import { readDispensationRegister, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

import { AdminScreen } from "../../../../src/admin/screen"
import { supabase } from "../../../../src/auth/supabase"
import { CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { DispensationRows } from "../../../../src/dispensation/register"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { useSafeguardingOfficerAccess } from "../../../../src/safeguarding/access"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * THE CLUB'S DISPENSATIONS, FOR THE OFFICER (CA-M11.1; the one dispensation workflow, 20270742000000). The
 * club's register from `dispensation_register`, which the server gives the officer, the Club Admins and the
 * Fixtures Secretary. Since 742 the confirmed officer DECIDES dispensations beside the Club Admin: each row
 * opens the record, where the decision is made -- and where the server refuses anybody else.
 */
export default function SafeguardingDispensationsScreen() {
  const { clubId } = useSafeguardingOfficerAccess()
  const [rows, setRows] = useState<DispensationRecord[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setError(null)
    try {
      setRows(await readDispensationRegister(supabase, clubId))
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

  const waiting = (rows ?? []).filter((r) => r.status === "requested" && r.viewer.decidesAs).length

  return (
    <AdminScreen section="Dispensations" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Dispensations
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>
          {waiting > 0
            ? `${waiting === 1 ? "One request is" : `${waiting} requests are`} waiting for your decision. The first decision made is final.`
            : "Every age-grade exception at the club, and who decided it."}
        </Text>
      </View>

      {rows === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {rows && !error && (
        <DispensationRows records={rows} emptyTitle="No dispensations yet" emptyBody="A request appears here the moment somebody asks for one." />
      )}
    </AdminScreen>
  )
}
