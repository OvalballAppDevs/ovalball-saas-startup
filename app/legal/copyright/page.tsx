import type { Metadata } from "next"
import Link from "next/link"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta, LegalSection } from "@/components/site/legal-prose"
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  CONTACT_ROUTE,
  OPERATOR_NAME,
  PRODUCT_NAME,
  copyrightLine,
} from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Copyright & Intellectual Property | Ovalball",
  description:
    "Who owns what in Ovalball: the rights Pipaxon Technologies Ltd holds, the rights clubs and users keep, and the third-party marks Ovalball claims no ownership of.",
}

export default function CopyrightPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Copyright &amp; Intellectual Property" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        This page sets out who owns what in {PRODUCT_NAME}. It is deliberately short, and it is
        written as much to say what {OPERATOR_NAME} does <em>not</em> own as what it does.
      </p>
      <LegalDocumentMeta />

      <LegalSection heading="What belongs to us">
        <p>
          Unless otherwise stated, the {PRODUCT_NAME} website, software, design, interface,
          branding, original text and other materials created for {PRODUCT_NAME} are owned by or
          licensed to {OPERATOR_NAME}, and are protected by applicable intellectual property laws.
        </p>
        <p>
          {PRODUCT_NAME} and its associated branding may not be copied, reproduced, distributed or
          used in a way that suggests endorsement, partnership or ownership without appropriate
          permission.
        </p>
      </LegalSection>

      <LegalSection heading="What belongs to clubs and users">
        <p>
          Rugby clubs and users retain ownership of the information, content and materials they
          provide to {PRODUCT_NAME}. Using {PRODUCT_NAME} does not transfer ownership of that
          content to us.
        </p>
        <p>
          What we receive is a permission, not ownership: the licence reasonably necessary to host,
          store, process, display, transmit and back up that content in order to operate the
          service for the club and the people who use it. That permission exists so the service can
          function, and for no wider purpose. How information is handled in practice is set out in
          the{" "}
          <Link href="/legal/privacy" className="font-medium text-forest-800 underline underline-offset-4">
            Privacy Notice
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="What belongs to other people">
        <p>
          Club names, club crests and badges, competition names, governing-body names and marks
          (including those of the RFU and the RFL), and other third-party trade marks, logos or
          materials remain the property of their respective owners.
        </p>
        <p>
          These may appear in {PRODUCT_NAME} because a club has provided them, or because they are
          part of the rugby information a club is organising. Their appearance in the service does
          not transfer any ownership of them to {OPERATOR_NAME}, and nothing on {PRODUCT_NAME}{" "}
          should be interpreted as doing so. We claim no ownership of, and assert no rights over,
          third-party intellectual property shown in the service, and their appearance does not
          imply any affiliation with or endorsement by their owners.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting a rights concern">
        <p>
          If you believe something in {PRODUCT_NAME} infringes your rights, or that your club&rsquo;s
          crest or materials are being used incorrectly, please tell us at{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>{" "}
          or through the{" "}
          <Link href={CONTACT_ROUTE} className="font-medium text-forest-800 underline underline-offset-4">
            contact page
          </Link>
          . Please tell us what the material is, where in {PRODUCT_NAME} it appears, and what your
          rights in it are, so we can look into it properly.
        </p>
      </LegalSection>

      <LegalSection heading="Rights reserved">
        <p>{copyrightLine()}</p>
      </LegalSection>
    </LegalPageLayout>
  )
}
