import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection } from "@/components/site/legal-prose"
import { CONTACT_ROUTE } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Acceptable Use & Community Standards | Ovalball",
  description:
    "The standards everyone using Ovalball is expected to meet, and what happens when they are breached.",
}

export default function AcceptableUsePage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Acceptable Use &amp; Community Standards" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        Ovalball is used by clubs, coaches, players and families to organise rugby. These standards
        set out what is expected of everyone using it. They apply to messages, to the information you
        enter, and to how you use the access your role gives you.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="Ovalball must not be used for">
        <LegalList
          items={[
            "harassment, bullying or intimidation of any kind",
            "threats or abusive behaviour",
            "sexual or otherwise inappropriate messages, particularly any directed at a young player",
            "grooming behaviour, or attempting to build inappropriate contact with a child",
            "impersonating another person, club or role",
            "sharing information about players or families with people who have no authority to receive it",
            "claiming or misusing a guardian link to a player you are not genuinely responsible for",
            "sharing an account or sign-in link with someone else",
            "spam, unsolicited promotion or unrelated commercial messaging",
            "fraud, or misrepresenting payment or membership arrangements",
            "attempting to bypass permissions, access controls or authorisation checks",
            "scraping, bulk-extracting or harvesting private information",
            "uploading malware, or attempting to disrupt or probe the service",
            "anything illegal under the law of England and Wales",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Using your role properly">
        <p>
          Roles in Ovalball carry real authority over other people&rsquo;s information, including
          children&rsquo;s. Use that authority only for the club, team, player or activity it was
          granted for. Curiosity is not authorisation.
        </p>
        <p>
          If you no longer hold a role, say so, so that access can be removed. If you are given
          access you should not have, report it rather than use it.
        </p>
      </LegalSection>

      <LegalSection heading="Messaging">
        <p>
          Messaging exists to organise rugby. Keep it relevant to the fixture, club or team it
          belongs to. Communication involving young players should be appropriate, visible to the
          adults responsible for them, and consistent with your club&rsquo;s safeguarding policy.
        </p>
      </LegalSection>

      <LegalSection heading="Accuracy">
        <p>
          Other people act on what you enter. A wrong kick-off time, venue or eligibility record has
          real consequences for families and for player safety. Do not record a dispensation or
          approval that has not actually been given.
        </p>
      </LegalSection>

      <LegalSection heading="What happens if these standards are breached">
        <p>Depending on what has happened, any of the following may follow:</p>
        <LegalList
          items={[
            "access to part or all of the service may be restricted",
            "content may be removed where appropriate",
            "an account may be suspended or closed",
            "the relevant club may be informed",
            "a safeguarding concern may be escalated to the club's safeguarding lead and, where appropriate, the relevant governing body or statutory services",
            "law enforcement or a regulator may be contacted where appropriate or legally required",
          ]}
        />
        <p>
          A club may also independently remove a person&rsquo;s role at that club, regardless of any
          action we take.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting">
        <p>
          Report misuse to your club administrator or safeguarding lead, through the in-service
          reporting option where available, or via the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball support page
          </Link>
          . Where a child may be at risk, see{" "}
          <Link href="/legal/safeguarding" className="font-medium text-forest-800 underline underline-offset-4">
            Safeguarding &amp; Online Safety
          </Link>
          . If someone is in immediate danger, contact the emergency services on 999.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
