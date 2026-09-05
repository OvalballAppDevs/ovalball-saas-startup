import Link from "next/link"

import { OvalballLogo, OvalballWordmark } from "@/components/brand/ovalball-logo"
import { OvalballMark } from "@/components/brand/ovalball-mark"
import { APP_VERSION } from "@/lib/version"

interface FooterLink {
  label: string
  href: string
  disabled?: boolean
}

interface FooterCluster {
  heading: string
  links: FooterLink[]
}

// Mirrors the header's own "visible-but-disabled, not dead-linked" nav
// pattern (components/site/header.tsx) rather than inventing a second
// convention: a section lights up here the same day it lights up there.
const PRODUCT: FooterCluster = {
  heading: "Product",
  links: [
    { label: "Product", href: "#product" },
    { label: "Fixtures", href: "#fixtures", disabled: true },
    { label: "Teams", href: "#teams", disabled: true },
    { label: "Partner Clubs", href: "#partner-clubs", disabled: true },
  ],
}

const SECONDARY_CLUSTERS: FooterCluster[] = [
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about", disabled: true },
      { label: "Contact", href: "#contact", disabled: true },
      { label: "Support", href: "/support" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
]

const LINK_DISABLED_CLASS = "text-sm text-white/30 select-none"

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-forest-950">
      <div className="relative mx-auto max-w-[1440px] px-4 py-16 md:px-8 md:py-20">
        {/* Brand + tagline: centered, not the old left-aligned block -- the
            whole footer now composes around a single vertical axis. */}
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <OvalballLogo variant="dark" />
          <p className="mt-4 text-base text-white/60">
            Fixtures, teams, and partner clubs &mdash; organised in one place, built for how rugby
            clubs actually run their season.
          </p>
        </div>

        {/* Nav cluster: Product as the primary centered row, Company/Legal
            as a smaller paired duo beneath -- an editorial hierarchy, not a
            stretched 3-column grid. */}
        <div className="mx-auto mt-14 flex max-w-3xl flex-col items-center gap-10">
          <FooterClusterRow cluster={PRODUCT} labelClassName="text-sm" />

          <div className="flex flex-col items-center gap-10 sm:flex-row sm:gap-20">
            {SECONDARY_CLUSTERS.map((cluster) => (
              <FooterClusterRow key={cluster.heading} cluster={cluster} labelClassName="text-sm" />
            ))}
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-3xl border-t border-dashed border-pitch-600/25" />

        {/* Closing brand moment: the one large gesture in this footer --
            everything else here stays quiet so this reads as the deliberate
            close of the page, not one decoration among several. */}
        <div className="relative mt-14 flex flex-col items-center text-center">
          <OvalballMark
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 h-auto w-[640px] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.06]"
          />
          <OvalballWordmark
            variant="dark"
            className="relative text-6xl sm:text-7xl md:text-8xl"
          />
          <p className="relative mt-3 text-sm tracking-[0.08em] text-white/45 uppercase">
            Rugby, connected.
          </p>
        </div>

        <div className="relative mt-14 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 Ovalball. All rights reserved.</p>
          <p>Developed by Jaxippa Technologies</p>
        </div>
        {/* Restrained, quiet -- no build metadata, no Git SHA, just enough
            that a curious visitor can tell they're not on a stale cache.
            Reads from the SAME lib/version.ts as Site Admin's own System
            Health page, never a second constant. */}
        <p className="relative mt-3 text-center text-xs text-white/30 sm:text-left">Ovalball v{APP_VERSION}</p>
      </div>
    </footer>
  )
}

function FooterClusterRow({
  cluster,
  labelClassName,
}: {
  cluster: FooterCluster
  labelClassName: string
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className={`font-medium tracking-[0.08em] text-white/55 uppercase ${labelClassName}`}>
        {cluster.heading}
      </p>
      <nav
        aria-label={cluster.heading}
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2"
      >
        {cluster.links.map((link, i) => (
          <span key={link.label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="size-1 rounded-full bg-white/20" />}
            {link.disabled ? (
              <span aria-disabled="true" className={LINK_DISABLED_CLASS}>
                {link.label}
              </span>
            ) : (
              <Link href={link.href} className="footer-link text-sm text-white/75 outline-none hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-pitch-400">
                {link.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
}
