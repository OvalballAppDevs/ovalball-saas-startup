"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { HUB_GROUPS, HUB_HOME, findActiveDestination, groupNeedsSecondaryRow } from "./hub-nav-groups"

/**
 * Rugby Hub navigation, from one config, in one component.
 *
 * Wide (md and up): a primary row of the five intent groups, plus a
 * secondary row of that group's destinations. The secondary row is
 * suppressed for a one-item group, because the primary tab has already
 * taken the reader to the only thing in it.
 *
 * Narrow (below md): a single disclosure button naming where you are,
 * opening a grouped panel of every destination. Not the desktop row
 * squeezed — the wide layout cannot work in 320px and pretending otherwise
 * is what produced the row that clipped five items.
 *
 * Both layouts read the same HUB_GROUPS, so there is no second list to keep
 * in sync, and active state is resolved from the route rather than from
 * label text.
 */
export function HubNav() {
  const pathname = usePathname()
  const active = findActiveDestination(pathname)
  const activeGroup = active?.group ?? null
  const isOverview = pathname === HUB_HOME.href
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [menuOpen])

  const here = isOverview ? HUB_HOME.label : (active?.item.label ?? "Rugby Hub")

  return (
    <div className="border-b border-ink/8 bg-white/60">
      {/* ---------- Narrow: one disclosure, everything inside ---------- */}
      <div className="md:hidden">
        <div className="mx-auto max-w-3xl px-4">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="flex min-h-12 w-full items-center justify-between gap-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">{activeGroup ? activeGroup.label : "Rugby Hub"}</span>
              <span className="block truncate text-sm font-semibold text-ink">{here}</span>
            </span>
            {menuOpen ? <X aria-hidden="true" className="size-5 shrink-0 text-ink/70" /> : <Menu aria-hidden="true" className="size-5 shrink-0 text-ink/70" />}
          </button>
        </div>

        {menuOpen && (
          <div ref={panelRef} id={menuId} className="border-t border-ink/8 bg-white">
            <nav aria-label="Rugby Hub" className="mx-auto max-w-3xl px-4 py-3">
              <Link
                href={HUB_HOME.href}
                aria-current={isOverview ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                  isOverview ? "bg-ink text-chalk" : "text-ink hover:bg-mint-100/60"
                )}
              >
                {HUB_HOME.label}
              </Link>

              {HUB_GROUPS.map((group) => (
                <div key={group.key} className="mt-4 first:mt-3">
                  <p className="px-3 text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">{group.label}</p>
                  <ul className="mt-1 flex flex-col">
                    {group.items.map((item) => {
                      const isActive = active?.item.href === item.href
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href as never}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => setMenuOpen(false)}
                            className={cn(
                              "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                              isActive ? "bg-ink text-chalk" : "text-ink/80 hover:bg-mint-100/60"
                            )}
                          >
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        )}
      </div>

      {/* ---------- Wide: intent groups, then that group's sections ---------- */}
      <div className="hidden md:block">
        <nav aria-label="Rugby Hub" className="mx-auto max-w-3xl px-4 md:px-8">
          <div className="flex flex-wrap gap-x-1">
            <Link
              href={HUB_HOME.href}
              aria-current={isOverview ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-2 py-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                isOverview ? "border-pitch-600 text-forest-900" : "border-transparent text-ink/70 hover:text-ink"
              )}
            >
              {HUB_HOME.label}
            </Link>
            {HUB_GROUPS.map((group) => {
              const isActive = activeGroup?.key === group.key
              return (
                <Link
                  key={group.key}
                  href={group.items[0].href as never}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "shrink-0 border-b-2 px-2 py-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                    isActive ? "border-pitch-600 text-forest-900" : "border-transparent text-ink/70 hover:text-ink"
                  )}
                >
                  {group.label}
                </Link>
              )
            })}
          </div>
        </nav>

        {activeGroup && groupNeedsSecondaryRow(activeGroup) && (
          <nav aria-label={activeGroup.label} className="border-t border-ink/6 bg-mint-100/30">
            <div className="mx-auto flex max-w-3xl flex-wrap gap-1 px-4 py-2 md:px-8">
              {activeGroup.items.map((item) => {
                const isActive = active?.item.href === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href as never}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                      isActive ? "bg-ink text-chalk" : "text-ink/70 hover:bg-white hover:text-ink"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </nav>
        )}
      </div>
    </div>
  )
}
