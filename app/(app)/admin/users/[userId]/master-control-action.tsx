"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import type { ActionResult } from "./master-control"

const MIN_REASON = 10

export type FieldSpec =
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[]; hint?: string }
  | { name: string; label: string; kind: "date"; hint?: string }
  | { name: string; label: string; kind: "checkbox"; hint?: string }

/**
 * SLICE 7e -- one control for every master-control operation.
 *
 * Seventeen RPCs needed a caller and every one of them asks for exactly the same
 * two things: the arguments that identify what is being changed, and a reason at
 * least ten characters long that ends up in the audit line somebody reads months
 * later. Writing seventeen bespoke forms would have produced seventeen slightly
 * different reason boxes, seventeen slightly different refusal displays, and one
 * of them eventually forgetting the reason altogether.
 *
 * So this is the shape, once. The collapsed state is a single button; opening it
 * reveals the fields and the reason; the reason gates the confirm. A refusal from
 * the database is shown verbatim, because the canonical functions write those
 * sentences for the person reading them -- "This would leave the club with no
 * Club Admin" is more use than "couldn't do that".
 *
 * `perform` is a server action bound to its subject on the server. This component
 * therefore cannot choose WHO an operation applies to, only what is asked -- the
 * identity is fixed before the markup reaches the browser.
 */
export function MasterControlAction({
  label,
  confirmLabel,
  description,
  fields = [],
  perform,
  tone = "default",
  placeholder,
  onDone,
}: {
  label: string
  confirmLabel: string
  description: string
  fields?: FieldSpec[]
  perform: (values: Record<string, string>, reason: string) => Promise<ActionResult>
  tone?: "default" | "destructive"
  placeholder?: string
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reasonReady = reason.trim().length >= MIN_REASON

  function close() {
    setOpen(false)
    setValues({})
    setReason("")
    setError(null)
  }

  async function submit() {
    if (!reasonReady || working) return
    setWorking(true)
    setError(null)
    const result = await perform(values, reason)
    setWorking(false)
    if (result.ok) {
      setDone(true)
      close()
      onDone?.()
    } else {
      setError(result.error)
    }
  }

  if (!open) {
    return (
      <div>
        {/*
          `max-w-full whitespace-normal text-left` and an auto height, rather than
          the default single-line button: several of these labels name the thing
          they act on ("Change This Membership — Ovalball UAT RUFC"), and the
          Button base class is `whitespace-nowrap shrink-0`, so a long one pushed
          the whole page sideways on a 320px screen. Shortening the label instead
          would have left two buttons on one card with the same accessible name.
        */}
        <Button
          type="button"
          variant={tone === "destructive" ? "ghost" : "outline"}
          className={`h-auto min-h-9 max-w-full py-2 text-left whitespace-normal ${
            tone === "destructive" ? "text-destructive-text hover:bg-destructive/10" : ""
          }`}
          onClick={() => {
            setDone(false)
            setOpen(true)
          }}
        >
          {label}
        </Button>
        {done && <p className="mt-1.5 text-sm text-forest-800">Done. The change is on the record.</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>

      {fields.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5 text-sm text-ink">
              {/* A checkbox carries its label beside the box, so the heading above would repeat it. */}
              {field.kind !== "checkbox" && <span className="font-medium">{field.label}</span>}
              {field.hint && <span className="text-xs font-normal text-ink-muted">{field.hint}</span>}
              {field.kind === "select" ? (
                <select
                  className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                  value={values[field.name] ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                >
                  <option value="">Choose&hellip;</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.kind === "date" ? (
                <input
                  type="date"
                  className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                  value={values[field.name] ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                />
              ) : (
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-ink/25"
                    checked={values[field.name] === "yes"}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setValues((v) => ({ ...v, [field.name]: e.target.checked ? "yes" : "no" }))
                    }
                  />
                  <span className="text-sm font-normal text-ink-muted">{field.label}</span>
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      <label className="mt-3 flex flex-col gap-1.5 text-sm text-ink">
        <span className="font-medium">Reason</span>
        <span className="text-xs font-normal text-ink-muted">
          Recorded against this account and read by whoever reviews it later. Say what happened, not just what you did.
        </span>
        <textarea
          className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          value={reason}
          maxLength={500}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          placeholder={placeholder}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={tone === "destructive" ? "destructive" : "default"}
          className="h-9"
          disabled={working || !reasonReady}
          onClick={submit}
        >
          {working ? "Working…" : confirmLabel}
        </Button>
        <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={close}>
          Cancel
        </Button>
        {!reasonReady && reason.length > 0 && (
          <span className="text-xs text-ink-muted">A few more words &mdash; at least {MIN_REASON} characters.</span>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
