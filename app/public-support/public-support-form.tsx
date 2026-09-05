"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/lib/support/types"

import { submitPublicSupportTicket } from "./actions"

const FIELD_CLASS =
  "mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"

export function PublicSupportForm() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [category, setCategory] = useState<SupportCategory | "">("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [clubContext, setClubContext] = useState("")
  const [honeypot, setHoneypot] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!category || !name.trim() || !email.trim() || !subject.trim() || !description.trim()) return

    setStatus("submitting")
    setError(null)
    const result = await submitPublicSupportTicket({ name, email, category, subject, description, clubContext, honeypot })
    if (result.ok) {
      setStatus("sent")
      setReference(result.reference)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto size-8 text-forest-800" />
        <h2 className="mt-4 font-display text-display-s text-ink">We&apos;ve got your request</h2>
        <p className="mt-2 text-sm text-ink/60">
          Reference <strong className="text-ink">{reference}</strong>. We&apos;ll reply to{" "}
          <strong className="text-ink">{email}</strong> as soon as we can.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-xl border border-ink/10 bg-white p-6 md:p-8">
      {/* Off-screen honeypot -- invisible and unreachable by a real visitor
          (no label, aria-hidden, tabIndex -1), but a scripted form-filler
          typically populates every input it finds. */}
      <div aria-hidden="true" className="absolute -left-[9999px]" tabIndex={-1}>
        <label htmlFor="website">Website</label>
        <input id="website" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="ps-name">Your name</Label>
          <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="ps-email">Email address</Label>
          <Input
            id="ps-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
          <p className="mt-1 text-xs text-ink/45">We&apos;ll reply here -- no account or sign-in needed.</p>
        </div>
      </div>

      <div>
        <Label htmlFor="ps-category">Nature of query</Label>
        <select
          id="ps-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportCategory)}
          required
          className={`${FIELD_CLASS} h-11`}
        >
          <option value="" disabled>
            Select a category…
          </option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SUPPORT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="ps-subject">Subject</Label>
        <Input
          id="ps-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A short summary of what's wrong"
          required
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>

      <div>
        <Label htmlFor="ps-description">Description</Label>
        <textarea
          id="ps-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={6}
          placeholder="Tell us what happened or what you need help with…"
          className={`${FIELD_CLASS} resize-y py-2.5`}
        />
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Never include passwords or authentication codes in a support request.</span>
        </div>
      </div>

      <div>
        <Label htmlFor="ps-club">Club (optional)</Label>
        <Input
          id="ps-club"
          value={clubContext}
          onChange={(e) => setClubContext(e.target.value)}
          placeholder="Which club is this about, if any?"
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={status === "submitting"} className="h-11">
        {status === "submitting" ? "Sending…" : "Send request"}
      </Button>

      <p className="text-center text-xs text-ink/40">
        Already have an Ovalball account?{" "}
        <a href="/login" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Sign in
        </a>{" "}
        for faster, tracked support.
      </p>
    </form>
  )
}
