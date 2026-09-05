import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection } from "@/components/site/legal-prose"
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_ROUTE, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Safeguarding & Online Safety | Ovalball",
  description:
    "How Ovalball supports safeguarding for rugby clubs and young players, what the platform does, and where responsibility sits.",
}

export default function SafeguardingPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Safeguarding &amp; Online Safety" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        Ovalball is designed to support rugby administration involving adults and young players.
        Safeguarding is therefore an important part of how the service is designed and used.
      </p>
      <LegalDocumentMeta />

      <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3.5">
        <p className="text-[15px] font-semibold text-ink">If someone is in immediate danger</p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink/80">
          Contact the emergency services on 999. Do not wait for a reply from Ovalball or from your
          club.
        </p>
      </div>

      <LegalSection heading="What Ovalball is, and is not">
        <p>
          Ovalball is a technology provider. We build and run the software a club uses to organise
          its rugby.
        </p>
        <p>
          Ovalball is not a safeguarding authority. It is not the RFU or the RFL, not the police, and
          not an emergency service. It does not investigate concerns or make safeguarding decisions.
        </p>
      </LegalSection>

      <LegalSection heading="Where responsibility sits">
        <p>
          Rugby clubs retain their own safeguarding responsibilities, including those owed to their
          governing body. That includes deciding who holds a role at the club, ensuring the right
          people are appointed and vetted, and following their own safeguarding policy and reporting
          routes.
        </p>
        <p>
          Our responsibility is to build the service so that access is properly controlled, and to
          act on reports of misuse of the platform.
        </p>
      </LegalSection>

      <LegalSection heading="How the design supports safeguarding">
        <LegalList
          items={[
            "Access depends on role and relationship. Belonging to one club gives no access to another club's players, and a role over one team gives no authority over another.",
            "Guardian access is tied to a specific player. It is not a general permission, and it does not confer club or team administration.",
            "A young player's own login, where enabled, is governed by permissions their linked guardian controls and can withdraw.",
            "Date of birth drives the rugby age grade, which governs which teams a player may play for and which protections apply.",
            "Playing outside the normal age grade requires a recorded dispensation, including governing-body approval where that is required.",
            "Messaging is scoped to a fixture, club or team rather than being open person-to-person across the platform.",
            "Messages can be reported, and significant administrative actions are recorded in an audit log.",
            "Access rules are enforced by the database itself, so an unauthorised request is refused by the service rather than merely hidden in the interface.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Reporting a concern about Ovalball use">
        <p>
          If someone is using Ovalball inappropriately &mdash; for example sending unsuitable
          messages, or accessing information they have no authority to see &mdash; report it.
        </p>
        <LegalList
          items={[
            "Tell your club's safeguarding lead or a club administrator. They can act immediately on roles and access at the club.",
            "Report the message within Ovalball where the reporting option is available.",
            <>
              Contact {OPERATOR_NAME} at{" "}
              <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
                {CONTACT_EMAIL}
              </a>{" "}
              or through the{" "}
              <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
                Ovalball contact page
              </Link>
              , choosing &ldquo;Safeguarding / online safety&rdquo;. This address is monitored
              during ordinary working hours and is not an emergency service &mdash; if a child is at
              immediate risk, always use the emergency guidance above first.
            </>,
          ]}
        />
        <p>
          Where a concern indicates a risk to a child, it should also go to the club&rsquo;s
          safeguarding lead and, where appropriate, to the relevant governing body or statutory
          services. Reporting to us does not replace those routes.
        </p>
      </LegalSection>

      <LegalSection heading="What we may do">
        <p>
          Depending on what is reported, we may restrict access, suspend an account, remove content
          where appropriate, inform the club, or contact law enforcement or a regulator where that is
          appropriate or legally required.
        </p>
      </LegalSection>

      <LegalSection heading="For young players">
        <p>
          There is a page written for young players explaining what is stored about them, who can see
          it, and the rights they have:{" "}
          <Link href="/legal/children-privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Your Privacy on Ovalball
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
