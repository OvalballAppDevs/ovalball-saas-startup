"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { CONTRACTED_EVENT_KEYS, templateContract, unknownVariables } from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { getSiteUrl } from "@/lib/site-url"
import type { EmailEventKey } from "@/lib/email/catalogue"
import { createClient } from "@/lib/supabase/server"

export type EmailTemplateActionResult = { ok: true } | { ok: false; error: string }

/**
 * WHAT A SITE ADMIN MAY CHANGE HERE, AND WHAT THEY MAY NOT.
 *
 * May: the words. Subject, preheader, heading, body, button label.
 *
 * May not: which events exist, when they fire, who receives them, what data
 * they can reach, where the button goes, or whether an email is sent at all
 * for a safeguarding or identity event. Those are code, and they stay code --
 * a screen that can retarget a password-style email or repoint its button is
 * a phishing console with a company logo on it.
 *
 * Every write below goes through a SECURITY DEFINER function that re-checks
 * Full Site Admin authority itself. The check in this file is the honest
 * front door, never the lock: a server action is reachable by anyone who can
 * reach the application.
 */
async function authorise() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const active = await requireActiveSiteAdmin(supabase, user)
  if (!active.ok) {
    return { ok: false as const, error: "Site Admin access is required, in an active Site Admin context." }
  }
  if (active.ctx.siteAdminRole !== "full") {
    return { ok: false as const, error: "Only a Full Site Admin may change Ovalball's email configuration." }
  }
  return { ok: true as const, supabase }
}

/**
 * The event key arrives from a URL, so it is treated as a string from a
 * stranger until it matches the code catalogue. Nothing downstream accepts an
 * event the code does not define -- which is also why the registry tables
 * carry no foreign key inviting the database to invent one.
 */
function asEventKey(value: string): EmailEventKey | null {
  return (CONTRACTED_EVENT_KEYS as readonly string[]).includes(value) ? (value as EmailEventKey) : null
}

/** The wording itself. A preview needs this much and no more. */
export interface TemplateCopyInput {
  eventKey: string
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string
}

/**
 * A save additionally carries the settings revision the editor was opened
 * against, which is what lets the database refuse a stale editor rather than
 * letting one administrator silently overwrite another's newer work.
 */
export interface DraftInput extends TemplateCopyInput {
  expectedLock: number
}

/**
 * Validated here as well as at render time.
 *
 * Render-time validation is what keeps a bad row from reaching an inbox;
 * this one is what lets an administrator find out at the moment they typed
 * it, rather than discovering by not receiving an email.
 */
function problemWith(key: EmailEventKey, input: TemplateCopyInput): string | null {
  if (!input.subject.trim()) return "An email needs a subject line."
  if (!input.heading.trim()) return "An email needs a heading."
  if (!input.body.trim()) return "An email needs a body."

  const contract = templateContract(key)
  if (contract.hasCta && !input.ctaLabel.trim()) {
    return "This email has a button, so it needs a button label."
  }

  const unknown = unknownVariables(key, input.subject, input.preheader, input.heading, input.body, input.ctaLabel)
  if (unknown.length > 0) {
    const list = unknown.map((v) => `{{${v}}}`).join(", ")
    return `This email does not provide ${list}. A recipient would see a blank space where that should be.`
  }
  return null
}

export async function saveDraft(input: DraftInput): Promise<EmailTemplateActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const key = asEventKey(input.eventKey)
  if (!key) return { ok: false, error: "That is not an email Ovalball sends." }

  const problem = problemWith(key, input)
  if (problem) return { ok: false, error: problem }

  const { error } = await auth.supabase.rpc("save_email_template_draft", {
    p_event_key: key,
    p_subject: input.subject.trim(),
    p_preheader: input.preheader.trim(),
    p_heading: input.heading.trim(),
    p_body: input.body.trim(),
    p_cta_label: input.ctaLabel.trim(),
    p_expected_lock: input.expectedLock,
  })
  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath(`/admin/email/${key}`)
  revalidatePath("/admin/email")
  return { ok: true }
}

