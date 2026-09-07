"use client"

import { useId, useState } from "react"
import { Check, Send } from "lucide-react"

/**
 * A preview of what starting a fixture request looks like.
 *
 * Deliberately inert: the fields are read-only and "Send request" only
 * flips a local state flag. This is a public marketing page, so it must
 * never be wired to a real mutation -- there is no server action imported
 * here and no network call made, by construction rather than by
 * configuration.
 *
 * The fields are `readOnly` rather than `disabled` so the values stay
 * legible and reachable by a screen reader; the form itself has no action
 * and swallows submission.
 */
const FIELDS: { label: string; value: string }[] = [
  { label: "Your team", value: "Northbridge RFC U13" },
  { label: "Opposition", value: "Westbrook RFC U13" },
  { label: "Preferred date", value: "Saturday 26 September" },
  { label: "Preferred time", value: "11:00" },
  { label: "Venue", value: "Home — Riverside Ground" },
]

const MESSAGE = "We're looking for a friendly fixture on Saturday morning."

export function FixtureRequestDemo() {
  const [sent, setSent] = useState(false)
  const messageId = useId()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setSent(true)
      }}
      className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium tracking-[0.06em] text-white/60 uppercase">
          Request a fixture
        </h3>
        <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/60 uppercase">
          Product preview
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <ReadOnlyField key={field.label} label={field.label} value={field.value} />
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor={messageId} className="text-xs tracking-[0.04em] text-white/60 uppercase">
          Message
        </label>
        <textarea
          id={messageId}
          readOnly
          rows={2}
          value={MESSAGE}
          className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-forest-950/60 px-3.5 py-2.5 text-sm text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
      </div>

      <button
        type="submit"
        disabled={sent}
        className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-medium text-ink transition-colors hover:bg-pitch-400 disabled:cursor-default disabled:bg-pitch-600/25 disabled:text-white/70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
      >
        {sent ? (
          <>
            <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            Request sent
          </>
        ) : (
          <>
            <Send className="size-4" aria-hidden="true" />
            Send request
          </>
        )}
      </button>

      <p role="status" aria-atomic="true" className="mt-3 min-h-5 text-center text-xs text-white/60">
        {sent
          ? "In Ovalball, Westbrook RFC would now see this request against their U13 team."
          : "Nothing is sent — this is a preview of the real request form."}
      </p>
    </form>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="text-xs tracking-[0.04em] text-white/60 uppercase">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={value}
        className="mt-1.5 h-11 w-full rounded-lg border border-white/10 bg-forest-950/60 px-3.5 text-sm text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      />
    </div>
  )
}
