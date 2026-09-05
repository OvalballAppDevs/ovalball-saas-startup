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
 * The verified public contact address for Ovalball.
 *
 * This is the one place the address is written down. It resolves the
 * previous "no verified contact address" gap on the legal pages, which
 * until now could only point a reader at a route rather than name a real
 * mailbox. Displayed openly rather than obfuscated: an address a screen
 * reader or a person on a phone cannot use is not a contact route.
 */
export const CONTACT_EMAIL = "hello@ovalball.co.uk"

/** `mailto:` form of {@link CONTACT_EMAIL}, so no page hand-builds the href. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`

/** Canonical public route for "About Us". One route, never an alias set. */
export const ABOUT_ROUTE = "/about"

/**
 * Canonical public route for "Contact Us".
 *
 * /contact is a real, login-free page that names {@link CONTACT_EMAIL} and
 * submits into the SAME support-ticket system as /support -- it is not a
 * second contact system, and the recipient is never client-controlled.
 */
export const CONTACT_ROUTE = "/contact"

/**
 * The copyright line, rendered wherever rights are asserted.
 *
 * Takes the year as an argument rather than reading the clock itself so a
 * server-rendered page and a test can agree on the same value.
 */
export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${OPERATOR_NAME}. All rights reserved.`
}

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
  {
    href: "/legal/copyright",
    label: "Copyright",
    description: "Who owns what in Ovalball, and the rights clubs and users keep.",
  },
]

/** The subset shown in the compact homepage footer. */
export const FOOTER_LEGAL_LINKS = LEGAL_DOCUMENTS.filter((d) =>
  ["/legal/privacy", "/legal/children-privacy", "/legal/terms", "/legal/cookies", "/legal/safeguarding", "/legal/data-rights"].includes(d.href)
)

/**
 * The non-legal half of the footer's bottom band. Kept beside
 * FOOTER_LEGAL_LINKS so the two groups can never drift apart structurally,
 * and so a route rename is a one-line change here rather than a hunt
 * through the footer markup.
 */
export const FOOTER_OVALBALL_LINKS: { href: string; label: string }[] = [
  { href: ABOUT_ROUTE, label: "About" },
  { href: CONTACT_ROUTE, label: "Contact" },
]
