/**
 * There is no terms-content table in the schema -- `terms_acceptances` only
 * records a version string per user (see supabase/migrations/
 * 20260830143509_terms_acceptances.sql). The current version and its
 * content are an app-level source of truth until/unless a CMS-backed terms
 * table is introduced. Bump this string whenever the terms at
 * app/terms/page.tsx materially change -- a new version means every
 * user is asked to accept again.
 */
export const CURRENT_TERMS_VERSION = "2026-08-30"
