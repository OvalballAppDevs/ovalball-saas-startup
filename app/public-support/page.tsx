import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"

import { PublicSupportForm } from "./public-support-form"

/**
 * Reached at the URL /support for a logged-out visitor -- proxy.ts
 * rewrites that request here transparently (the browser's address bar
 * still shows /support) so there is exactly one canonical "Support" link
 * everywhere in the product; which page actually renders depends only on
 * whether a session exists. An authenticated visitor hitting /support
 * still gets the real, existing Support Centre (app/(app)/support), never
 * this one -- this page is never linked to directly.
 */
export default async function PublicSupportPage() {
  const identity = await getPublicHeaderIdentity()

  return (
    <>
      <Header identity={identity} />
      <main className="brand-light-scope bg-chalk pt-32 pb-24 md:pt-40">
        <div className="mx-auto max-w-2xl px-4 md:px-8">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Support</p>
          <h1 className="mt-2 font-display text-display-l text-ink">How can we help?</h1>
          <p className="mt-3 max-w-lg text-base text-ink/60">
            Tell us what&apos;s going on and we&apos;ll get back to you by email. No account needed.
          </p>

          <div className="mt-8">
            <PublicSupportForm />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
