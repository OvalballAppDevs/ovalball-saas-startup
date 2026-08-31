import { LegalPageLayout, LegalSection } from "@/components/site/legal-page-layout"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"

// Placeholder terms content for the signup flow's acceptance step. Replace
// with the actual reviewed Terms and Conditions before this goes live --
// bump CURRENT_TERMS_VERSION (lib/signup/terms.ts) when the content changes
// materially; that re-prompts every user to accept again.
export default function TermsPage() {
  return (
    <LegalPageLayout eyebrow={`Version ${CURRENT_TERMS_VERSION}`} title="Terms and Conditions">
      <p>
        Placeholder content. This page needs real, reviewed Terms and Conditions before the
        signup flow&apos;s acceptance step is wired to live submissions.
      </p>
      <LegalSection title="1. Who these terms are for">
        [NEEDS INPUT] Confirm whether these terms cover club members, club administrators, and
        Site Admins under one document, or whether club-facing terms need a separate agreement.
      </LegalSection>
      <LegalSection title="2. Account and eligibility">
        [NEEDS INPUT] Minimum age to hold an Ovalball account, and how the product handles data
        for players under that age entered by a parent/guardian or club official.
      </LegalSection>
      <LegalSection title="3. Club claims and authority declarations">
        A person claiming or requesting to join a club on Ovalball declares, but does not prove,
        their real-world authority to act for that club; Ovalball reviews claims before granting
        any administrative access. [NEEDS INPUT] Consequences for a false declaration.
      </LegalSection>
      <LegalSection title="4. Acceptable use">
        [NEEDS INPUT] Prohibited conduct on the platform (e.g. misuse of fixture/contact data,
        harassment via partner-club messaging once that feature ships).
      </LegalSection>
      <LegalSection title="5. Termination">
        [NEEDS INPUT] Grounds and process for suspending or removing an account or a club.
      </LegalSection>
      <LegalSection title="6. Liability and disclaimers">
        [NEEDS INPUT] Standard limitation-of-liability language &mdash; needs legal drafting, not
        product input.
      </LegalSection>
      <LegalSection title="7. Governing law">
        [NEEDS INPUT] Jurisdiction.
      </LegalSection>
    </LegalPageLayout>
  )
}
