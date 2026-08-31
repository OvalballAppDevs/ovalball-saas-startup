import { LegalPageLayout, LegalSection } from "@/components/site/legal-page-layout"

// Placeholder Cookie Policy. Ovalball currently sets only the Supabase
// auth session cookies (strictly necessary -- no analytics/marketing
// cookies exist in the codebase today), but this page still needs real,
// reviewed copy before it's a live legal document.
export default function CookiesPage() {
  return (
    <LegalPageLayout eyebrow="Draft" title="Cookie Policy">
      <p>
        Placeholder content. As of this session, Ovalball sets only the strictly-necessary
        Supabase authentication session cookies used to keep a user signed in &mdash; there is no
        analytics or marketing tracking in the codebase today. This page needs real, reviewed
        copy, and must be revisited if that ever changes.
      </p>
      <LegalSection title="1. Strictly necessary cookies">
        Supabase Auth session/refresh-token cookies, required to keep a signed-in user
        authenticated. These cannot be disabled without breaking sign-in.
      </LegalSection>
      <LegalSection title="2. Analytics cookies">
        None in use today. [NEEDS INPUT] Update this section if/when analytics tooling is added.
      </LegalSection>
      <LegalSection title="3. Marketing cookies">
        None in use today. [NEEDS INPUT] Update this section if/when marketing tooling is added.
      </LegalSection>
      <LegalSection title="4. Managing cookies">
        [NEEDS INPUT] Decide whether a cookie-consent banner is required for the current
        strictly-necessary-only cookie set under applicable law, or only once a non-essential
        cookie is introduced.
      </LegalSection>
    </LegalPageLayout>
  )
}
