import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"

interface LegalPageLayoutProps {
  eyebrow: string
  title: string
  draft?: boolean
  children: React.ReactNode
}

/**
 * Shared shell for /terms, /privacy, /cookies -- same header/back-link/prose
 * width across all three rather than three near-duplicate page bodies.
 * `draft` renders the "pending legal review" notice; only set it to false
 * once real, reviewed copy replaces the placeholder content on a given page.
 */
export function LegalPageLayout({ eyebrow, title, draft = true, children }: LegalPageLayoutProps) {
  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/" className="w-fit">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-24">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-display text-display-l text-ink">{title}</h1>

        {draft && (
          <div className="mt-6 rounded-lg border border-pitch-600/30 bg-mint-100/50 px-4 py-3.5">
            <p className="text-sm font-medium text-forest-900">Draft &mdash; pending legal review</p>
            <p className="mt-1 text-sm text-forest-800/80">
              This page is placeholder content, not reviewed legal copy. Provisions marked{" "}
              <span className="font-medium">[NEEDS INPUT]</span> require a real business/legal
              decision before this page can go live.
            </p>
          </div>
        )}

        <div className="mt-8 space-y-6 text-base text-ink/70">{children}</div>
      </div>
    </main>
  )
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg text-ink">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  )
}
