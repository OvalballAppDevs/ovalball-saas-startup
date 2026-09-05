import { LEGAL_VERSION } from "@/lib/legal/metadata"

/**
 * The Terms version a new signup records in `terms_acceptances`.
 *
 * There is no terms-content table in the schema -- terms_acceptances stores
 * a version string per user (see supabase/migrations/
 * 20260830143509_terms_acceptances.sql) -- so the published document's own
 * version is the stable identity consent is tied to.
 *
 * This now derives from LEGAL_VERSION rather than carrying its own literal.
 * It previously read "2026-08-30" and its comment pointed at
 * app/terms/page.tsx, which the Legal & Trust work replaced: the Terms now
 * live at /legal/terms and are published as version 1.0. Two hand-maintained
 * version strings for one document is exactly how consent records end up
 * naming a version that was never published, so there is only one now.
 *
 * Changing LEGAL_VERSION therefore changes what NEW signups record. It does
 * not re-prompt anyone: nothing reads terms_acceptances as a gate on an
 * existing session, and no existing row is rewritten. If re-consent is ever
 * wanted, that is a deliberate feature, not a side effect of bumping a
 * string.
 */
export const CURRENT_TERMS_VERSION = LEGAL_VERSION
