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
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Notifications</p>
      <p className="mt-2 text-sm text-ink/70">Choose what Ovalball notifies you about in-app. Email and push are coming soon.</p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {topics.map((topic) => (
          <li key={topic.key} className="flex items-center justify-between gap-4 rounded-lg border border-ink/10 bg-chalk px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{topic.label}</p>
              <p className="mt-0.5 text-xs text-ink/50">{topic.description}</p>
              {!topic.mandatory && (
                <p className="mt-1 text-[11px] text-ink/35">
                  Email {topic.emailReady ? "available" : "coming soon"} · Push {topic.pushReady ? "available" : "coming soon"}
                </p>
              )}
            </div>
            {topic.mandatory ? (
              <span className="shrink-0 rounded-full border border-ink/15 px-2.5 py-1 text-[11px] font-medium tracking-wide text-ink/45 uppercase">Always on</span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={state.get(topic.key) ?? true}
                aria-label={topic.label}
                disabled={saving === topic.key}
                onClick={() => handleToggle(topic)}
                className={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                  (state.get(topic.key) ?? true) ? "bg-pitch-600" : "bg-ink/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    (state.get(topic.key) ?? true) ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
