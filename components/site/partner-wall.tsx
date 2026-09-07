import Image from "next/image"

import { Reveal } from "@/lib/motion/reveal"
import { getActivePartnerClubs } from "@/lib/marketing/partner-clubs"

/**
 * The public partner-club wall.
 *
 * Built to scale from one club to dozens without changing shape: an
 * auto-fitting grid gives every logo the same cell, and each logo is
 * height-capped and `object-contain`, so a wide wordmark and a round crest
 * carry equal visual weight and nothing is ever stretched.
 *
 * With no verified partners it renders an honest future state instead of
 * placeholder crests. Showing invented or directory-scraped logos here
 * would be a false claim of endorsement, so the empty state is the
 * correct output, not a gap to fill.
 */
export function PartnerWall() {
  const partners = getActivePartnerClubs()

  return (
    <section className="bg-chalk py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-4 md:px-8">
        <Reveal className="text-center">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
            Partnerships
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-display-l text-ink text-balance">
            Ovalball is proudly partnered with:
          </h2>
        </Reveal>

        {partners.length > 0 ? (
          <Reveal index={1}>
            <ul className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-center gap-x-10 gap-y-12">
              {partners.map((club) => {
                const logo = (
                  <Image
                    src={club.logo}
                    alt={`${club.name} club crest`}
                    width={club.logoWidth}
                    height={club.logoHeight}
                    className="h-14 w-auto max-w-[160px] object-contain md:h-16"
                  />
                )
                return (
                  <li key={club.id} className="flex flex-col items-center gap-3 text-center">
                    {club.website ? (
                      <a
                        href={club.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg p-2 transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                      >
                        {logo}
                      </a>
                    ) : (
                      <span className="p-2">{logo}</span>
                    )}
                    <span className="text-sm font-medium text-ink/70">{club.name}</span>
                    {club.description && (
                      <span className="text-xs text-ink-muted">{club.description}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </Reveal>
        ) : (
          <Reveal index={1}>
            <div className="mx-auto mt-12 max-w-xl rounded-xl border border-dashed border-ink/15 bg-white px-6 py-12 text-center">
              <p className="font-display text-2xl text-ink">
                More club partnerships will be announced here.
              </p>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink/60">
                We would rather leave this space empty than fill it with logos that do not
                represent a real agreement. Partner clubs will appear here as they join.
              </p>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  )
}
