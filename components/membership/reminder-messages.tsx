import { familiesGetThis, reminderMessages, type ReminderPreview } from "@ovalball/contracts/membership/operate"

/**
 * THE MESSAGES A REMINDER WILL SEND -- the server's own words (`membership_reminder_preview`), one for each situation
 * in the audience, each with how many families get it: an audience mixes situations, and each family gets the words
 * for its own. The club's Reminders page and a team's confirmation both show it, as the app does.
 */
export function ReminderMessageList({ preview }: { preview: ReminderPreview }) {
  const messages = reminderMessages(preview)
  if (messages.length === 0) return <p className="text-sm text-ink-muted">Nobody in this choice can be reminded now, so there is nothing to send.</p>
  return (
    <ul className="space-y-4">
      {messages.map((m) => (
        <li key={m.variant}>
          <p className="text-xs font-medium text-ink-muted tabular-nums">{familiesGetThis(m.count)}</p>
          <figure className="mt-1.5 rounded-xl border border-ink/10 bg-chalk p-4">
            <figcaption className="sr-only">{`The message ${m.firstName}'s family would get`}</figcaption>
            <p className="text-sm font-semibold text-ink">{m.title}</p>
            <p className="mt-1 text-sm text-ink">{m.body}</p>
          </figure>
        </li>
      ))}
    </ul>
  )
}
