"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  CalendarDays,
  ChevronDown,
  BookOpen,
  Ellipsis,
  LifeBuoy,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Shirt,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { NavSection } from "@/lib/app-context/build-nav-items"
import { cn } from "@/lib/utils"

import type { NavItem } from "./app-nav"

/**
 * The one grouped-navigation renderer, shared by the desktop sidebar and
 * the mobile drawer.
 *
 * Shared deliberately: the brief's requirement is that mobile and desktop
 * present the SAME information architecture and differ only in chrome. Two
 * renderers would drift the moment a section was added to one of them.
 * `size` changes touch targets and type scale, nothing about grouping.
 *
 * Presentation only. Which items exist was decided server-side by
 * buildNavItems from real permissions; expanding a section reveals links
 * the session already had, and every route re-checks authorization itself.
 */
const ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Building2,
  CalendarDays,
  Ellipsis,
  LifeBuoy,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Shirt,
  Users,
}

export function NavSections({
  top,
  sections,
  size = "desktop",
  onNavigate,
}: {
  top: NavItem[]
  sections: NavSection[]
  size?: "desktop" | "mobile"
  /** Mobile passes the Sheet's close so tapping a link dismisses the drawer. */
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  const rowPad = size === "mobile" ? "px-3 py-3" : "px-3 py-2.5"
  const textSize = size === "mobile" ? "text-base" : "text-sm"

  return (
    <div className="flex flex-col gap-1">
      {top.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={isActive(item.href)}
          className={cn(rowPad, textSize)}
          onNavigate={onNavigate}
        />
      ))}

      {sections.map((section) => (
        <Section
          key={section.key}
          section={section}
          isActive={isActive}
          rowPad={rowPad}
          textSize={textSize}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

function Section({
  section,
  isActive,
  rowPad,
  textSize,
  onNavigate,
}: {
  section: NavSection
  isActive: (href: string) => boolean
  rowPad: string
  textSize: string
  onNavigate?: () => void
}) {
  // A section containing the current page starts open, and stays open while
  // you are in it -- the active child must never be hidden behind a
  // collapsed parent. useState's initialiser runs per mount, and the drawer
  // remounts on open, so navigating within a section keeps it open.
  const containsActive = section.items.some((i) => isActive(i.href))
  const [open, setOpen] = useState(containsActive)
  const expanded = open || containsActive

  const panelId = `nav-section-${section.key}`
  const Icon = ICONS[section.icon] ?? Ellipsis

  // A GROUP OF ONE IS NOT A GROUP.
  //
  // The team IA has destinations that are single jobs -- People, Subscriptions, Rugby Hub -- and a
  // collapsible section wrapped around one identically-named child renders as "People › People":
  // a disclosure triangle whose entire content is the thing you already read. It also costs a click
  // for nothing. Where the section is one item and that item says what the section says, the section
  // IS the link.
  const only = section.items.length === 1 ? section.items[0] : null
  if (only && only.label === section.label) {
    return (
      <NavLink
        item={only}
        active={isActive(only.href)}
        className={cn(rowPad, textSize, "font-medium")}
        icon={<Icon aria-hidden="true" className="size-4 shrink-0" />}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
          rowPad,
          textSize,
          containsActive ? "text-pitch-400" : "text-white/70 hover:bg-white/5 hover:text-white"
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 text-left">{section.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 transition-transform", expanded ? "rotate-180" : "")}
        />
      </button>

      {/* Not unmounted when collapsed -- `hidden` keeps the links in the
          accessibility tree's document order and lets find-in-page work. */}
      <div id={panelId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5 pl-4">
        {section.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            className={cn(rowPad, textSize === "text-base" ? "text-[15px]" : "text-sm")}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}

function NavLink({
  item,
  active,
  className,
  onNavigate,
  icon,
}: {
  item: NavItem
  active: boolean
  className?: string
  onNavigate?: () => void
  /** Present when this link stands in for a whole section, so it keeps a section row's weight. */
  icon?: React.ReactNode
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
        className,
        active ? "bg-pitch-600/15 font-medium text-pitch-400" : "text-white/70 hover:bg-white/5 hover:text-white"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!!item.badge && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
          {item.badge > 9 ? "9+" : item.badge}
        </span>
      )}
    </Link>
  )
}
