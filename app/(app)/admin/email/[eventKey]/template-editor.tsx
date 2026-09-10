"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Info, PanelRightOpen, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

import { publishDraft, renderPreview, restoreDefault, saveDraft, sendTestEmail } from "../actions"

export interface EditableContent {
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string
}

/** One field a variable can be inserted into. Every registered variable is plain text, so every field accepts every variable -- see lib/email/resolve-content.ts's own validation, which checks all five identically. */
type FieldName = "subject" | "preheader" | "heading" | "body" | "cta"

/**
 * One entry in the Dynamic Data catalogue, as the page hands it down --
 * already merged from scalar variables AND renderer-owned structured/image
 * blocks (lib/email/contracts.ts#allowedVariables + #structuredBlocksFor),
 * both resolved from the ONE catalogue in lib/email/dynamic-data/
 * catalogue.ts. This is the only shape the panel below understands; it does
 * not know or care whether an entry came from the scalar list or the
 * structured-block list.
 */
interface DynamicDataRow {
  key: string
  label: string
  group: string
  kind: "scalar" | "structured" | "image"
  description: string
  sample: string
  source: string
  availability: string
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
  dynamicData,
  recommendedKeys,
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
  dynamicData: DynamicDataRow[]
  recommendedKeys: string[]
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
  const [previewIsStale, setPreviewIsStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [dynamicDataOpen, setDynamicDataOpen] = useState(false)
  const [activeField, setActiveField] = useState<FieldName>("body")
  const [testEmailOpen, setTestEmailOpen] = useState(false)
  const [testEmailAddress, setTestEmailAddress] = useState("")
  const [testEmailError, setTestEmailError] = useState<string | null>(null)
  const [testEmailNotice, setTestEmailNotice] = useState<string | null>(null)
  const [testEmailPending, startTestEmailTransition] = useTransition()

  const subjectRef = useRef<HTMLInputElement>(null)
  const preheaderRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const ctaRef = useRef<HTMLInputElement>(null)

  const fieldRefs: Record<FieldName, React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = {
    subject: subjectRef,
    preheader: preheaderRef,
    heading: headingRef,
    body: bodyRef,
    cta: ctaRef,
  }

  const dirty = useMemo(
    () => (Object.keys(initial) as Array<keyof EditableContent>).some((k) => content[k] !== initial[k]),
    [content, initial]
  )

  /**
   * What "Send Test Email" is actually about to send -- an operator must
   * never discover only afterwards that "the draft" meant something they
   * did not expect. Unsaved changes take precedence over hasDraft/
   * isCustomised because a test always renders the CURRENT editor content,
   * whether or not it has been saved as a draft yet.
   */
  const testingLabel = dirty
    ? "unsaved changes"
    : hasDraft
      ? "the unpublished draft"
      : isCustomised
        ? "the published wording"
        : "Ovalball's default wording"

  function set<K extends keyof EditableContent>(field: K, value: string) {
    setContent((c) => ({ ...c, [field]: value }))
    setError(null)
    setNotice(null)
    setPreviewIsStale(true)
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
      setPreviewIsStale(false)
      setNotice("Preview updated. Nothing has been sent.")
    })
  }

  const FIELD_KEY: Record<FieldName, keyof EditableContent> = {
    subject: "subject",
    preheader: "preheader",
    heading: "heading",
    body: "body",
    cta: "ctaLabel",
  }

  /**
   * Inserts a variable's token at the cursor of whichever field last had
   * focus, replacing any current selection -- never appended to the end.
   * Falls back to Body when nothing has been focused yet (a keyboard user
   * opening the panel before touching a field), because Body is the field
   * every registered email actually has.
   */
  function insertVariable(token: string) {
    const field = hasCta || activeField !== "cta" ? activeField : "body"
    const key = FIELD_KEY[field]
    const el = fieldRefs[field].current
    const value = content[key]

    // A textarea/input that has never been focused reports selectionStart 0
    // regardless of its content -- that is a property of the DOM element, not
    // a real cursor position a person left there. Trusting it would insert at
    // the very start of a field nobody has touched yet, which reads as "stuck
    // to the front of the first word" rather than "appended where you'd
    // expect". Genuine focus is the only signal that a selection is real.
    const hasRealSelection = document.activeElement === el
    const start = hasRealSelection ? (el?.selectionStart ?? value.length) : value.length
    const end = hasRealSelection ? (el?.selectionEnd ?? value.length) : value.length
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`
    set(key, next)

    const caret = start + token.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange?.(caret, caret)
    })
    setNotice(`{{${token.slice(2, -2).trim()}}} inserted.`)
  }

  const dynamicDataPanel = (
    <DynamicDataPanel
      items={dynamicData}
      recommendedKeys={recommendedKeys}
      sampleValues={sampleValues}
      canEdit={canEdit}
      onInsert={insertVariable}
      activeFieldLabel={FIELD_LABELS[activeField]}
    />
  )

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="space-y-8">
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg text-ink">Wording</h2>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-1.5 text-sm lg:hidden"
                onClick={() => setDynamicDataOpen(true)}
              >
                <PanelRightOpen className="size-4" aria-hidden="true" />
                Dynamic Data
              </Button>
            )}
          </div>
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
              onFocus={() => setActiveField("subject")}
              disabled={!canEdit}
              inputRef={subjectRef}
            />
            <Field
              id="preheader"
              label="Preview text"
              hint="The short line most email apps show after the subject. Leave it empty and the app will use the first words of the email instead."
              value={content.preheader}
              onChange={(v) => set("preheader", v)}
              onFocus={() => setActiveField("preheader")}
              disabled={!canEdit}
              inputRef={preheaderRef}
            />
            <Field
              id="heading"
              label="Heading"
              hint="The first line inside the email."
              value={content.heading}
              onChange={(v) => set("heading", v)}
              onFocus={() => setActiveField("heading")}
              disabled={!canEdit}
              inputRef={headingRef}
            />

            <div>
              <Label htmlFor="body">Body</Label>
              <textarea
                id="body"
                ref={bodyRef}
                rows={7}
                value={content.body}
                disabled={!canEdit}
                onChange={(e) => set("body", e.target.value)}
                onFocus={() => setActiveField("body")}
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
                onFocus={() => setActiveField("cta")}
                disabled={!canEdit}
                inputRef={ctaRef}
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
                {pending ? "Saving…" : "Save Draft"}
              </Button>
              <button
                type="button"
                disabled={!dirty || pending}
                onClick={() => {
                  setContent(initial)
                  setError(null)
                  setNotice(null)
                  setPreviewIsStale(false)
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
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setTestEmailError(null)
                  setTestEmailNotice(null)
                  setTestEmailOpen(true)
                }}
              >
                Send Test Email
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-ink">Preview</h2>
            {previewIsStale && canEdit && (
              <span className="rounded-full border border-amber-500/40 bg-amber-50/60 px-2.5 py-0.5 text-xs font-medium text-ink">
                Draft preview &mdash; click &ldquo;Update preview&rdquo; to see your latest changes
              </span>
            )}
          </div>
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

      {canEdit && (
        <>
          <div className="hidden lg:sticky lg:top-8 lg:block">{dynamicDataPanel}</div>

          <Sheet open={dynamicDataOpen} onOpenChange={setDynamicDataOpen}>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>Dynamic Data</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-4">{dynamicDataPanel}</div>
            </SheetContent>
          </Sheet>

          <Dialog open={testEmailOpen} onOpenChange={setTestEmailOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Test Email</DialogTitle>
                <DialogDescription>
                  Testing {testingLabel}, with made-up preview details. Sent to one address you choose now &mdash; nobody
                  else receives it, and nothing here is saved or published.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="test-email-address">Send to</Label>
                  <Input
                    id="test-email-address"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    className="mt-1.5 h-11"
                    placeholder="you@example.com"
                    value={testEmailAddress}
                    onChange={(e) => {
                      setTestEmailAddress(e.target.value)
                      setTestEmailError(null)
                    }}
                    disabled={testEmailPending}
                  />
                </div>

                <div aria-live="polite">
                  {testEmailError && (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-white px-3 py-2 text-sm text-destructive-text">
                      {testEmailError}
                    </p>
                  )}
                  {testEmailNotice && (
                    <p role="status" className="rounded-lg border border-forest-800/25 bg-mint-100/50 px-3 py-2 text-sm text-ink">
                      {testEmailNotice}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  className="h-11"
                  disabled={testEmailPending || !testEmailAddress.trim()}
                  onClick={() => {
                    setTestEmailError(null)
                    setTestEmailNotice(null)
                    startTestEmailTransition(async () => {
                      const result = await sendTestEmail({ eventKey, ...content }, testEmailAddress)
                      if (!result.ok) {
                        setTestEmailError(result.error)
                        return
                      }
                      setTestEmailNotice(`Test email sent to ${result.destination}.`)
                    })
                  }}
                >
                  {testEmailPending ? "Sending…" : "Send Test"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

const FIELD_LABELS: Record<FieldName, string> = {
  subject: "Subject line",
  preheader: "Preview text",
  heading: "Heading",
  body: "Body",
  cta: "Button label",
}

/**
 * A searchable, grouped library of exactly the data this event's contract
 * allows -- nothing more. Search covers the key, label, group and
 * description; it never reaches into a database, because there is nothing
 * behind this list except the fixed array the page was given.
 *
 * PROGRESSIVE DISCLOSURE, NOT TOKEN SOUP.
 *
 * "Recommended for this email" surfaces a small, curated set first (never
 * auto-inserted -- an administrator still chooses). Everything else sits
 * under its own group, reached by scrolling or by search, so an event with
 * forty available items never reads as forty identical chips.
 */
function DynamicDataPanel({
  items,
  recommendedKeys,
  sampleValues,
  canEdit,
  onInsert,
  activeFieldLabel,
}: {
  items: DynamicDataRow[]
  recommendedKeys: string[]
  sampleValues: Record<string, string>
  canEdit: boolean
  onInsert: (token: string) => void
  activeFieldLabel: string
}) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<DynamicDataRow | null>(null)

  const normalised = query.trim().toLowerCase()
  const filtered = normalised
    ? items.filter((i) => [i.key, i.label, i.group, i.description].some((field) => field.toLowerCase().includes(normalised)))
    : items

  const recommended = normalised ? [] : recommendedKeys.map((k) => items.find((i) => i.key === k)).filter((i): i is DynamicDataRow => Boolean(i))
  const recommendedKeySet = new Set(recommended.map((r) => r.key))
  const rest = filtered.filter((i) => !recommendedKeySet.has(i.key))
  const groups = [...new Set(rest.map((i) => i.group))]

  if (items.length === 0) {
    return (
      <aside className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="font-display text-base text-ink">Dynamic Data</h2>
        <p className="mt-2 text-sm text-ink-muted">This email carries no details of its own, so there is nothing to insert.</p>
      </aside>
    )
  }

  return (
    <aside className="rounded-lg border border-ink/10 bg-white p-5" aria-label="Dynamic Data library">
      <h2 className="font-display text-base text-ink">Dynamic Data</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Approved data for this email only. Type these exactly and Ovalball fills them in when it sends &mdash; anything
        else is refused when you save.
      </p>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink/40" aria-hidden="true" />
        <label htmlFor="dynamic-data-search" className="sr-only">
          Search dynamic data
        </label>
        <input
          id="dynamic-data-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, e.g. &ldquo;kick-off&rdquo;"
          className="h-11 w-full rounded-lg border border-ink/15 bg-white pr-11 pl-9 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center text-ink/40 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {canEdit && (
        <p className="mt-3 text-xs text-ink/55">
          Inserting into: <span className="font-medium text-ink/70">{activeFieldLabel}</span>
        </p>
      )}

      <div className="mt-3 max-h-[420px] space-y-4 overflow-y-auto">
        {recommended.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-[0.06em] text-ink/50 uppercase">Recommended for this email</p>
            <ul className="mt-1.5 space-y-1.5">
              {recommended.map((row) => (
                <li key={row.key}>
                  <DynamicDataCard
                    row={row}
                    sample={sampleValues[row.key] ?? row.sample}
                    isSelected={selected?.key === row.key}
                    onSelect={() => setSelected((s) => (s?.key === row.key ? null : row))}
                    onInsert={canEdit && row.kind === "scalar" ? () => onInsert(`{{${row.key}}}`) : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.map((group) => (
          <div key={group}>
            <p className="text-xs font-semibold tracking-[0.06em] text-ink/50 uppercase">{group}</p>
            <ul className="mt-1.5 space-y-1.5">
              {rest
                .filter((i) => i.group === group)
                .map((row) => (
                  <li key={row.key}>
                    <DynamicDataCard
                      row={row}
                      sample={sampleValues[row.key] ?? row.sample}
                      isSelected={selected?.key === row.key}
                      onSelect={() => setSelected((s) => (s?.key === row.key ? null : row))}
                      onInsert={canEdit && row.kind === "scalar" ? () => onInsert(`{{${row.key}}}`) : undefined}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing matches &ldquo;{query}&rdquo;.</p>
        )}
      </div>
    </aside>
  )
}

/**
 * One entry in the library. A scalar's double-click inserts, because that is
 * the fast path an owner asked for by name -- but it is never the ONLY path:
 * the explicit "Insert" button and Enter-to-insert both do the same thing,
 * so a keyboard or touch user loses nothing. A structured/image entry has no
 * insert action at all: there is genuinely nothing to insert, so the card
 * says what it is and where it appears instead.
 */
function DynamicDataCard({
  row,
  sample,
  isSelected,
  onSelect,
  onInsert,
}: {
  row: DynamicDataRow
  sample: string
  isSelected: boolean
  onSelect: () => void
  onInsert?: () => void
}) {
  const insertable = row.kind === "scalar"
  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${isSelected ? "border-forest-800/40 bg-mint-100/40" : insertable ? "border-ink/10 bg-white" : "border-ink/10 bg-chalk/60"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onInsert}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onInsert) {
            e.preventDefault()
            onInsert()
          }
        }}
        aria-expanded={isSelected}
        aria-describedby={isSelected ? `${row.key}-detail` : undefined}
        className="flex w-full min-h-11 items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="min-w-0">
          {insertable ? (
            <code className="block truncate text-xs font-medium text-forest-800">{`{{${row.key}}}`}</code>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Info className="size-3.5 shrink-0 text-ink/50" aria-hidden="true" />
              {row.label}
            </span>
          )}
          {insertable && <span className="block truncate text-xs text-ink-muted">{row.label}</span>}
        </span>
      </button>

      {isSelected && (
        <div id={`${row.key}-detail`} className="mt-2 space-y-1.5 border-t border-ink/8 pt-2">
          <p className="text-xs text-ink-muted">{row.description}</p>
          <dl className="grid grid-cols-1 gap-y-1 text-[11px] text-ink/60">
            <div>
              <dt className="inline font-medium text-ink/50">Example: </dt>
              <dd className="inline text-ink">&ldquo;{sample}&rdquo;</dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink/50">Available when: </dt>
              <dd className="inline text-ink">{row.availability || "Always."}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink/50">Source: </dt>
              <dd className="inline text-ink">{row.source}</dd>
            </div>
          </dl>
          {onInsert && (
            <Button type="button" size="sm" className="mt-1.5 h-11 w-full text-xs" onClick={onInsert}>
              Insert
            </Button>
          )}
          {!insertable && (
            <p className="text-[11px] text-ink/50">
              Not a token &mdash; there is nothing to insert, and it cannot be added to Subject, Preview text or the button
              label.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  onFocus,
  disabled,
  inputRef,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  disabled: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={inputRef}
        className="mt-1.5 h-11"
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink/55">
        {hint}
      </p>
    </div>
  )
}
