import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalList, LegalSection, LegalSubheading, LegalTable } from "@/components/site/legal-prose"
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_ROUTE, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Ovalball Privacy Notice",
  description:
    "How Ovalball handles information about rugby clubs, teams, players, parents and guardians, and authorised club staff.",
}

export default function PrivacyNoticePage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Privacy Notice" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        This Privacy Notice explains how information is handled when you use Ovalball. Ovalball is a
        technology platform used to help rugby clubs, teams, players, parents, guardians and
        authorised club staff manage rugby activities and club administration.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="1. Who we are">
        <p>
          Ovalball is operated by {OPERATOR_NAME}. Where this notice says &ldquo;we&rdquo; or
          &ldquo;us&rdquo;, it means {OPERATOR_NAME} acting as the provider of the Ovalball service.
        </p>
      </LegalSection>

      <LegalSection heading="2. What Ovalball is">
        <p>
          Ovalball is rugby administration software. Clubs use it to hold their team structure,
          arrange fixtures against other clubs, keep a shared calendar, allocate pitches and venues,
          record player and guardian relationships, manage age-grade progression between seasons,
          handle player movement requests between teams, and communicate about rugby activity.
        </p>
        <p>
          Ovalball is not a social network, and it is not a governing body. It does not sell
          information, and it does not use information about players or families for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="3. Who this notice applies to">
        <p>This notice applies to everyone whose information appears in Ovalball, including:</p>
        <LegalList
          items={[
            "people who hold an Ovalball account, such as club administrators, team administrators, coaches, parents and guardians",
            "players, including young players who may not hold an account of their own",
            "people invited to join a club or team who have not yet accepted",
            "people at other clubs involved in arranging a fixture",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. Information we collect">
        <p>
          The sections below describe the categories of information Ovalball actually holds. Not
          every category applies to every person.
        </p>
      </LegalSection>

      <LegalSection heading="5. Account information">
        <p>
          When an account is created, Ovalball holds an email address, a first name and surname, and
          the account&rsquo;s status. Ovalball does not store your password: authentication is
          handled by our authentication provider.
        </p>
      </LegalSection>

      <LegalSection heading="6. Club and team information">
        <p>
          Ovalball holds information about the club itself &mdash; its name, location, rugby code,
          crest, contacts published by the club, venues and pitches &mdash; and about its teams,
          including team names, age grades, squad designations and whether a team is active or
          folded.
        </p>
        <p>
          Ovalball also holds a directory of rugby clubs used to identify opposition when arranging
          fixtures. That directory is drawn from publicly available club information.
        </p>
      </LegalSection>

      <LegalSection heading="7. Player information">
        <p>Player records may include:</p>
        <LegalList
          items={[
            "first name and surname",
            "date of birth",
            "the resulting rugby age grade",
            "the team or teams the player is a member of, and whether that membership is pending, active or ended",
            "attendance responses to fixtures",
            "player movement requests, such as being called up to another team, and any dispensations recorded against them",
            "where a club uses paid memberships, whether the player is enrolled and who the paying party is",
          ]}
        />
      </LegalSection>

      <LegalSection heading="8. Children and young people's information">
        <p>
          Ovalball is used by rugby clubs that run youth teams, so a substantial amount of the
          information in it relates to children. This is handled deliberately rather than
          incidentally.
        </p>
        <p>
          A young player&rsquo;s date of birth is used to determine the correct rugby age grade,
          which in turn governs which teams they may play for and which protections apply. Young
          players may be linked to one or more guardians. Where a young player has an account of
          their own, what that account can do is constrained by permissions their guardian controls.
        </p>
        <p>
          There is a separate, plain-English privacy page written for young players:{" "}
          <Link href="/legal/children-privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Your Privacy on Ovalball
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="9. Parent and guardian information">
        <p>
          Guardians hold an account with the usual account information, and are linked to specific
          players. That link is a record in its own right: it says which player the guardian is
          connected to, whether the relationship is active, and what the guardian has permitted that
          player&rsquo;s own account to do.
        </p>
      </LegalSection>

      <LegalSection heading="10. Club administrators, team administrators and coaches">
        <p>
          For people holding a role at a club, Ovalball records the club or team the role applies
          to, the role itself, whether it is active, and whether the person&rsquo;s authority has
          been suspended. Actions taken using administrative authority may be recorded in an audit
          log.
        </p>
      </LegalSection>

      <LegalSection heading="11. Fixtures, attendance and rugby activity">
        <p>
          Fixtures hold the teams involved, the date and kick-off time, home or away, venue and
          pitch, status, and the result once played. Attendance holds a player&rsquo;s response to a
          fixture. Pitch allocation records which pitch a fixture is assigned to and the warm-up and
          pack-up time reserved around it.
        </p>
      </LegalSection>

      <LegalSection heading="12. Training">
        <p>
          Ovalball supports training sessions, which hold the team, date, times and an optional
          note. Training is scheduled activity information; it is treated the same way as other
          rugby activity in this notice.
        </p>
      </LegalSection>

      <LegalSection heading="13. Player requests and dispensations">
        <p>
          When a player is requested for another team, Ovalball records the request, the teams
          involved, the eligibility rule applied, and the decision. Dispensations record that a
          club, and where required a governing body, has approved a player playing outside their
          normal age grade. These records exist so that eligibility decisions are traceable.
        </p>
      </LegalSection>

      <LegalSection heading="14. Communications and messaging">
        <p>
          Ovalball holds messages sent through the service, who sent them, when, and which fixture,
          club conversation or team community they belong to. It also holds reports made about
          messages and any moderation outcome. Messaging in Ovalball is scoped: a conversation
          belongs to a fixture, a club or a team, and is visible to the people connected to it.
        </p>
      </LegalSection>

      <LegalSection heading="15. Subscription and payment information">
        <p>
          Where a club has enabled paid memberships, Ovalball holds the club&rsquo;s programme
          settings &mdash; the monthly amount, the collection day, the first-payment policy and any
          sibling discount rules &mdash; along with who the paying party is for each player, the
          amount agreed at the time they enrolled, and the status of payments.
        </p>
        <p>
          Payments are processed by GoCardless. Ovalball stores references to the customer, mandate,
          payment and subscription records held by GoCardless, together with their status. Ovalball
          does not store full bank account details.
        </p>
        <p>
          At the date of this notice, live payment collection is not enabled in the production
          service.
        </p>
      </LegalSection>

      <LegalSection heading="16. Authentication information">
        <p>
          Signing in is handled by our authentication provider. Ovalball receives confirmation that
          you signed in successfully, together with your account identifier and email address. A
          session cookie then keeps you signed in.
        </p>
      </LegalSection>

      <LegalSection id="social-sign-in" heading="17. Signing in with Google, Facebook or Apple">
        <p>
          Ovalball may allow you to create an account or sign in using Google, Facebook or Apple.
        </p>
        <p>
          If you choose one of these options, the provider confirms your identity and may send
          Ovalball limited account information such as a provider account identifier, your name and
          your email address, depending on the provider and the choices you make.
        </p>
        <p>Ovalball uses this information to create, identify and secure your Ovalball account.</p>
        <p>Ovalball does not receive your Google, Facebook or Apple password.</p>
        <p>
          Using a social sign-in option does not give Ovalball access to unrelated information such
          as your contacts, files, photographs, posts or calendars unless a separate Ovalball feature
          expressly asks for that information and you choose to grant that access.
        </p>
        <p>
          Signing in through Google, Facebook or Apple authenticates the account. It does not by
          itself prove a player&rsquo;s age, a guardian relationship, club membership, team
          membership or an administrative role in Ovalball.
        </p>
        <p>
          If you use Sign in with Apple, you may choose Apple&rsquo;s Hide My Email feature. If you
          do, Ovalball may receive an Apple relay email address instead of your usual email address.
        </p>
        <p className="text-ink/60">
          At the date of this notice, these sign-in options are supported by the platform but are not
          yet enabled in the live service.
        </p>
      </LegalSection>

      <LegalSection heading="18. Technical and security information">
        <p>
          Our hosting and database providers process technical information needed to serve the
          site and keep it secure, such as network request information and error logs. Ovalball
          keeps an audit log of significant changes made through the service.
        </p>
      </LegalSection>

      <LegalSection heading="19. How we obtain information">
        <p>Information reaches Ovalball in three ways:</p>
        <LegalList
          items={[
            "you provide it yourself, for example when you create an account or add a child",
            "a club provides it, for example when a club administrator adds a team or records a player",
            "it is generated by using the service, for example an attendance response or an audit entry",
          ]}
        />
        <p>
          The club directory used to identify opposition clubs is compiled from publicly available
          information about rugby clubs.
        </p>
      </LegalSection>

      <LegalSection heading="20. Why we use information">
        <p>
          To provide the Ovalball service: to run accounts, hold club and team structure, arrange
          fixtures, allocate pitches, record attendance, manage age-grade progression and player
          movement, enable scoped communication, support paid memberships where a club has enabled
          them, keep the service secure, and meet legal obligations.
        </p>
      </LegalSection>

      <LegalSection heading="21. Lawful bases">
        <LegalTable
          head={["Activity", "Why we use the information", "Likely lawful basis"]}
          rows={[
            ["Creating and running your account", "So you can access Ovalball and we can identify you", "Contract"],
            ["Club and team administration", "So a club can organise its own teams, fixtures and venues", "Legitimate interests of the club and its members"],
            ["Player records and age grade", "So players are placed in the correct age grade and eligibility rules apply", "Legitimate interests, with safeguarding as a central consideration"],
            ["Guardian relationships and permissions", "So the right adult controls what a young player's account can do", "Legitimate interests, and the protection of children"],
            ["Attendance and rugby activity", "So clubs know who is available and can run fixtures safely", "Legitimate interests"],
            ["Messaging within a club or fixture", "So the people organising rugby can communicate about it", "Legitimate interests"],
            ["Paid memberships where enabled", "So a club can collect agreed membership fees", "Contract, and legitimate interests of the club"],
            ["Security, audit and abuse prevention", "So accounts and club information stay protected and misuse is traceable", "Legitimate interests, and legal obligation where applicable"],
            ["Responding to legal or safeguarding obligations", "So we can act where the law or a serious safeguarding concern requires it", "Legal obligation, and vital interests where someone is at risk"],
          ]}
        />
        <p className="mt-3 text-ink/60">
          The allocation above reflects how the service currently works. The final legal
          determination for each entry is subject to professional review.
        </p>
      </LegalSection>

      <LegalSection heading="22. Legitimate interests">
        <p>
          Where we rely on legitimate interests, the interest is running a functioning rugby club
          administration service: clubs need to know who plays for which team, who is available, and
          who is authorised to act. We weigh that against the privacy of the people involved,
          particularly children, which is why access in Ovalball depends on role and relationship
          rather than being open to every user.
        </p>
      </LegalSection>

      <LegalSection heading="23. Who information may be shared with">
        <p>
          Information is shared with the club or clubs it relates to, with our technology providers,
          and where the law or a serious safeguarding concern requires it. It is not sold, and it is
          not shared for advertising.
        </p>
      </LegalSection>

      <LegalSection id="access-model" heading="24. Rugby clubs and authorised club users">
        <p>
          Information in Ovalball is not intended to be visible to every user. Access depends on
          factors such as the club you belong to, the team you are connected with, your role, and any
          verified player or guardian relationships.
        </p>
        <p>Specifically:</p>
        <LegalList
          items={[
            "a guardian relationship does not automatically make someone a club administrator",
            "a team administrator does not automatically receive authority over unrelated teams",
            "belonging to one club does not give access to another club's players or teams",
          ]}
        />
        <p>
          Authentication and authorisation are separate. Signing in proves who you are; it does not
          decide what you may see or do. That is decided by your roles and relationships, and it is
          enforced by the service itself rather than only hidden in the interface.
        </p>
      </LegalSection>

      <LegalSection heading="25. Technology providers">
        <p>
          Ovalball runs on hosting and database infrastructure provided by third parties. They
          process information on our instructions in order to run the service. They are listed on the{" "}
          <Link href="/legal/subprocessors" className="font-medium text-forest-800 underline underline-offset-4">
            Third-Party Services
          </Link>{" "}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="26. Authentication providers">
        <p>
          Sign-in is handled by our authentication provider. Where social sign-in is enabled, Google,
          Facebook or Apple confirm your identity as described in section 17.
        </p>
      </LegalSection>

      <LegalSection heading="27. Payment providers">
        <p>
          Where a club has enabled paid memberships, GoCardless processes the payment and holds the
          bank details. Ovalball holds references and statuses, not full bank details.
        </p>
      </LegalSection>

      <LegalSection heading="28. Legal and safeguarding disclosures">
        <p>
          We may disclose information where we are legally required to, or where there is a serious
          concern about the safety of a child or another person. Where a safeguarding concern arises
          within a club, the club retains its own safeguarding responsibilities.
        </p>
      </LegalSection>

      <LegalSection heading="29. International transfers">
        <p>
          Our providers may process information outside the United Kingdom. Where that happens, the
          transfer must be covered by an appropriate safeguard recognised under UK data protection
          law. We do not claim that all information remains within the UK, because that would depend
          on provider region configuration that is documented on the Third-Party Services page rather
          than asserted here.
        </p>
      </LegalSection>

      <LegalSection heading="30. Data retention">
        <p>
          We keep personal information only for as long as reasonably necessary for the purpose for
          which it is held, taking account of club administration, account security, safeguarding,
          audit, financial and legal requirements.
        </p>
        <p>
          Some records are deliberately durable. Fixture history, results, audit entries and
          eligibility decisions are kept so that a club&rsquo;s record of what happened remains
          accurate; ending a team membership records an end date rather than erasing the history.
          Defined retention periods for each category are being confirmed and will be published here
          once settled.
        </p>
      </LegalSection>

      <LegalSection heading="31. Security">
        <p>
          Access to information is enforced by the database itself, using rules tied to your roles
          and relationships, so a request for information you are not authorised to see is refused by
          the service rather than merely hidden from the screen. Administrative actions are recorded
          in an audit log. Payment provider credentials and other secrets are held server-side and
          are never sent to the browser.
        </p>
        <p>
          No online service can promise perfect security, and we do not claim to. If you believe an
          account has been compromised, contact us using the details in section 38.
        </p>
      </LegalSection>

      <LegalSection heading="32. Children's privacy rights">
        <p>
          Young people have privacy rights of their own; those rights do not belong solely to their
          parents. A young player can ask what information Ovalball holds about them, ask for wrong
          information to be corrected, ask who can see it, and raise a concern. They can ask a
          trusted adult to help, and a guardian may exercise rights on their behalf where that is
          appropriate.
        </p>
      </LegalSection>

      <LegalSection heading="33. All users' privacy rights">
        <p>
          You have rights of access, correction, erasure, restriction, objection and portability, and
          the right to withdraw consent where we rely on it. These are explained, with how to use
          them, on the{" "}
          <Link href="/legal/data-rights" className="font-medium text-forest-800 underline underline-offset-4">
            Your Data Rights
          </Link>{" "}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="34. Automated decision-making and profiling">
        <p>
          Ovalball does not make decisions about people using automated profiling that produce legal
          or similarly significant effects. Age grade is calculated from date of birth using the
          published rules of the relevant rugby code, and eligibility for a player request is checked
          against those rules; both are rule-based calculations that a person reviews and decides on,
          not automated judgements about an individual.
        </p>
      </LegalSection>

      <LegalSection heading="35. Cookies and similar technologies">
        <p>
          Ovalball uses a small number of cookies and browser storage items, all of which are needed
          to sign you in, keep you signed in, remember which club or team context you are working in,
          and keep the service secure. They are itemised on the{" "}
          <Link href="/legal/cookies" className="font-medium text-forest-800 underline underline-offset-4">
            Cookie Policy
          </Link>{" "}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="36. Complaints">
        <p>
          If you are unhappy with how your information has been handled, please contact us first so
          we can try to put it right. You also have the right to complain to the Information
          Commissioner&rsquo;s Office, the UK supervisory authority for data protection, at ico.org.uk.
        </p>
      </LegalSection>

      <LegalSection heading="37. Changes to this Privacy Notice">
        <p>
          We may update this notice as Ovalball develops. The effective date, last-updated date and
          version at the top of this page always reflect the published version.
        </p>
      </LegalSection>

      <LegalSection heading="38. Contact">
        <p>
          To contact {OPERATOR_NAME} about privacy or data protection, email{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>{" "}
          or use the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball contact page
          </Link>
          , choosing &ldquo;Privacy / data rights&rdquo; as the reason.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
