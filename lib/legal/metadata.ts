/**
 * Single source of truth for legal-document identity.
 *
 * Every public legal page reads its effective date, last-updated date and
 * version from here, so the Legal & Trust area can never drift into
 * page-by-page inconsistent dates.
 */

/** The legal operator of Ovalball. */
export const OPERATOR_NAME = "Pipaxon Technologies Ltd"

/** The product name. Never "Overball". */
export const PRODUCT_NAME = "Ovalball"

/** Canonical public origin, used in copy where an absolute reference reads better. */
export const PUBLIC_ORIGIN = "https://ovalball.co.uk"

/** Effective date of the current published set, in UK long form. */
export const LEGAL_EFFECTIVE_DATE = "5 September 2026"

/** Last substantive update. Equal to the effective date for the first published set. */
export const LEGAL_LAST_UPDATED = "5 September 2026"

/** Version of the published legal set. Bump when substantive wording changes. */
export const LEGAL_VERSION = "1.0"

/**
 * Where a reader is pointed for privacy/legal contact.
 *
 * There is deliberately no hardcoded email address here: no privacy contact
 * address has been verified for the operator, and inventing one on a public
 * legal page would be worse than omitting it. /public-support is a real,
 * login-free route in this application, so it is a genuine contact path.
 */
export const CONTACT_ROUTE = "/public-support"

export interface LegalDocumentLink {
  href: string
  label: string
  /** Short plain-English description used on the Legal & Trust hub. */
  description: string
}

/**
 * The canonical Legal & Trust document set. The homepage footer, the legal
 * hub and the route tests all read this one list, so a new document cannot
 * appear in one place and be missing from another.
 */
export const LEGAL_DOCUMENTS: LegalDocumentLink[] = [
  {
    href: "/legal/privacy",
    label: "Privacy",
    description: "How information is handled when clubs, players and families use Ovalball.",
  },
  {
    href: "/legal/children-privacy",
    label: "Children's Privacy",
    description: "A plain-English privacy guide written for young players.",
  },
  {
    href: "/legal/terms",
    label: "Terms",
    description: "The terms that govern access to and use of Ovalball.",
  },
  {
    href: "/legal/cookies",
    label: "Cookies",
    description: "The cookies and browser storage Ovalball actually uses, and why.",
  },
  {
    href: "/legal/safeguarding",
    label: "Safeguarding",
    description: "How Ovalball supports safeguarding, and where responsibility sits.",
  },
  {
    href: "/legal/acceptable-use",
    label: "Acceptable Use",
    description: "The standards everyone using Ovalball is expected to meet.",
  },
  {
    href: "/legal/data-rights",
    label: "Data Rights",
    description: "Your rights over your information, and how to exercise them.",
  },
  {
    href: "/legal/subprocessors",
    label: "Third-Party Services",
    description: "The service providers Ovalball relies on, and what each one does.",
  },
]

/** The subset shown in the compact homepage footer. */
export const FOOTER_LEGAL_LINKS = LEGAL_DOCUMENTS.filter((d) =>
  ["/legal/privacy", "/legal/children-privacy", "/legal/terms", "/legal/cookies", "/legal/safeguarding", "/legal/data-rights"].includes(d.href)
)
