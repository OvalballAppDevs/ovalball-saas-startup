import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { readClubMessageReports, type ReportedMessage } from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../src/admin/screen"
import { supabase } from "../../../../src/auth/supabase"
import { MessageCircleWarning } from "../../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { useSafeguardingOfficerAccess } from "../../../../src/safeguarding/access"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * REPORTED MESSAGES (CA-M11.1): the club's message-report queue, through `club_message_reports`, which
 * refuses anybody without the officer's review key. Read-only on purpose -- marking a report reviewed
 * or resolved is Ovalball's own act (`site.messages.moderate`), and there is no club-level decision
 * on the server, so the screen offers none.
 */
export default function SafeguardingReportsScreen() {
  const { clubId } = useSafeguardingOfficerAccess()
  const [rows, setRows] = useState<ReportedMessage[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setError(null)
    try {
      setRows(await readClubMessageReports(supabase, clubId))
    } catch (cause) {
      const translated = friendly(cause, "reported messages")
      logDetail("admin:safeguarding:reports", translated)
      setError(translated)
      setRows([])
    }
  }, [clubId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const label = (status: string) => (status === "open" ? "Open" : status === "reviewed" ? "Reviewed" : status === "resolved" ? "Resolved" : status)

  return (
    <AdminScreen section="Reported Messages" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Reported Messages
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Messages that members have reported at this club. Ovalball reviews and resolves each report; this is the officer's view of them.</Text>
      </View>

      {rows === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {rows && rows.length === 0 && !error && <EmptyState title="No reported messages" body="A report appears here when a member reports a message at this club." icon={<MessageCircleWarning size={22} color={colour.inkSubtle} />} />}

      {rows && rows.length > 0 && (
        <View style={{ gap: space.md }}>
          {rows.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>Reported by {r.reporterName ?? "a member"}</Text>
                <StatusPill label={label(r.status)} tone={r.status === "resolved" ? "positive" : r.status === "open" ? "caution" : "neutral"} />
              </View>
              <Text style={[type.caption, { color: colour.inkSubtle, marginTop: 2 }]}>{new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
              <Text style={[type.small, { color: colour.ink, marginTop: space.sm }]}>{r.reason}</Text>
              <View style={{ marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Reported message{r.messageDeletedAt ? " (since deleted)" : ""}</Text>
                <Text style={[type.small, { color: r.messageDeletedAt ? colour.inkSubtle : colour.ink, marginTop: 2 }]}>{r.messageBody}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </AdminScreen>
  )
}
