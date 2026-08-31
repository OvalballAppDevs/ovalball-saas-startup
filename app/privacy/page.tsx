import { LegalPageLayout, LegalSection } from "@/components/site/legal-page-layout"

// Placeholder Privacy Policy. See HANDOFF/session report for the list of
// business decisions this page is blocked on before it can be reviewed and
// published for real.
export default function PrivacyPage() {
  return (
    <LegalPageLayout eyebrow="Draft" title="Privacy Policy">
      <p>
        Placeholder content. Ovalball collects account details (name, date of birth, address),
        club affiliation requests, and terms-acceptance records as described in the product --
        see the signup flow for exactly what is collected and why. This page needs real, reviewed
        privacy copy before it can be linked as a live legal document.
      </p>
      <LegalSection title="1. What we collect">
        Profile details entered at signup (name, date of birth, address), the club
        claim/join/directory-request a user submits, and terms-acceptance records. [NEEDS INPUT]
        Confirm this list is complete once fixtures/messaging features add their own data
        (e.g. fixture requests, partner-club messages).
      </LegalSection>
      <LegalSection title="2. Why we collect it">
        [NEEDS INPUT] Legal basis under applicable data protection law (e.g. UK GDPR) for each
        category above.
      </LegalSection>
      <LegalSection title="3. Who can see it">
        A user&apos;s own profile and submitted requests are visible only to them and to Site
        Admins reviewing the request; a club&apos;s administrators can see requests to join their
        own club. [NEEDS INPUT] Any data shared with partner clubs once messaging/fixtures ship.
      </LegalSection>
      <LegalSection title="4. Children&apos;s data">
        [NEEDS INPUT] Ovalball&apos;s rugby club context means some team/fixture data will concern
        minors, entered by a parent or club official rather than the minor themselves &mdash;
        this needs its own legal treatment, not a copy of the adult-account policy.
      </LegalSection>
      <LegalSection title="5. Data retention">[NEEDS INPUT] Retention periods per data category.</LegalSection>
      <LegalSection title="6. Your rights">
        [NEEDS INPUT] Access/deletion/correction request process and contact route.
      </LegalSection>
      <LegalSection title="7. Third parties">
        Ovalball uses Supabase for authentication and data storage. [NEEDS INPUT] Any other
        processors (email delivery, analytics) once selected.
      </LegalSection>
      <LegalSection title="8. Contact">
        [NEEDS INPUT] A real privacy contact address &mdash; none exists yet, so none is published
        here.
      </LegalSection>
    </LegalPageLayout>
  )
}
