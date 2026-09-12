"use client"

import { useState } from "react"

import { setNotificationPreference } from "./actions"

export interface NotificationTopicRow {
  key: string
  label: string
  description: string
  /** The whole category is always on -- no switch at all. */
  mandatory: boolean
  /**
   * The category is optional overall, but still contains events that always
   * arrive -- a cancellation, a safeguarding outcome. Switching it off is
   * allowed and does not silence those.
   */
  hasMandatoryEvents: boolean
  /**
   * There is an OPTIONAL email event in this category, so an email switch
   * would actually control something. False where email is mandatory for the
   * category or where the category sends no email at all.
   */
  emailControllable: boolean
  pushReady: boolean
  inAppEnabled: boolean
  emailEnabled: boolean
}

type Channel = "in_app" | "email"

/**
 * PERSONAL NOTIFICATION SETTINGS.
 *
 * Three things changed here once the delivery gate started telling the truth.
 *
 * EMAIL IS REAL NOW. It used to read "Email coming soon" on every row, which
 * was accurate only because should_deliver_notification refused email
 * regardless of the stored preference. It no longer does, so a category with
 * an optional email event gets a working switch. A category whose email is
 * mandatory, or which sends no email, gets no switch — one would either lie
 * or do nothing.
 *
 * PUSH IS NOT REAL, and is no longer described as "coming soon" beside a
 * channel that is. There is no push transport at all; saying so plainly is
 * better than implying it is weeks away.
 *
 * AND A CATEGORY CAN BE OPTIONAL WHILE STILL CONTAINING EVENTS THAT ALWAYS
 * ARRIVE. That is the whole point of the per-event mandatory override: a
 * person may switch off fixture updates without switching off "the match is
 * cancelled". The switch stays enabled — disabling it would take away a
 * choice they genuinely have — and the row says what will still reach them.
 */
export function NotificationPreferencesSection({ topics }: { topics: NotificationTopicRow[] }) {
  const [state, setState] = useState(
    new Map(topics.map((t) => [t.key, { inApp: t.inAppEnabled, email: t.emailEnabled }])),
  )
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(topic: NotificationTopicRow, channel: Channel) {
    const current = state.get(topic.key) ?? { inApp: true, email: true }
    const next = channel === "in_app" ? !current.inApp : !current.email
    const optimistic = channel === "in_app" ? { ...current, inApp: next } : { ...current, email: next }

    setState((prev) => new Map(prev).set(topic.key, optimistic))
    setSaving(`${topic.key}:${channel}`)
    setError(null)

    const result = await setNotificationPreference(topic.key, channel, next)
    setSaving(null)
    if (!result.ok) {
      setState((prev) => new Map(prev).set(topic.key, current))
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Notifications</p>
      <p className="mt-2 text-sm text-ink/70">
        Choose what Ovalball tells you about, and how. Important cancellations and safety updates are always
        delivered.
      </p>
      {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {topics.map((topic) => {
          const value = state.get(topic.key) ?? { inApp: true, email: true }

          return (
            <li key={topic.key} className="rounded-lg border border-ink/10 bg-chalk px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <span className="min-w-0 flex-1 basis-48">
                  <span id={`${topic.key}-label`} className="block text-sm font-medium text-ink">
                    {topic.label}
                  </span>
                  <span id={`${topic.key}-description`} className="mt-0.5 block text-xs text-ink-muted">
                    {topic.description}
                  </span>
                </span>

                {topic.mandatory ? (
                  // A statement, not a choice. A disabled switch would invite
                  // people to try it.
                  <span className="shrink-0 rounded-full border border-ink/15 px-2.5 py-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                    Always on
                  </span>
                ) : (
                  <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <ChannelSwitch
                      label="In app"
                      checked={value.inApp}
                      busy={saving === `${topic.key}:in_app`}
                      describedBy={`${topic.key}-description`}
                      accessibleName={`${topic.label} in app`}
                      onToggle={() => toggle(topic, "in_app")}
                    />
                    {topic.emailControllable ? (
                      <ChannelSwitch
                        label="Email"
                        checked={value.email}
                        busy={saving === `${topic.key}:email`}
                        describedBy={`${topic.key}-description`}
                        accessibleName={`${topic.label} by email`}
                        onToggle={() => toggle(topic, "email")}
                      />
                    ) : (
                      <span className="text-[11px] text-ink-subtle">No email</span>
                    )}
                  </span>
                )}
              </div>

              {/* THE HONEST FOOTNOTE. Only where it is true: a category with no
                  always-on events says nothing, so the line keeps its meaning
                  where it does appear. */}
              {!topic.mandatory && topic.hasMandatoryEvents && (
                <p className="mt-2 text-[11px] text-ink-muted">
                  Routine updates can be turned off. Cancellations and safety updates are always delivered.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-[11px] text-ink-subtle">Push notifications aren&rsquo;t available on Ovalball yet.</p>
    </div>
  )
}

/**
 * One channel switch. A real button with role="switch", so Space and Enter
 * work and a screen reader hears its state; the track is presentation drawn
 * inside it rather than the thing being clicked.
 */
function ChannelSwitch({
  label,
  checked,
  busy,
  describedBy,
  accessibleName,
  onToggle,
}: {
  label: string
  checked: boolean
  busy: boolean
  describedBy: string
  accessibleName: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // Named per channel: "Fixtures and events in app" and "…by email" are
      // two different controls and must not both announce as the category.
      aria-label={accessibleName}
      aria-describedby={describedBy}
      disabled={busy}
      onClick={onToggle}
      className="flex min-h-11 items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
    >
      <span aria-hidden="true" className="text-[11px] font-medium text-ink-muted">
        {label}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-pitch-600" : "bg-ink/20"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  )
}
