import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalSection, LegalTable } from "@/components/site/legal-prose"
import { CONTACT_ROUTE, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Ovalball Cookie Policy",
  description:
    "The cookies and browser storage Ovalball actually uses to sign you in, keep your club context and keep the rugby platform secure.",
}

export default function CookiePolicyPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Cookie Policy" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        This policy explains the cookies and similar browser storage Ovalball uses. It lists what is
        actually set by the service rather than a generic list of what a website might use.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="What cookies and browser storage are">
        <p>
          A cookie is a small file a website stores in your browser and reads back on later requests.
          Browsers also provide local and session storage, which work similarly but are read by code
          running in the page rather than sent with every request.
        </p>
      </LegalSection>

      <LegalSection heading="How Ovalball uses them">
        <p>
          Ovalball uses them for three things: to keep you signed in, to remember which club or team
          context you are working in, and to keep a small amount of interface state. All of it is
          necessary for the service to function as you would expect.
        </p>
      </LegalSection>

      <LegalSection heading="What Ovalball sets">
        <LegalTable
          head={["Name", "Type", "Purpose", "Category"]}
          rows={[
            [
              <code key="a">sb-&hellip;-auth-token</code>,
              "Cookie",
              "Keeps you signed in. Set by our authentication provider when you sign in, and removed when you sign out.",
              "Strictly necessary",
            ],
            [
              <code key="b">ovalball_ctx</code>,
              "Cookie",
              "Remembers which club, team or parent context you are currently working in, so the right information loads.",
              "Strictly necessary",
            ],
            [
              <code key="c">ovalball-remember</code>,
              "Cookie",
              'Records whether you chose "keep me signed in on this device" so your session is kept for longer.',
              "Strictly necessary",
            ],
            [
              <code key="d">ovalball-iris-seen</code>,
              "Session storage",
              "Remembers that the homepage introduction animation has already played, so it does not replay on every page view in the same tab.",
              "Functional",
            ],
          ]}
        />
        <p className="mt-3">
          Sign-in also briefly involves values used to protect the sign-in exchange itself against
          interception. These are part of the authentication flow and are not used to track you.
        </p>
      </LegalSection>

      <LegalSection heading="Security check on sign-in and sign-up">
        <p>
          The sign-in and sign-up pages run Cloudflare Turnstile, a check that helps confirm a
          visitor is a person rather than an automated script. It is there to stop automated account
          creation and to stop someone triggering large numbers of sign-in emails to other people&rsquo;s
          addresses.
        </p>
        <p>
          On those two pages your browser loads a script from{" "}
          <code>challenges.cloudflare.com</code> and makes one verification request to Cloudflare.
          We have checked what this actually does on Ovalball rather than describing it generally:
          it sets <strong>no cookie on ovalball.co.uk</strong>, and stores nothing in this
          site&rsquo;s local or session storage. Cloudflare may set its own cookies on its own
          domain as part of running the check.
        </p>
        <p>
          It runs only on the sign-in and sign-up pages, not while you are using Ovalball, and it is
          not used for analytics, advertising or tracking you between sites.
        </p>
      </LegalSection>

      <LegalSection heading="Analytics and advertising">
        <p>
          At the date of this policy, Ovalball does not use advertising cookies or behavioural
          advertising trackers, and does not load any analytics, tracking pixel or marketing script.
          There is no Google Analytics, no Meta pixel and no comparable third-party tracker on the
          site. The only third-party request Ovalball makes is the security check described above,
          and it happens on two pages only.
        </p>
        <p>
          This is a statement of the current implementation, verified against the application source.
          If that changes, this policy will be updated first and appropriate consent controls will be
          added.
        </p>
      </LegalSection>

      <LegalSection heading="Why there is no cookie banner">
        <p>
          Because everything above is strictly necessary \u2014 including the security check, which
          protects the sign-in process itself \u2014 or a minor functional preference, and nothing is
          used for advertising or cross-site tracking, Ovalball does not show an accept/reject
          cookie banner. Presenting a consent choice that has no effect would be
          misleading.
        </p>
        <p>
          If Ovalball later introduces non-essential technologies, they will not load before consent
          is given.
        </p>
      </LegalSection>

      <LegalSection heading="Managing cookies">
        <p>
          You can clear or block cookies through your browser settings. Blocking the strictly
          necessary cookies above will prevent you from signing in or will sign you out, because they
          are how the service knows who you are.
        </p>
        <p>Signing out of Ovalball clears your session cookie.</p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>
          Updates to this policy are reflected in the version and dates above. Questions can be sent
          to {OPERATOR_NAME} via the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            Ovalball support page
          </Link>
          . The wider explanation of how information is handled is in the{" "}
          <Link href="/legal/privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Privacy Notice
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
