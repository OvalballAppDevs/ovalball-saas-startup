"use client"

import Link from "next/link"
import { ArrowRight, Menu } from "lucide-react"
import { useEffect, useState } from "react"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useMagnetic } from "@/lib/motion/use-magnetic"
import { Reveal } from "@/lib/motion/reveal"
import { cn } from "@/lib/utils"

// "Product" is the only section that exists in Phase 1's DOM. The other
// three are kept visible -- disabled, not dead-linked -- for the full nav
// composition the brand direction calls for; they light up once their
// sections ship rather than pointing at anchors that don't exist yet.
const NAV_LINKS = [
  { href: "#product", label: "Product", disabled: false },
  { href: "#clubs", label: "Clubs", disabled: true },
  { href: "#fixtures", label: "Fixtures", disabled: true },
  { href: "#about", label: "About", disabled: true },
]

// Live links get the oval hover pill + lift; disabled ones stay exactly as
// inert as before -- no hover motion invites a tap that goes nowhere.
const NAV_LINK_CLASS =
  "nav-pill rounded-sm px-1 py-1 text-sm text-white/80 outline-none transition-colors hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-pitch-400"
const NAV_LINK_DISABLED_CLASS = "rounded-sm px-1 py-1 text-sm text-white/35 select-none"

/**
 * Transparent-over-hero, solid-on-scroll navigation. The transparent/solid
 * switch is a single boolean flip driven by IntersectionObserver watching
 * the hero's own sentinel element -- not a continuous scroll listener -- so
 * this component only re-renders when the threshold is actually crossed.
 *
 * Once solid, the shell also insets itself into a floating rounded bar
 * (`.nav-shell` in globals.css handles the transition) rather than staying
 * pinned flush to the viewport edge -- still `position: fixed`, so this
 * never shifts page content, only the header's own box.
 */
export function Header() {
  const [solid, setSolid] = useState(false)
  const loginRef = useMagnetic<HTMLDivElement>(8)

  useEffect(() => {
    const sentinel = document.querySelector("[data-nav-sentinel]")
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px", threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <header
      className={cn(
        "nav-shell fixed inset-x-0 top-0 z-50 border",
        // Horizontal inset only, no top margin -- the bar stays flush to the
        // viewport's top edge (nothing can peek through above it at any
        // scroll position) while still reading as a floating rounded pill
        // via the side insets, corner radius, and shadow alone.
        solid
          ? "mx-3 mt-0 rounded-b-2xl border-rugby-700/60 bg-forest-950/92 shadow-lg shadow-forest-950/40 backdrop-blur-md md:mx-6"
          : "mx-0 mt-0 rounded-none border-transparent bg-transparent shadow-none"
      )}
    >
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between px-4 md:h-[80px] md:px-8">
        <Reveal as="span" index={0}>
          <Link
            href="/"
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <OvalballLogo variant="dark" />
          </Link>
        </Reveal>

        <nav className="hidden items-center gap-9 md:flex">
          {NAV_LINKS.map((link, i) => (
            <Reveal key={link.href} as="span" index={i + 1}>
              {link.disabled ? (
                <span aria-disabled="true" className={NAV_LINK_DISABLED_CLASS}>
                  {link.label}
                </span>
              ) : (
                <Link href={link.href} className={NAV_LINK_CLASS}>
                  {link.label}
                </Link>
              )}
            </Reveal>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Reveal as="div" index={NAV_LINKS.length + 1}>
            <div ref={loginRef} className="magnetic-target hidden sm:inline-block">
              <Button
                variant="ghost"
                className="login-pill h-9 rounded-full border border-white/20 px-4 text-sm text-white/90 hover:bg-transparent hover:text-white"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                <span>Log in</span>
                <ArrowRight aria-hidden="true" className="login-pill-arrow size-3.5" />
              </Button>
            </div>
          </Reveal>
          <Reveal as="div" index={NAV_LINKS.length + 2}>
            <Button
              className="cta-sweep h-11 rounded-lg px-4 text-sm"
              nativeButton={false}
              render={<Link href="/signup" />}
            >
              <span>Get Started</span>
            </Button>
          </Reveal>

          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/10 hover:text-white md:hidden"
                />
              }
            >
              <Menu className="size-5" />
              <span className="sr-only">Open menu</span>
            </SheetTrigger>
            <SheetContent side="right" className="bg-forest-950 text-chalk">
              <SheetHeader>
                <SheetTitle className="font-display text-lg tracking-wide text-chalk">
                  Menu
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col px-2">
                {NAV_LINKS.map((link) =>
                  link.disabled ? (
                    <span
                      key={link.href}
                      aria-disabled="true"
                      className="rounded-md px-2 py-3 text-base text-white/35 select-none"
                    >
                      {link.label}
                    </span>
                  ) : (
                    <SheetClose
                      key={link.href}
                      nativeButton={false}
                      render={
                        <Link
                          href={link.href}
                          className="tap-press rounded-md px-2 py-3 text-base text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
                        />
                      }
                    >
                      {link.label}
                    </SheetClose>
                  )
                )}
                <SheetClose
                  nativeButton={false}
                  render={
                    <Link
                      href="/login"
                      className="tap-press rounded-md px-2 py-3 text-base text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
                    />
                  }
                >
                  Log in
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
