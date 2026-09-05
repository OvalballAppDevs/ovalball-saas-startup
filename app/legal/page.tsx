import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { LegalPageLayout } from "@/components/site/legal-page-layout"
import { LegalDocumentMeta } from "@/components/site/legal-prose"
import { LEGAL_DOCUMENTS, OPERATOR_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "Legal & Trust | Ovalball",
  description:
    "How Ovalball is provided, how information about clubs, players and families is handled, and the standards expected of everyone using the rugby platform.",
}

export default function LegalHubPage() {
  return (
    <LegalPageLayout eyebrow="Legal &amp; Trust" title="Legal &amp; Trust" draft={false}>
      <p className="text-[15px] leading-relaxed text-ink/80">
        Ovalball helps rugby clubs organise teams, fixtures, players, families and club operations.
        This Legal &amp; Trust area explains how Ovalball is provided, how information is handled,
        the rules for using the service, and how we work to protect players, families and club
        communities.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/80">
        Ovalball is operated by {OPERATOR_NAME}.
      </p>

      <LegalDocumentMeta />

      <ul className="mt-8 flex flex-col gap-2">
        {LEGAL_DOCUMENTS.map((doc) => (
          <li key={doc.href}>
            <Link
              href={doc.href}
              className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{doc.label}</p>
                <p className="mt-0.5 text-sm text-ink/60">{doc.description}</p>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink/30" />
            </Link>
          </li>
        ))}
      </ul>
    </LegalPageLayout>
  )
}
