import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection, LegalSubheading } from "@/components/site/legal-prose"
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_ROUTE, OPERATOR_NAME, PRODUCT_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing access to and use of Ovalball, the rugby administration and club-management platform operated by Pipaxon Technologies Ltd.",
}

export default function TermsPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Terms of Service" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        These Terms govern access to and use of Ovalball, a rugby administration and club-management
        technology service operated by {OPERATOR_NAME}.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="1. Definitions">
        <LegalList
          items={[
            <><strong>Ovalball</strong> &mdash; the rugby administration service provided at ovalball.co.uk.</>,
            <><strong>{OPERATOR_NAME}</strong> &mdash; the company operating Ovalball, referred to as &ldquo;we&rdquo; or &ldquo;us&rdquo;.</>,
            <><strong>User</strong> &mdash; anyone accessing Ovalball, with or without an account.</>,
            <><strong>Club</strong> &mdash; a rugby club using Ovalball to administer its activities.</>,
            <><strong>Club Admin</strong> &mdash; a user with club-wide administrative authority.</>,
            <><strong>Team Admin</strong> &mdash; a user with authority over a specific team.</>,
            <><strong>Coach</strong> &mdash; a user with a coaching role for a team.</>,
            <><strong>Parent/Guardian</strong> &mdash; a user linked to a specific player.</>,
            <><strong>Player</strong> &mdash; a person recorded as playing for a team, who may or may not hold an account.</>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>
          Accounts are intended for adults involved in running or supporting rugby, and for young
          players whose accounts are enabled and controlled by a linked guardian. If you are creating
          an account on behalf of a club, you confirm you are authorised by that club to do so.
        </p>
      </LegalSection>

      <LegalSection heading="3. Account registration and security">
        <p>
          You must provide accurate information when creating an account and keep it up to date. You
          are responsible for activity carried out through your account. Do not share your account
          or your sign-in link with anyone else &mdash; roles in Ovalball carry real authority over
          other people&rsquo;s information.
        </p>
        <p>Tell us or your club promptly if you believe your account has been accessed by someone else.</p>
      </LegalSection>

      <LegalSection id="club-authority" heading="4. Club authority and authorised use">
        <p>
          If you act as a Club Admin, Team Admin, coach or other authorised club user, you must only
          access, enter, change or share information where you have the authority to do so for the
          relevant club, team, player or activity.
        </p>
        <p>
          You must not use Ovalball permissions to access information about players, families, teams
          or clubs that you are not authorised to manage.
        </p>
      </LegalSection>

      <LegalSection heading="5. Club Admin responsibilities">
        <p>
          A Club Admin decides who holds roles at their club, what teams exist, and what information
          the club records. That authority carries responsibility: to grant roles only to appropriate
          people, to remove them promptly when someone leaves the role, and to ensure the
          club&rsquo;s use of Ovalball complies with its own safeguarding and data protection
          obligations.
        </p>
      </LegalSection>

      <LegalSection heading="6. Team Admin and coach responsibilities">
        <p>
          Team-level authority is limited to the team it was granted for. Holding a role for one team
          does not give authority over another. Requests affecting another team &mdash; such as
          calling up a player &mdash; must go through the request process rather than around it.
        </p>
      </LegalSection>

      <LegalSection id="guardians" heading="7. Parents and guardians">
        <p>
          Being linked as a parent or guardian in Ovalball does not grant administrative authority
          over a club or team.
        </p>
        <p>As a guardian you must:</p>
        <LegalList
          items={[
            "provide accurate information about yourself and the player you are linked to",
            "only claim or accept a link to a player where the relationship is genuine",
            "keep access to your account protected, particularly where it controls a young player's account",
            "tell the club if the relationship changes so the link can be updated or ended",
          ]}
        />
      </LegalSection>

      <LegalSection heading="8. Player accounts and young users">
        <p>
          A player may be recorded in Ovalball without holding an account. Where a young player is
          given their own login, what it can do is governed by permissions their linked guardian
          controls, and those permissions can be changed or withdrawn.
        </p>
      </LegalSection>

      <LegalSection heading="9. Rugby activity information">
        <p>
          Fixtures, calendars, pitch and venue allocation, training, attendance, Mini-Rugby Group
          administration, player requests and dispensations are recorded so clubs can run rugby.
          Information entered must be accurate; other clubs, teams and families rely on it to turn up
          in the right place at the right time.
        </p>
        <p>
          Eligibility and dispensation records exist so decisions are traceable. Do not record a
          dispensation that has not actually been approved.
        </p>
      </LegalSection>

      <LegalSection heading="10. Communications">
        <p>
          Messaging in Ovalball is for organising rugby. It is scoped to a fixture, club or team, and
          must be used in line with the{" "}
          <Link href="/legal/acceptable-use" className="font-medium text-forest-800 underline underline-offset-4">
            Acceptable Use &amp; Community Standards
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="11. Safeguarding">
        <p>
          Ovalball is used in an environment involving children. Safeguarding obligations sit with
          the club and the relevant governing bodies; Ovalball provides the technology and the access
          controls. See{" "}
          <Link href="/legal/safeguarding" className="font-medium text-forest-800 underline underline-offset-4">
            Safeguarding &amp; Online Safety
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="12. Payments a club collects from its members">
        <p>
          Where a club enables paid memberships, the agreement to pay is between the paying party and
          the club. Payments are collected through GoCardless, and the amount, collection day, first
          payment treatment and any sibling discount are set by the club and shown before enrolment.
        </p>
        <p>
          Changes a club makes to price, collection day or first-payment policy apply to new
          enrolments; they do not retrospectively alter payments already scheduled or collected. At
          the date of these Terms, live payment collection is not enabled in the production service.
        </p>
      </LegalSection>

      <LegalSection heading="13. What a club pays Ovalball">
        <p>
          Section 12 is about money a club collects from its own members. This section is about
          something different: what a club pays {OPERATOR_NAME} to use {PRODUCT_NAME}. They are
          separate agreements, collected through separate merchant accounts, and neither affects the
          other.
        </p>

        <LegalSubheading>Free trial</LegalSubheading>
        <p>
          A club&rsquo;s trial is thirty <em>usable</em> days, not thirty calendar days. The clock
          runs only while the trial is running and {PRODUCT_NAME} is charging clubs; it stops while{" "}
          {PRODUCT_NAME} is in Beta and while a trial is paused, and the remaining days are held.
          No payment details are required to start a trial, and nothing is charged during it.
        </p>

        <LegalSubheading>Beta</LegalSubheading>
        <p>
          While {PRODUCT_NAME} is in Beta, {OPERATOR_NAME} does not charge clubs. Beta is paused
          time, not deferred debt: when Beta ends, billing resumes going forward and nothing is
          charged retrospectively for the Beta period.
        </p>

        <LegalSubheading>Plans and price</LegalSubheading>
        <p>
          Standard is &pound;15 per month. Pro is &pound;25 per month and is not currently available
          to buy. The price a club agrees is recorded at the time it chooses a plan, and a later
          change to the published price does not change what that club is charged.
        </p>
        <p className="text-ink/60">
          [NEEDS INPUT] The notice period before a price change may take effect for an existing club
          has not been decided, and is deliberately not stated here.
        </p>

        <LegalSubheading>Collection</LegalSubheading>
        <p>
          Where enabled, a club&rsquo;s subscription is collected monthly by Direct Debit through{" "}
          {OPERATOR_NAME}&rsquo;s own payment provider. At the date of these Terms, live collection
          of club subscriptions is not enabled in the production service.
        </p>

        <LegalSubheading>Credit</LegalSubheading>
        <p>
          Credit on a club&rsquo;s account is applied to the next collection before it is taken. A
          collection covered entirely by credit is skipped rather than collected as a zero-value
          payment. Credit is applied against {PRODUCT_NAME} subscription charges only; it is not
          cash, cannot be transferred to another club, and is not exchangeable for money.
        </p>
        <p className="text-ink/60">
          [NEEDS INPUT] Whether credit expires, and after how long, has not been decided.
        </p>

        <LegalSubheading>A failed collection</LegalSubheading>
        <p>
          A collection that does not complete does not immediately remove a club&rsquo;s access. The
          club is told, and the collection is attempted again. Credit that had been applied to a
          collection that then failed is returned to the club&rsquo;s account.
        </p>

        <LegalSubheading>Cancelling</LegalSubheading>
        <p>
          A club may cancel its {PRODUCT_NAME} subscription at any time. Cancelling stops the next
          collection; the club keeps access for the period it has already paid for, and the
          subscription ends at the end of that period. A club&rsquo;s own data is not deleted by
          cancelling &mdash; see the{" "}
          <Link href="/legal/data-rights" className="font-medium text-forest-800 underline underline-offset-4">
            Your Data Rights
          </Link>{" "}
          page.
        </p>
        <p className="text-ink/60">
          [NEEDS INPUT] Whether any part-period refund is offered, and the VAT treatment of these
          charges, both require a business decision and are deliberately not stated here.
        </p>

        <LegalSubheading>Referrals</LegalSubheading>
        <p>
          Where {PRODUCT_NAME} offers a referral reward, the{" "}
          <Link href="/legal/referral-terms" className="font-medium text-forest-800 underline underline-offset-4">
            Referral Terms
          </Link>{" "}
          apply.
        </p>
      </LegalSection>

      <LegalSection heading="14. Third-party sign-in and services">
        <p>
          Ovalball may support signing in with Google, Facebook or Apple. Your use of those providers
          is governed by their own terms. Signing in through a provider authenticates you; it does
          not by itself establish age, a guardian relationship, club membership or any
          administrative role.
        </p>
        <p>
          Ovalball relies on third-party infrastructure and payment providers, listed on the{" "}
          <Link href="/legal/subprocessors" className="font-medium text-forest-800 underline underline-offset-4">
            Third-Party Services
          </Link>{" "}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="15. Intellectual property">
        <p>
          Ovalball, its software, design and branding belong to {OPERATOR_NAME}. These Terms do not
          transfer any ownership in them.
        </p>
        <p>
          Information a club or user enters remains theirs. By entering it you grant us only the
          licence reasonably necessary to host, store, process, display, transmit and back up that
          content so we can operate the service &mdash; not ownership of it, and nothing wider. This
          is described in the{" "}
          <Link href="/legal/privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Privacy Notice
          </Link>
          .
        </p>
        <p>
          Club names, crests and badges, competition names, governing-body marks and other
          third-party trade marks or materials remain the property of their respective owners. Their
          appearance in Ovalball transfers no ownership of them to {OPERATOR_NAME} and implies no
          affiliation or endorsement. This is set out more fully in{" "}
          <Link href="/legal/copyright" className="font-medium text-forest-800 underline underline-offset-4">
            Copyright &amp; Intellectual Property
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="16. Suspension and termination">
        <p>
          We may restrict, suspend or end access where these Terms or the Acceptable Use standards
          are breached, where there is a security or safeguarding risk, or where we are legally
          required to. A club may also remove a person&rsquo;s role at that club independently of us.
        </p>
        <p>
          You may stop using Ovalball at any time and may ask for your account to be closed. What
          happens to information afterwards is explained under{" "}
          <Link href="/legal/data-rights" className="font-medium text-forest-800 underline underline-offset-4">
            Your Data Rights
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="17. Service changes, availability and maintenance">
        <p>
          Ovalball is actively developed, and features may change, be added or be withdrawn. We aim
          to keep the service available but do not guarantee uninterrupted access, and maintenance
          may occasionally interrupt it.
        </p>
      </LegalSection>

      <LegalSection heading="18. Disclaimers and liability">
        <p>
          Ovalball helps clubs organise rugby; it does not run the rugby. We are not responsible for
          decisions a club makes, for the accuracy of information a club enters, or for what happens
          at a fixture or training session.
        </p>
        <p>
          Nothing in these Terms excludes or limits liability where it cannot lawfully be excluded or
          limited, including liability for death or personal injury caused by negligence, or for
          fraud.
        </p>
        <p>
          Subject to that, our liability arising out of use of Ovalball is limited to the extent
          permitted by law.
        </p>
        <p className="text-ink/60">
          The precise liability allocation, and the consumer/business contract position, are subject
          to professional review.
        </p>
      </LegalSection>

      <LegalSection heading="19. Governing law">
        <p>
          These Terms are governed by the law of England and Wales, and the courts of England and
          Wales have jurisdiction. If you are a consumer resident elsewhere in the United Kingdom,
          you keep the benefit of any mandatory protections of the law where you live.
        </p>
      </LegalSection>

      <LegalSection heading="20. Changes to these Terms">
        <p>
          We may update these Terms as Ovalball develops. The effective date, last-updated date and
          version above always reflect the published version.
        </p>
      </LegalSection>

      <LegalSection heading="21. Contact">
        <p>
          To contact {OPERATOR_NAME} about these Terms, email{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>{" "}
          or use the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball contact page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
