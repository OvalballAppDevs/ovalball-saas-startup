"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { publishDraft, renderPreview, restoreDefault, saveDraft } from "../actions"

export interface EditableContent {
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string
}

interface VariableRow {
  name: string
  description: string
  sample: string
}

interface VersionRow {
  revision: number
  status: string
  createdAt: string
  isActive: boolean
  subject: string
}

/**
 * ONE SAVE, NOT SIX.
 *
 * Everything on this screen is one document, so it has one dirty state, one
 * Save and one Discard. Per-field saves make a half-saved email possible --
 * a published subject line belonging to a body that was never saved -- which
 * is exactly the state the version history exists to make impossible.
 *
 * SAVE AND PUBLISH ARE DELIBERATELY SEPARATE.
 *
 * Saving keeps a draft nobody receives. Publishing is what changes what real
 * people are sent, so it is its own decision with its own button and its own
 * sentence describing the consequence. Fusing them would mean every keystroke
 * an administrator is still thinking about is live.
 */
export function TemplateEditor({
  eventKey,
  canEdit,
  initial,
  hasCta,
  variables,
  expectedLock,
  hasDraft,
  isCustomised,
  previewHtml,
  sampleValues,
  versions,
}: {
  eventKey: string
  canEdit: boolean
  initial: EditableContent
  hasCta: boolean
  variables: VariableRow[]
  expectedLock: number
  hasDraft: boolean
  isCustomised: boolean
  previewHtml: string
  sampleValues: Record<string, string>
  versions: VersionRow[]
}) {
  const router = useRouter()
  const [content, setContent] = useState<EditableContent>(initial)
  const [preview, setPreview] = useState(previewHtml)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const dirty = useMemo(
    () => (Object.keys(initial) as Array<keyof EditableContent>).some((k) => content[k] !== initial[k]),
    [content, initial]
  )

  function set<K extends keyof EditableContent>(field: K, value: string) {
    setContent((c) => ({ ...c, [field]: value }))
    setError(null)
    setNotice(null)
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(success)
      router.refresh()
    })
  }

  /**
   * The preview is rendered on the SERVER, by the renderer that sends. It is
   * the whole point of the screen: an administrator has to be able to see the
   * thing a recipient will see, not a browser's impression of it.
   */
  function refreshPreview() {
    setError(null)
    startTransition(async () => {
      const result = await renderPreview({ eventKey, ...content })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPreview(result.html)
      setNotice("Preview updated. Nothing has been sent.")
    })
  }

  return (
    <div className="mt-8 space-y-8">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-white px-4 py-3 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-forest-800/25 bg-mint-100/50 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      <section>
        <h2 className="font-display text-lg text-ink">Wording</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">
          What this email says. When it is sent, who receives it and where its button goes are part of the product and
          cannot be changed here.
        </p>

        <div className="mt-4 space-y-4 rounded-lg border border-ink/10 bg-white p-5">
          <Field
            id="subject"
            label="Subject line"
            hint="What somebody sees in their inbox before they open it."
            value={content.subject}
            onChange={(v) => set("subject", v)}
            disabled={!canEdit}
          />
          <Field
            id="preheader"
            label="Preview text"
            hint="The short line most email apps show after the subject. Leave it empty and the app will use the first words of the email instead."
            value={content.preheader}
            onChange={(v) => set("preheader", v)}
            disabled={!canEdit}
          />
          <Field
            id="heading"
            label="Heading"
            hint="The first line inside the email."
            value={content.heading}
            onChange={(v) => set("heading", v)}
            disabled={!canEdit}
          />

          <div>
            <Label htmlFor="body">Body</Label>
            <textarea
              id="body"
              rows={7}
              value={content.body}
              disabled={!canEdit}
              onChange={(e) => set("body", e.target.value)}
              aria-describedby="body-hint"
              className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:bg-ink/[0.03]"
            />
            <p id="body-hint" className="mt-1 text-xs text-ink/55">
              Leave a blank line between paragraphs. Formatting, spacing and the Ovalball footer are added for you.
            </p>
          </div>

          {hasCta && (
            <Field
              id="cta"
              label="Button label"
              hint="The words on the button. Where it goes is decided by Ovalball and is not editable."
              value={content.ctaLabel}
              onChange={(v) => set("ctaLabel", v)}
              disabled={!canEdit}
            />
          )}
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-11"
              disabled={!dirty || pending}
              onClick={() =>
                run(() => saveDraft({ eventKey, ...content, expectedLock }), "Draft saved. Nobody has been sent this yet.")
              }
            >
              {pending ? "Saving…" : "Save draft"}
            </Button>
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={() => {
                setContent(initial)
                setError(null)
                setNotice(null)
              }}
              className="min-h-11 text-sm text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
            >
              Discard changes
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={refreshPreview}
              className="min-h-11 text-sm text-forest-800 underline underline-offset-2 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Update preview
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">What you can put in this email</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">
          Type these exactly as written and Ovalball fills them in when the email is sent. Anything else is refused when
          you save, because a recipient would see a blank space where it should have been.
        </p>
        {variables.length === 0 ? (
          <p className="mt-3 max-w-xl text-sm text-ink-muted">
            This email carries no details of its own, so there is nothing to insert.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {variables.map((v) => (
              <li key={v.name} className="px-5 py-3.5">
                <code className="text-sm text-forest-800">{`{{${v.name}}}`}</code>
                <p className="mt-0.5 text-sm text-ink-muted">{v.description}</p>
                <p className="mt-0.5 text-xs text-ink/55">
                  In the preview below this reads &ldquo;{sampleValues[v.name] ?? v.sample}&rdquo;.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">Preview</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">
          Rendered by the same code that sends the real email, using made-up details. Nothing here is sent to anybody.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-ink/10 bg-white">
          <iframe
            title={`Preview of the ${eventKey.replace(/_/g, " ")} email`}
            srcDoc={preview}
            sandbox=""
            className="h-[520px] w-full"
          />
        </div>
      </section>

      {canEdit && (
        <section>
          <h2 className="font-display text-lg text-ink">Publishing</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            {hasDraft
              ? "There is a saved draft nobody has received. Publishing makes it the wording Ovalball sends from now on."
              : "There is nothing waiting to be published. Save a draft first."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-11"
              disabled={!hasDraft || dirty || pending}
              onClick={() =>
                run(() => publishDraft(eventKey, expectedLock), "Published. New emails will use this wording.")
              }
            >
              Publish this wording
            </Button>
            {isCustomised && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => restoreDefault(eventKey, expectedLock),
                    "This email has gone back to Ovalball's wording. The earlier versions are still listed below."
                  )
                }
                className="min-h-11 text-sm text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Go back to Ovalball&apos;s wording
              </button>
            )}
          </div>
          {dirty && hasDraft && (
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Save your changes before publishing, otherwise you would publish the draft as it was, not as you have just
              written it.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="font-display text-lg text-ink">History</h2>
        {versions.length === 0 ? (
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            This email has never been changed, so it is sending Ovalball&apos;s own wording.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {versions.map((v) => (
              <li key={v.revision} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink">Version {v.revision}</span>
                  <span className="mt-0.5 block truncate text-sm text-ink-muted">{v.subject}</span>
                </span>
                <span className="shrink-0 text-xs text-ink/55">
                  {v.isActive ? "Being sent now · " : v.status === "draft" ? "Unpublished draft · " : ""}
                  {new Date(v.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="mt-1.5 h-11"
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink/55">
        {hint}
      </p>
    </div>
  )
}