export async function publishDraft(eventKey: string, expectedLock: number): Promise<EmailTemplateActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const key = asEventKey(eventKey)
  if (!key) return { ok: false, error: "That is not an email Ovalball sends." }

  const { error } = await auth.supabase.rpc("publish_email_template_draft", {
    p_event_key: key,
    p_expected_lock: expectedLock,
  })
  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath(`/admin/email/${key}`)
  revalidatePath("/admin/email")
  return { ok: true }
}

/**
 * Returns the event to Ovalball's own wording.
 *
 * The stored versions are NOT deleted. This clears which one is active, so
 * the history of what the club-facing wording used to be stays readable --
 * an audit that can be erased by the person being audited is decoration.
 */
export async function restoreDefault(eventKey: string, expectedLock: number): Promise<EmailTemplateActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const key = asEventKey(eventKey)
  if (!key) return { ok: false, error: "That is not an email Ovalball sends." }

  const { error } = await auth.supabase.rpc("clear_email_template_override", {
    p_event_key: key,
    p_expected_lock: expectedLock,
  })
  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath(`/admin/email/${key}`)
  revalidatePath("/admin/email")
  return { ok: true }
}

export type RenderPreviewResult = { ok: true; html: string } | { ok: false; error: string }

/**
 * Renders wording that has not been saved, so an administrator can see it.
 *
 * This is the whole reason the preview is worth anything: it goes through
 * renderEmail -- the same function sendEmailEvent calls -- rather than a
 * second, more forgiving code path. A preview produced by different code is a
 * picture of a system that does not exist.
 *
 * It sends nothing. There is deliberately no "send me a test" here: a screen
 * that can put an arbitrary Ovalball-branded email into an arbitrary inbox is
 * a phishing tool, and the operator's own address is not a special case, it is
 * just the first one somebody would try.
 */
export async function renderPreview(input: TemplateCopyInput): Promise<RenderPreviewResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const key = asEventKey(input.eventKey)
  if (!key) return { ok: false, error: "That is not an email Ovalball sends." }

  const problem = problemWith(key, input)
  if (problem) return { ok: false, error: problem }

  // The controlled fixture for this event: obviously fake, deliberately
  // awkward lengths. No live record is read to build a preview, so a preview
  // can never disclose a real person's details to whoever is editing copy.
  const fixture = PREVIEW_FIXTURES[key][0]
  const rendered = renderEmail(key, fixture.data as never, getSiteUrl(), {
    subject: input.subject,
    preheader: input.preheader,
    heading: input.heading,
    body: input.body,
    ctaLabel: input.ctaLabel.trim() || null,
  })
  return { ok: true, html: rendered.html }
}

/**
 * Database errors reach a person, so they are translated.
 *
 * The refusals the registry functions raise are already written as sentences
 * somebody can act on, so the matching one is shown as written rather than
 * paraphrased into something vaguer. The concurrency case matters most: "this
 * was changed by someone else, reload" is actionable, and "P0001" is not.
 *
 * Anything else is a fault the administrator did not cause and cannot fix from
 * this screen. That gets one plain sentence, and the real message goes to the
 * log where an operator will look for it -- a raw database error shown to a
 * user is both unhelpful and a description of the schema.
 */
const REGISTRY_REFUSALS = [
  "This email has been changed by someone else since you opened it. Reload to see the current version.",
  "This email has no saved draft to publish.",
  "There is no draft to publish for this email.",
  "Only a Full Site Admin may change Ovalball's email configuration.",
]

function toPublicError(message: string): string {
  const refusal = REGISTRY_REFUSALS.find((known) => message.includes(known))
  if (refusal) return refusal
  console.error(`[email-config] ${message}`)
  return "That change could not be saved. Please try again."
}
