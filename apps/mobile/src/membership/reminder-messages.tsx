import { Text, View } from "react-native"
import { familiesGetThis, reminderMessages, type ReminderPreview } from "@ovalball/contracts/membership/operate"

import { Bell } from "../components/icons"
import { Card } from "../components/ui"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE MESSAGES A REMINDER WILL SEND -- the server's own words (`membership_reminder_preview`), one for each
 * situation in the audience, each with how many families get it. An audience mixes situations -- a Direct Debit
 * not started, nothing set up, a month overdue -- and each family gets the words for its own, so a single example
 * would misdescribe the rest. The club's Reminders screen and a Team Manager's confirmation both read it.
 *
 * `inSheet` draws each message as a flat white panel with a hairline instead of a lifted card: the sheet is chalk,
 * so a tint would vanish into it.
 */
export function ReminderMessages({ preview, inSheet = false }: { preview: ReminderPreview; inSheet?: boolean }) {
  const messages = reminderMessages(preview)

  if (messages.length === 0) {
    const nobody = <Text style={[type.small, { color: colour.inkMuted }]}>Nobody in this choice would be asked right now.</Text>
    return inSheet ? nobody : <Card>{nobody}</Card>
  }

  return (
    <View style={{ gap: space.md }}>
      {messages.map((m) => {
        const count = familiesGetThis(m.count)
        const message = (
          <View style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Bell size={16} color={colour.forest800} />
              <Text style={[type.smallMedium, { color: colour.ink }]}>{m.title}</Text>
            </View>
            <Text style={[type.body, { color: colour.ink }]}>{m.body}</Text>
          </View>
        )
        return (
          <View key={m.variant} accessible accessibilityLabel={`${count} ${m.title}. ${m.body}`} style={{ gap: space.xs }}>
            <Text style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{count}</Text>
            {inSheet ? <View style={{ backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, borderRadius: radius.md, padding: space.md }}>{message}</View> : <Card>{message}</Card>}
          </View>
        )
      })}
    </View>
  )
}
