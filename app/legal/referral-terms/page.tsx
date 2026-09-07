import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection, LegalSubheading } from "@/components/site/legal-prose"
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  OPERATOR_NAME,
  PRODUCT_NAME,
} from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Referral Terms",
  description:
    "The terms of Ovalball's club referral reward: what earns it, what does not, how it is valued, and when it can be withdrawn.",
}

/**
 * Published as a DRAFT. Every factual statement here describes what the
 * referral engine actually does, and each one is enforced by a database
 * constraint or a test — nothing is aspirational. What is *not* settled is
 * the contractual wrapper around it (jurisdiction-specific consumer/business
 * terms, promotional-scheme obligations), which needs a solicitor. See
 * docs/LEGAL_REVIEW_REQUIRED.md.
 */
export default function ReferralTermsPage() {
  return (
    <LegalPageLayout
      eyebrow="Legal &amp; Trust"
      title="Referral Terms"
      draft
      draftNote={
        <p className="mt-1 text-sm text-forest-800/80">
          The facts on this page are accurate and enforced in the system &mdash; each one is a
          database constraint or a test, not a promise. What has not been reviewed by a solicitor is
          the contractual wrapper around them, and two items marked{" "}
          <span className="font-medium">[NEEDS INPUT]</span> need a business decision.
        </p>
      }
    >
      <p className="text-[15px] leading-relaxed text-ink/80">{" "}
        {PRODUCT_NAME} rewards a club that introduces another rugby club to the platform. This page
        sets out exactly what earns the reward, what does not, and what can take it away. It is
        written narrowly on purpose: a referral scheme that promises more than it pays is worse than
        no scheme.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="The offer">
        <p className="text-[15px] leading-relaxed text-ink/80">
          Refer another rugby club to {PRODUCT_NAME}. If they start a paid subscription and their
          first payment is successfully collected, your club gets one month of its current plan
          free.
        </p>
      </LegalSection>

      <LegalSection heading="What earns the reward">
        <p>
          One thing, and only one: the referred club&rsquo;s <strong>first {PRODUCT_NAME}{" "}
          subscription payment being successfully collected</strong>. Until that happens, nothing is
          earned.
        </p>
        <p>None of the following earns anything:</p>
        <LegalList
          items={[
            "the club opening your invitation, or registering on Ovalball",
            "the club starting a free trial, however long it runs",
            "the club choosing a plan",
            "the club setting up a Direct Debit",
            "a payment being submitted to the bank but not yet collected",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Who can be referred">
        <LegalSubheading>A genuinely new club</LegalSubheading>
        <p>
          The referred club must not already have paid {OPERATOR_NAME} for {PRODUCT_NAME}. A club
          that is already a subscriber cannot be introduced to a service it already buys.
        </p>

        <LegalSubheading>Not your own club</LegalSubheading>
        <p>
          A club cannot refer itself. Where the referring and referred club are the same, the
          referral is rejected automatically.
        </p>

        <LegalSubheading>One reward per club</LegalSubheading>
        <p>
          A referred club can earn a reward for one referring club only. Where more than one club
          claims to have introduced the same club, the first qualifying referral earns the reward
          and the others do not.
        </p>
      </LegalSection>

      <LegalSection heading="What the reward is worth">
        <p>
          One month of the referring club&rsquo;s own plan, at the price that plan cost{" "}
          <strong>at the moment the reward was earned</strong>. That value is recorded then and is
          not recalculated afterwards, so a later change to {PRODUCT_NAME} pricing does not increase
          or reduce a reward already earned.
        </p>
        <p>
          A club that is not on a plan when a referral qualifies does not earn a reward for it.
        </p>
      </LegalSection>

      <LegalSection heading="How the reward is given">
        <p>
          As credit against your club&rsquo;s own {PRODUCT_NAME} subscription. Credit is applied to
          the next collection before it is taken, and a collection covered entirely by credit is
          skipped rather than collected as a zero-value payment.
        </p>
        <p>
          Credit is not cash. It cannot be paid out, transferred to another club, or exchanged for
          money, and it applies only to {PRODUCT_NAME} subscription charges &mdash; never to
          payments your club collects from its own members, which are a separate arrangement between
          your club and its members.
        </p>
        <p className="text-ink/60">
          [NEEDS INPUT] Whether credit expires, and after how long, has not been decided.
        </p>
      </LegalSection>

      <LegalSection heading="When a reward is withdrawn">
        <p>
          If the payment that earned a reward is later reversed &mdash; it fails, is charged back,
          or is refunded &mdash; the reward is withdrawn and the credit is removed from your
          club&rsquo;s account. This is recorded as a separate entry rather than by deleting the
          original, so your club&rsquo;s credit history shows both what was earned and what was
          taken back.
        </p>
        <p>
          A reward already spent against a collection that has been taken is not clawed back from a
          collection that already happened.
        </p>
      </LegalSection>

      <LegalSection heading="Abuse">
        <p>{" "}
          {OPERATOR_NAME} may withhold or withdraw a reward, and may remove a club from the referral
          scheme, where a referral is not genuine. That includes referring clubs that do not exist,
          arrangements set up to claim rewards rather than to introduce a club that wants{" "}{" "}
          {PRODUCT_NAME}, and referrals between clubs under common control.
        </p>
      </LegalSection>

      <LegalSection heading="Changing or ending the scheme">
        <p>{" "}
          {OPERATOR_NAME} may change or withdraw the referral scheme. Any change applies from the
          date it is made and does not affect a reward already earned, or a referral already
          registered and waiting on the referred club&rsquo;s first payment.
        </p>
      </LegalSection>

      <LegalSection heading="Status of this page">
        <p>
          Every factual statement above describes how the referral engine actually behaves, and each
          is enforced in the system rather than only promised here. The contractual wrapper around
          it &mdash; the parts that depend on where a club is and what kind of agreement this is
          &mdash; has not been reviewed by a solicitor, which is why this page is marked as a draft.
        </p>
        <p>
          Questions about a specific referral:{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Related pages">
        <p>
          What a club pays {PRODUCT_NAME}, including trials and Beta, is in the{" "}
          <Link href="/legal/terms" className="font-medium text-forest-800 underline underline-offset-4">
            Terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
