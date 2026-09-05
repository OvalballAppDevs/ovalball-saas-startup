import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection, LegalSubheading } from "@/components/site/legal-prose"
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_ROUTE, OPERATOR_NAME, PUBLIC_ORIGIN } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Your Data Rights | Ovalball",
  description:
    "Your rights over information held in Ovalball, how to exercise them, how to close an account, and how to request deletion including for Facebook sign-in.",
}

export default function DataRightsPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Your Data Rights" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        You have rights over the information held about you in Ovalball. This page explains what they
        are, how to use them, and what happens when an account is closed.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="Your rights">
        <LegalSubheading>Access</LegalSubheading>
        <p>You can ask what information is held about you and receive a copy of it.</p>

        <LegalSubheading>Correction</LegalSubheading>
        <p>
          You can ask for information that is wrong or incomplete to be corrected. Much of this you
          can do directly &mdash; account details in your own account, and club or player records
          through your club administrator.
        </p>

        <LegalSubheading>Deletion</LegalSubheading>
        <p>
          You can ask for information to be deleted. This right is not absolute; see &ldquo;What
          closing an account does and does not do&rdquo; below.
        </p>

        <LegalSubheading>Restriction</LegalSubheading>
        <p>You can ask us to limit how information is used while a concern is being resolved.</p>

        <LegalSubheading>Objection</LegalSubheading>
        <p>
          Where we rely on legitimate interests, you can object and we will reconsider whether we can
          continue.
        </p>

        <LegalSubheading>Portability</LegalSubheading>
        <p>
          Where it applies, you can ask for information you provided to be given to you in a
          commonly used machine-readable format.
        </p>

        <LegalSubheading>Withdrawing consent</LegalSubheading>
        <p>
          Where something relies on your consent, you can withdraw it. Withdrawing consent does not
          undo processing that already happened lawfully.
        </p>

        <LegalSubheading>Complaint</LegalSubheading>
        <p>
          You can complain to the Information Commissioner&rsquo;s Office at ico.org.uk. We would ask
          you to raise it with us first so we can try to resolve it.
        </p>
      </LegalSection>

      <LegalSection heading="Rights for young players">
        <p>
          Young people have these rights themselves; they do not belong only to a parent. A guardian
          may exercise them on a child&rsquo;s behalf where that is appropriate. See{" "}
          <Link href="/legal/children-privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Your Privacy on Ovalball
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="How to make a request">
        <p>
          Email {OPERATOR_NAME} at{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          , or use the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball contact page
          </Link>{" "}
          and choose &ldquo;Privacy / data rights&rdquo; as the reason. Tell us what you are asking
          for, and the email address associated with the Ovalball account so we can identify the
          right records.
        </p>
        <p>
          We may need to verify your identity before acting, particularly for access or deletion
          requests, so that we do not disclose someone else&rsquo;s information to the wrong person.
        </p>
        <p>
          Where the request concerns records your club controls &mdash; team membership, player
          records, eligibility decisions &mdash; we may need to involve the club, and it may be
          faster to ask your club administrator directly.
        </p>
      </LegalSection>

      <LegalSection heading="What closing an account does and does not do">
        <p>
          Closing an Ovalball account does not necessarily mean that every record connected with that
          person can immediately be removed. Some information may need to be retained for legitimate
          club administration, security, audit, safeguarding, financial or legal reasons.
        </p>
        <p>Practically, that means:</p>
        <LegalList
          items={[
            "your sign-in access ends, and your account can no longer be used",
            "personal account details can be removed or minimised",
            "a club's record that a fixture happened, and its result, remains part of the club's history",
            "records of who held a role and what administrative actions were taken remain in the audit log",
            "eligibility and dispensation decisions remain, because they are the club's evidence that a decision was properly made",
            "where payments were collected, financial records are retained for the period required by law",
          ]}
        />
        <p>
          We will tell you what can be removed and what must be retained, and why, rather than
          quietly doing less than you asked.
        </p>
      </LegalSection>

      <LegalSection heading="Disconnecting a social sign-in">
        <p>
          Where Ovalball supports signing in with Google, Facebook or Apple, you can also remove
          Ovalball&rsquo;s access from the provider&rsquo;s own account settings. Doing that stops
          you signing in that way, but it does not by itself delete your Ovalball account &mdash; use
          the deletion route below for that.
        </p>
        <p className="text-ink/60">
          At the date of this page, social sign-in options are supported by the platform but not yet
          enabled in the live service.
        </p>
      </LegalSection>

      <LegalSection id="facebook-deletion" heading="Facebook Login — data deletion">
        <p>
          If you created or accessed your Ovalball account using Facebook Login and you want your
          Ovalball account and associated personal information deleted, you can request that as
          follows.
        </p>
        <ol className="ml-5 list-decimal space-y-2 text-[15px] leading-relaxed text-ink/80">
          <li>
            Go to the{" "}
            <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
              Ovalball contact page
            </Link>{" "}
            at {PUBLIC_ORIGIN.replace("https://", "")}
            {CONTACT_ROUTE}, or email{" "}
            <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
            .
          </li>
          <li>
            Send a request stating that you want your Ovalball account deleted, and that you signed
            in using Facebook.
          </li>
          <li>
            Include the email address associated with your Ovalball account, so the correct account
            can be identified.
          </li>
          <li>
            We will verify the request, confirm what will be deleted and what must be retained for
            the legal, financial, audit or safeguarding reasons described above, and then action it.
          </li>
          <li>We will confirm to you in writing once the deletion has been completed.</li>
        </ol>
        <p>
          You can also remove Ovalball from your Facebook account under Settings &rarr; Apps and
          Websites. That revokes Facebook access but does not delete your Ovalball account, so please
          also send the request above.
        </p>
        <p className="text-ink/60">
          Ovalball does not currently operate an automated deletion callback endpoint. Requests are
          handled through the support route above.
        </p>
      </LegalSection>

      <LegalSection heading="Related pages">
        <p>
          The full explanation of what is held and why is in the{" "}
          <Link href="/legal/privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Privacy Notice
          </Link>
          , and retention is covered in its data retention section.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
