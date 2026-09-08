import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { EmailEventKey } from "./catalogue"
import { templateContract, unknownVariables, type EmailTemplateContent } from "./contracts"

/**
 * THE ONE RESOLUTION PATH.
 *
 *   registered event
 *     -> active published version, if there is one AND it validates
 *     -> otherwise the registered code-owned default
 *     -> shared renderer
 *
 * There is deliberately no branch on the caller. Production sending and the
 * Site Admin preview both come through here, which is what makes the preview
 * worth trusting: a preview rendered by a different path is a picture of what
 * a different system would have sent.
 *
 * FAILING SAFE, AND WHY IT IS NOT SILENT
 *
 * A stored version can go wrong in ways nobody intended -- a variable removed
 * from a contract, an empty subject saved by a broken client, a row edited
 * directly. When that happens the registered default is used, because an email
 * with Ovalball's default wording is a far better outcome than a blank one or
 * one containing a literal `{{club_name}}`. The substitution is logged: an
 * override that is quietly not in use is a Site Admin looking at a screen that
 * disagrees with reality.
 */

export interface ResolvedContent {
  content: EmailTemplateContent
  /** 'active' when a published override is in use, 'default' otherwise. */
  source: "active" | "default"
  /** Set when an override existed but was rejected. */
  fallbackReason: string | null
}

/**
 * Whether a stored version is fit to send.
 *
 * Checked at render time rather than trusted from save time, because the row
 * may have been written before a contract changed -- a variable can be removed
 * from an event long after somebody used it.
 */
function validate(key: EmailEventKey, content: EmailTemplateContent): string | null {
  if (!content.subject.trim()) return "the subject is empty"
  if (!content.heading.trim()) return "the heading is empty"
  if (!content.body.trim()) return "the body is empty"

  const unknown = unknownVariables(key, content.subject, content.preheader, content.heading, content.body, content.ctaLabel)
  if (unknown.length > 0) return `it uses variables this email does not provide: ${unknown.join(", ")}`

  if (templateContract(key).hasCta && !content.ctaLabel?.trim()) {
    return "this email has a button, and its label is empty"
  }
  return null
}

/**
 * Reads the copy for one event.
 *
 * The Supabase client is the CALLER'S, so the registry's row-level security
 * applies -- but the fallback means an ordinary send does not need to be able
 * to read the table at all. A sender that cannot see an override simply uses
 * the registered default, which is the correct outcome: email copy is Site
 * Admin configuration, not something every server action needs read access to.
 */
export async function resolveTemplateContent(
  supabase: SupabaseClient<Database>,
  key: EmailEventKey
): Promise<ResolvedContent> {
  const fallback: ResolvedContent = {
    content: templateContract(key).default,
    source: "default",
    fallbackReason: null,
  }

  const { data: settings } = await supabase
    .from("email_template_settings")
    .select("active_version_id")
    .eq("event_key", key)
    .maybeSingle()

  if (!settings?.active_version_id) return fallback

  const { data: version } = await supabase
    .from("email_template_versions")
    .select("subject, preheader, heading, body, cta_label")
    .eq("id", settings.active_version_id)
    .maybeSingle()

  if (!version) {
    return { ...fallback, fallbackReason: "the active version could not be read" }
  }

  const content: EmailTemplateContent = {
    subject: version.subject,
    preheader: version.preheader,
    heading: version.heading,
    body: version.body,
    ctaLabel: version.cta_label,
  }

  const problem = validate(key, content)
  if (problem) {
    // Loud in the log, safe in the inbox.
    console.error(`[email] active template for "${key}" was not used because ${problem}. The Ovalball default was sent instead.`)
    return { ...fallback, fallbackReason: problem }
  }

  return { content, source: "active", fallbackReason: null }
}

/**
 * Substitutes an event's registered variables into a piece of copy.
 *
 * The map is BUILT FOR THE EVENT and contains only its contracted keys -- no
 * domain object is ever handed to this function. A tag that is not in the map
 * renders as empty rather than as the literal `{{tag}}`, because a recipient
 * seeing template syntax is worse than a recipient seeing a gap, and the
 * validation above means a published template cannot contain one anyway.
 *
 * No escaping happens here. The values are substituted as plain text and every
 * consumer -- heading(), paragraph(), the subject line -- escapes at the point
 * it renders, so a club called `<script>` is inert in HTML and intact in text.
 */
export function applyVariables(copy: string, values: Record<string, string>): string {
  return copy.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_match, name: string) => values[name] ?? "")
}
