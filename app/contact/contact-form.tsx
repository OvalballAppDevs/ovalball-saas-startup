"use client"

import Link from "next/link"
import { useId, useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/legal/metadata"
import { CONTACT_REASONS, CONTACT_REASON_LABELS, type ContactReason } from "@/lib/contact/reasons"

import { submitContactMessage } from "./actions"

const FIELD_CLASS =
  "mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"

const EMAIL_LINK_CLASS =
  "font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"

export function ContactForm() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [reason, setReason] = useState<ContactReason | "">("")
  const [message, setMessage] = useState("")
  const [honeypot, setHoneypot] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const nameId = useId()
  const emailId = useId()
  const reasonId = useId()
  const messageId = useId()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (status === "submitting") return

    setStatus("submitting")
    setError(null)
    const result = await submitContactMessage({ name, email, reason, message, honeypot })

    if (result.ok) {
      setStatus("sent")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "sent") {
    return (
      <div
        className="rounded-xl border border-ink/10 bg-white p-8 text-center"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="mx-auto size-8 text-forest-800" aria-hidden="true" />
        <h2 className="mt-4 font-display text-display-s text-ink">Message sent</h2>
        <p className="mt-2 text-[15px] text-ink/70">
          Thanks for contacting Ovalball. Your message has been sent to our team.
        </p>
        <p className="mt-3 text-sm text-ink/50">
          We&apos;ll reply to <strong className="text-ink/70">{email}</strong>.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-ink/10 bg-white p-6 md:p-8"
      noValidate
    >
      {/* Off-screen honeypot: no real visitor sees or reaches this (no
          visible label, aria-hidden, tabIndex -1), but a scripted
          form-filler populates every input it finds. */}
      <div aria-hidden="true" className="absolute -left-[9999px]" tabIndex={-1}>
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor={nameId}>Your name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor={emailId}>Email address</Label>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
          <p className="mt-1 text-xs text-ink/45">We&apos;ll reply here &mdash; no account needed.</p>
        </div>
      </div>

      <div>
        <Label htmlFor={reasonId}>Reason for contacting us</Label>
        <select
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value as ContactReason)}
          required
          className={`${FIELD_CLASS} h-11`}
        >
          <option value="" disabled>
            Select a reason…
          </option>
          {CONTACT_REASONS.map((r) => (
            <option key={r} value={r}>
              {CONTACT_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {/* Contextual, not permanent: this only appears once someone has
          actually selected safeguarding, so it lands as guidance at the
          moment it matters rather than as background noise on the page. */}
      {reason === "safeguarding" && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3"
          role="note"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-800" aria-hidden="true" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">
              If someone is in immediate danger, do not use this form.
            </p>
            <p className="mt-1 text-amber-900/85">
              Contact the emergency services or the appropriate safeguarding authority.{" "}
              {CONTACT_EMAIL} is a general contact address monitored during ordinary working
              hours &mdash; it is not an emergency service and is not monitored around the clock.
              See{" "}
              <Link
                href="/legal/safeguarding"
                className="font-medium underline underline-offset-2"
              >
                Safeguarding
              </Link>{" "}
              for how reporting works.
            </p>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor={messageId}>Message</Label>
        <textarea
          id={messageId}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={7}
          className={`${FIELD_CLASS} resize-y py-2.5`}
        />
      </div>

      {/* Errors are announced, not just painted. */}
      <div aria-live="polite">
        {status === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <p>{error ?? "We couldn't send your message just now."}</p>
            <p className="mt-1">
              Please email us directly at{" "}
              <a href={CONTACT_MAILTO} className="font-medium underline underline-offset-2">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>
        )}
      </div>

      <Button type="submit" disabled={status === "submitting"} className="h-11">
        {status === "submitting" ? "Sending…" : "Send message"}
      </Button>

      <p className="text-sm text-ink/55">
        We&apos;ll use the information you provide to respond to your enquiry. Please don&apos;t
        include sensitive information unless it is necessary, and never include passwords or
        sign-in codes. See our{" "}
        <Link href="/legal/privacy" className={EMAIL_LINK_CLASS}>
          Privacy Notice
        </Link>
        .
      </p>
    </form>
  )
}
