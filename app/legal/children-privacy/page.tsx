import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta } from "@/components/site/legal-prose"
import { CONTACT_ROUTE, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Children & Young People Privacy | Ovalball",
  description:
    "A plain-English guide for young rugby players explaining what Ovalball stores about them, who can see it, and the privacy rights they have.",
}

/**
 * Deliberately set at a larger size with shorter paragraphs than the adult
 * Privacy Notice. Simpler to read, but not written down to the reader.
 */
function Point({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-2xl text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-[17px] leading-relaxed text-ink/85">{children}</div>
    </section>
  )
}

export default function ChildrenPrivacyPage() {
  return (
    <LegalPageLayout eyebrow="A privacy guide for young players" title="Your Privacy on Ovalball" draft={false}>
      <p className="text-[17px] leading-relaxed text-ink/85">
        If you play rugby and your club uses Ovalball, information about you may be stored in
        Ovalball so your rugby activities can be organised safely.
      </p>
      <p className="mt-3 text-[17px] leading-relaxed text-ink/85">
        This page explains what that means, in plain language. There is a longer{" "}
        <Link href="/legal/privacy" className="font-medium text-forest-800 underline underline-offset-4">
          Privacy Notice
        </Link>{" "}
        for adults.
      </p>

      <LegalDocumentMeta />

      <Point heading="What Ovalball is">
        <p>
          Ovalball is software your rugby club uses to organise rugby. It holds things like which
          team you play for, when your fixtures are, and who is coming to them.
        </p>
        <p>It is not a social media app. Nobody uses your information to advertise to you.</p>
      </Point>

      <Point heading="What might be stored about you">
        <ul className="ml-5 list-disc space-y-2">
          <li>your name</li>
          <li>your date of birth, and the rugby age grade that comes from it</li>
          <li>the team or teams you play for</li>
          <li>your fixtures, and training sessions if your club uses them</li>
          <li>whether you said you can play in a fixture</li>
          <li>which parent or guardian you are connected to</li>
          <li>
            requests about you playing for a different team, and permission decisions your club has
            recorded
          </li>
          <li>if your club charges membership through Ovalball, whether your membership is set up</li>
        </ul>
      </Point>

      <Point heading="Why your date of birth is there">
        <p>
          Rugby has age grades, and they matter for safety. Your date of birth is used to work out
          which age grade you are in. That decides which teams you can play for, and it switches on
          the extra protections that apply to young players.
        </p>
      </Point>

      <Point heading="Not everyone using Ovalball can see information about you">
        <p>
          This is important. Ovalball is not one big list that everybody can look at.
        </p>
        <p>
          What someone can see depends on who they are and how they are connected to you &mdash; the
          club they belong to, the team they help run, their role, and whether they are your linked
          parent or guardian.
        </p>
        <p>
          Someone at a different club cannot see your information. Someone who helps run a different
          team is not automatically given access to yours.
        </p>
      </Point>

      <Point heading="Your parent or guardian">
        <p>
          A parent or guardian can be linked to you in Ovalball. If you have your own login, they
          control what your account is allowed to do.
        </p>
        <p>
          Being linked to you does not make them an administrator of the club. It only connects them
          to you.
        </p>
      </Point>

      <Point heading="You have privacy rights too">
        <p>These rights are yours. They do not only belong to your parents.</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>You can ask what information is held about you.</li>
          <li>You can ask for information that is wrong to be corrected.</li>
          <li>You can ask questions about who can see it.</li>
          <li>You can raise a privacy concern, or a concern about something that worries you.</li>
          <li>You can ask a trusted adult to help you do any of this.</li>
        </ul>
        <p>
          You will not get in trouble for asking. Asking about your own information is a normal thing
          to do.
        </p>
      </Point>

      <Point heading="If something worries you">
        <p>
          If someone sends you a message through Ovalball that makes you uncomfortable, or something
          does not feel right, tell a parent, guardian, coach or another trusted adult straight away.
        </p>
        <p>
          If someone is in immediate danger, contact the emergency services on 999. Do not wait for a
          reply from us.
        </p>
      </Point>

      <Point heading="Who to ask">
        <p>
          Your club can answer questions about the information it keeps about you. You can also
          contact {OPERATOR_NAME}, who provide Ovalball, using the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball support page
          </Link>
          .
        </p>
      </Point>
    </LegalPageLayout>
  )
}
