import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { OvalballMark } from "@/components/brand/ovalball-mark"
import { cn } from "@/lib/utils"

/**
 * The shell both authentication journeys sit in.
 *
 * Sign In and Get Started are different journeys with different content, but
 * they are the same product and the same moment, so they share one
 * composition rather than being two pages that happen to look similar.
 *
 * Desktop: a deep forest brand panel on the left carrying the wordmark, a
 * single sentence, and a restrained pitch-geometry motif; the form on a warm
 * chalk field to the right. The brand panel is decoration and orientation
 * only -- nothing in it is needed to authenticate, so below `lg` it is
 * dropped entirely rather than stacked, and the phone opens directly on the
 * heading and the provider buttons. That is the fix for the rejected
 * layout's biggest failing: on a phone you should reach a sign-in control
 * without scrolling past anything.
 *
 * The motif is drawn (halfway line, 22s, in-goal) rather than photographed:
 * a photograph behind a form is the cliché this brief rules out, and pitch
 * geometry carries the rugby identity at a fraction of the weight.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  panelLine,
  children,
  footer,
}: {
  eyebrow: string
  title: string
  subtitle: string
  /** One sentence on the brand panel. Kept short by design. */
  panelLine: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main className="brand-light-scope grid min-h-screen grid-cols-1 bg-chalk lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Brand panel -- desktop only. */}
      <aside className="relative hidden overflow-hidden bg-forest-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <PitchGeometry />

        <Link href="/" className="relative w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
          <OvalballLogo variant="dark" />
        </Link>

        <div className="relative max-w-sm">
          <OvalballMark aria-hidden="true" className="h-auto w-12 text-pitch-400" />
          <p className="mt-6 font-display text-display-l text-white text-balance">{panelLine}</p>
          <p className="mt-4 text-sm text-white/55">
            Fixtures, teams, availability and club administration in one connected place.
          </p>
        </div>

        <p className="relative text-xs tracking-[0.08em] text-white/35 uppercase">
          Rugby, connected.
        </p>
      </aside>

      {/* Auth column. */}
      <div className="flex flex-col">
        {/* Mobile header: the wordmark, small, so the phone still opens on
            Ovalball without spending a screenful on it. */}
        <div className="border-b border-ink/8 px-5 py-4 lg:hidden">
          <Link href="/" className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
            <OvalballLogo variant="light" />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:py-16">
          <div className="w-full max-w-[26rem]">
            <p className="text-xs font-medium tracking-[0.1em] text-forest-800 uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-2 font-display text-display-l text-ink">{title}</h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink/60">{subtitle}</p>

            <div className="mt-7">{children}</div>

            {footer && <div className="mt-7 border-t border-ink/10 pt-5">{footer}</div>}
          </div>
        </div>
      </div>
    </main>
  )
}

/**
 * Pitch markings, very low contrast. Deliberately geometry rather than
 * imagery -- it reads as rugby without competing with the form beside it.
 */
function PitchGeometry() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full text-pitch-400/[0.09]"
    >
      <g stroke="currentColor" strokeWidth="1.5" fill="none">
        {/* Touchlines */}
        <rect x="28" y="-40" width="344" height="680" />
        {/* Halfway */}
        <line x1="28" y1="300" x2="372" y2="300" strokeWidth="2" />
        {/* 22s */}
        <line x1="28" y1="140" x2="372" y2="140" />
        <line x1="28" y1="460" x2="372" y2="460" />
        {/* 5m dashed lines */}
        <line x1="70" y1="-40" x2="70" y2="640" strokeDasharray="10 16" />
        <line x1="330" y1="-40" x2="330" y2="640" strokeDasharray="10 16" />
        {/* In-goal */}
        <line x1="28" y1="30" x2="372" y2="30" />
        <line x1="28" y1="570" x2="372" y2="570" />
      </g>
    </svg>
  )
}

/** Small helper so both journeys cross-link identically. */
export function AuthSwitchLink({
  prompt,
  href,
  label,
  className,
}: {
  prompt: string
  href: string
  label: string
  className?: string
}) {
  return (
    <p className={cn("text-center text-sm text-ink/60", className)}>
      {prompt}{" "}
      <Link
        href={href}
        className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
      >
        {label}
      </Link>
    </p>
  )
}
