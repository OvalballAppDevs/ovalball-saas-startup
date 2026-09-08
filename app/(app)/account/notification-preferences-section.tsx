"use client"

import { useState } from "react"

import { setNotificationPreference } from "./actions"

export interface NotificationTopicRow {
  key: string
  label: string
  description: string
  mandatory: boolean
  emailReady: boolean
  pushReady: boolean
  inAppEnabled: boolean
}

/**
 * The label and explanation, shared by the always-on row and the switch row so
 * the two read identically.
 */
function TopicText({ topic }: { topic: NotificationTopicRow }) {
  return (
    <span className="min-w-0">
      <span id={`${topic.key}-label`} className="block text-sm font-medium text-ink">
        {topic.label}
      </span>
      <span id={`${topic.key}-description`} className="mt-0.5 block text-xs text-ink-muted">
        {topic.description}
      </span>
      {!topic.mandatory && (
        <span className="mt-1 block text-[11px] text-ink-muted">
          Email {topic.emailReady ? "available" : "coming soon"} · Push {topic.pushReady ? "available" : "coming soon"}
        </span>
      )}
    </span>
  )
}

/**
 * Personal Notification Settings (Overnight Master Pass Phase B) -- one
 * topic per row, in-app is the only live channel today (Section 42:
 * expose only actually-supported delivery channels), email/push shown as
 * "Coming soon" rather than hidden so the eventual channel launch needs
 * no new UI. The mandatory "Account and security" topic has no toggle at
 * all -- Section 43 -- optional preferences never suppress it.
 */
export function NotificationPreferencesSection({ topics }: { topics: NotificationTopicRow[] }) {
  const [state, setState] = useState(new Map(topics.map((t) => [t.key, t.inAppEnabled])))
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(topic: NotificationTopicRow) {
    const next = !(state.get(topic.key) ?? true)
    setState((prev) => new Map(prev).set(topic.key, next))
    setSaving(topic.key)
    setError(null)
    const result = await setNotificationPreference(topic.key, next)
    setSaving(null)
    if (!result.ok) {
      setState((prev) => new Map(prev).set(topic.key, !next))
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Notifications</p>
      <p className="mt-2 text-sm text-ink/70">Choose what Ovalball notifies you about in-app. Email and push are coming soon.</p>
      {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {topics.map((topic) => (
          <li key={topic.key}>
            {topic.mandatory ? (
              // No control at all: an always-on topic is a statement, not a
              // choice, and a disabled switch would invite people to try.
              <div className="flex items-center justify-between gap-4 rounded-lg border border-ink/10 bg-chalk px-3.5 py-3">
                <TopicText topic={topic} />
                <span className="shrink-0 rounded-full border border-ink/15 px-2.5 py-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  Always on
                </span>
              </div>
            ) : (
              /*
                THE WHOLE ROW IS THE SWITCH.

                The visual track stays 24px, because that is the right size for
                a switch. What was wrong was that the 24px track was also the
                only thing you could hit -- on a phone that is a target you
                miss, next to five other targets you did not mean to hit.

                So the row itself IS the button: one interactive element,
                labelled by the topic and described by its explanation, with
                the track rendered inside it as presentation. No overlay, no
                pseudo-element hit area, and nothing nested inside anything
                else clickable. Tab reaches one control per preference, Space
                and Enter toggle it because it is a real button, and the focus
                ring is drawn around the row a person is actually aiming at.
              */
              <button
                type="button"
                role="switch"
                aria-checked={state.get(topic.key) ?? true}
                aria-labelledby={`${topic.key}-label`}
                aria-describedby={`${topic.key}-description`}
                disabled={saving === topic.key}
                onClick={() => handleToggle(topic)}
                className="flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border border-ink/10 bg-chalk px-3.5 py-3 text-left outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                <TopicText topic={topic} />
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    (state.get(topic.key) ?? true) ? "bg-pitch-600" : "bg-ink/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                      (state.get(topic.key) ?? true) ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
