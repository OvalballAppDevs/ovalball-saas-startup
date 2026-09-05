"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createSupportTicket } from "./actions"
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/lib/support/types"

/**
 * source_route is captured automatically from the page the form was
 * opened on (usePathname) -- no separate "Need help from this screen?"
 * button needed for this pass, but the ticket still carries useful
 * context without asking the user to describe where they were.
 */
export function NewSupportRequestForm({ onCreated }: { onCreated: (id: string, reference: string) => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const [category, setCategory] = useState<SupportCategory | "">("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category) {
      setError("Please choose a category.")
      return
    }
    if (subject.trim().length === 0 || description.trim().length === 0) {
      setError("Please fill in the subject and description.")
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await createSupportTicket({ category, subject, description, sourceRoute: pathname })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated(result.id, result.reference)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <Label htmlFor="support-category">Nature of query</Label>
        <select
          id="support-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportCategory)}
          required
          className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
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
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A short summary of what's wrong"
          required
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>

      <div>
        <Label htmlFor="support-description">Description</Label>
        <textarea
          id="support-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={6}
          placeholder="Tell us what happened or what you need help with…"
          className="mt-1.5 w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        <p className="mt-1.5 text-xs text-ink/45">Include what you were trying to do and what happened.</p>
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Never include passwords or authentication codes in a support request.</span>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting} className="h-11">
        {submitting ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  )
}
