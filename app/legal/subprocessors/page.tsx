import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalSection, LegalTable } from "@/components/site/legal-prose"
import { CONTACT_ROUTE, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Third-Party Services | Ovalball",
  description:
    "The service providers Ovalball relies on, what each one does, and which are currently active versus supported but not yet enabled.",
}

export default function SubprocessorsPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Third-Party Services" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        Ovalball relies on a small number of external services to run. This page lists them, what
        each does, and whether it is currently active or supported but not yet switched on. It is
        written from the actual configuration of the live service, not from a general list of tools.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="Currently active">
        <LegalTable
          head={["Provider", "What it does for Ovalball", "Information involved"]}
          rows={[
            [
              "Supabase",
              "Hosts the Ovalball database and handles sign-in. This is where club, team, player, fixture and messaging information is stored, and where the access rules are enforced.",
              "Effectively all service information, plus account and authentication details.",
            ],
            [
              "Vercel",
              "Hosts and serves the Ovalball web application at ovalball.co.uk.",
              "Requests to the site, and technical/security information such as error logs.",
            ],
          ]}
        />
      </LegalSection>

      <LegalSection heading="Supported, not yet enabled">
        <p>
          These are built into Ovalball but are not switched on in the live service at the date of
          this page. They are listed for transparency, so the position is clear before they are
          enabled.
        </p>
        <LegalTable
          head={["Provider", "Intended purpose", "Status"]}
          rows={[
            [
              "GoCardless",
              "Collecting club membership payments by Direct Debit where a club enables paid memberships. GoCardless holds the bank details; Ovalball holds references and payment status only.",
              "Supported. Live payment collection is disabled in production.",
            ],
            [
              "Google",
              "Optional sign-in (Continue with Google). Identity and authentication only.",
              "Supported. Not yet enabled.",
            ],
            [
              "Meta / Facebook",
              "Optional sign-in (Continue with Facebook). Identity and authentication only.",
              "Supported. Not yet enabled.",
            ],
            [
              "Apple",
              "Optional sign-in (Sign in with Apple), including Apple's Hide My Email relay. Identity and authentication only.",
              "Supported. Not yet enabled.",
            ],
          ]}
        />
        <p>
          Where sign-in providers are enabled, Ovalball will request identity and authentication
          information only. It will not request contacts, friends, photographs, posts, calendars or
          advertising data.
        </p>
      </LegalSection>

      <LegalSection heading="Not used">
        <p>
          Ovalball does not use analytics platforms, advertising networks or tracking pixels. There
          is no Google Analytics, no Meta pixel and no comparable tracker in the service. This is
          verified against the application source and is stated in the{" "}
          <Link href="/legal/cookies" className="font-medium text-forest-800 underline underline-offset-4">
            Cookie Policy
          </Link>{" "}
          as well.
        </p>
      </LegalSection>

      <LegalSection heading="Location of processing">
        <p>
          Our providers may process information outside the United Kingdom. Where that happens, the
          transfer must be covered by an appropriate safeguard recognised under UK data protection
          law. We deliberately do not claim a specific data-centre region here, because that depends
          on provider configuration and we will not state it until it is confirmed and can be kept
          accurate.
        </p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>
          This list will be updated as providers are added, enabled or removed, with the version and
          dates above. Questions can go to {OPERATOR_NAME} via the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball support page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
