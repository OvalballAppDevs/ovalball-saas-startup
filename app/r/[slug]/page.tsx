import type { Metadata } from "next"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { buttonVariants } from "@/components/ui/button"
import { loadPublicClub } from "@/lib/club-public/club"
import { createClient } from "@/lib/supabase/server"
import { referralSlugFrom } from "@ovalball/contracts/clubhouse/referral-link"

export const metadata: Metadata = { title: "Recommended to Ovalball" }

/**
 * A CLUB'S REFERRAL LINK -- `/r/<slug>` (One Referral Link per Club, the owner's decision of 2026-10-05).
 *
 * One question and one answer, like the invitation entrance (`/join`): which club recommended Ovalball, and
 * the way in. The page remembers nothing -- no cookie, no storage -- it only carries the slug onward in the
 * address: to signup (`/signup?ref=`), where it travels with the answers on the server, or, for somebody
 * already signed in, to the Clubhouse claim (`/clubhouse?ref=`). The server decides, when the club that used
 * it is approved, whether the recommending club is credited; nothing here grants anything.
 */
export default async function ReferralLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params
  const slug = referralSlugFrom(raw)
  const club = slug ? await loadPublicClub(slug) : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ref = club && slug ? `?ref=${encodeURIComponent(slug)}` : ""
  const claimPath = `/clubhouse${ref}`

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-5.5rem)] max-w-lg flex-col justify-center px-4 py-12">
        {club ? (
          <>
            {club.crestUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a club's own uploaded crest, any host
              <img src={club.crestUrl} alt={`${club.name} crest`} className="size-16 rounded-xl border border-ink/8 bg-white object-contain p-1.5" />
            ) : null}
            <h1 className="mt-5 font-display text-display-l text-ink">{club.name} recommends Ovalball</h1>
            <p className="mt-3 text-base text-ink/60">
              Ovalball runs a rugby club&apos;s teams, fixtures, training and people in one place. Bring your club on
              board, and {club.name} is thanked for the introduction.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">This link isn&apos;t active</h1>
            <p className="mt-3 text-base text-ink/60">
              The club that shared it may have changed its address. You can still bring your club to Ovalball.
            </p>
          </>
        )}

        {/* The entrance's own action shape (/join): a full-width 48px button on a phone, its own width above. */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {user ? (
            <Link href={claimPath} className={buttonVariants({ className: "h-12 w-full px-6 sm:w-auto" })}>
              Find Your Club
            </Link>
          ) : (
            <>
              <Link href={`/signup${ref}`} className={buttonVariants({ className: "h-12 w-full px-6 sm:w-auto" })}>
                Get Started
              </Link>
              <Link href={`/login?next=${encodeURIComponent(claimPath)}`} className={buttonVariants({ variant: "outline", className: "h-12 w-full px-6 sm:w-auto" })}>
                Sign In
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
