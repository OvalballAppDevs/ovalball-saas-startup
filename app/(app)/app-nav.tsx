"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import type { ConversationSummary } from "@/lib/app-context/conversations"
import type { NotificationItem } from "@/lib/app-context/notifications"
import type { ActiveContextKind, SwitchableContext } from "@/lib/app-context/active-context"
import { cn } from "@/lib/utils"

import type { NavSection } from "@/lib/app-context/build-nav-items"

import { ContextSwitcher } from "./context-switcher"
import { MessagesPopover } from "./messages-popover"
import { NavSections } from "./nav-sections"
import { NotificationBell } from "./notification-bell"
import { ProfileButton } from "./profile-button"
import { SupportButton } from "./support-button"

export interface NavItem {
  href: string
  label: string
  badge?: number
}

interface AppNavProps {
  primaryItems: NavItem[]
  /** Site Admin only: ungrouped top-level items. Empty elsewhere. */
  top: NavItem[]
  /** Site Admin only: the grouped taxonomy, identical to the mobile drawer's. */
  sections: NavSection[]
  contexts: SwitchableContext[]
  activeKey: string
  identityKind: ActiveContextKind
  clubName: string
  clubLogoUrl: string | null
  roleLabel: string
  personName: string
  personAvatarUrl: string | null
  notifications: NotificationItem[]
  unreadCount: number
  conversations: ConversationSummary[]
  supportUnreadCount: number
}

/**
 * Presentation only -- which items appear is decided server-side in
 * layout.tsx from the session's real permissions (buildNavItems below),
 * never here. This component would render whatever list it's given; it is
 * not itself a security boundary, matching the brief's "navigation should
 * adapt to permissions... it is only presentation" instruction.
 */
export function AppNav({
  primaryItems,
  top,
  sections,
  contexts,
  activeKey,
  identityKind,
  clubName,
  clubLogoUrl,
  roleLabel,
  personName,
  personAvatarUrl,
  notifications,
  unreadCount,
  conversations,
  supportUnreadCount,
}: AppNavProps) {
  const pathname = usePathname()

  return (
    <aside className="flex h-full max-h-screen w-full flex-col bg-forest-950 text-chalk md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <OvalballLogo variant="dark" />
        <div className="flex items-center gap-0.5">
          <MessagesPopover conversations={conversations} variant="dark" />
          <NotificationBell initialItems={notifications} initialUnreadCount={unreadCount} variant="dark" />
          <SupportButton unreadCount={supportUnreadCount} variant="dark" />
          <ProfileButton variant="dark" />
        </div>
      </div>

      <ContextSwitcher
        contexts={contexts}
        activeKey={activeKey}
        identityKind={identityKind}
        clubName={clubName}
        clubLogoUrl={clubLogoUrl}
        roleLabel={roleLabel}
        personName={personName}
        personAvatarUrl={personAvatarUrl}
      />

      {/* min-h-0 + overflow-y-auto: the sidebar is inside a flex column, and
          without min-h-0 a long Site Admin nav pushes past the viewport
          instead of scrolling within it -- the desktop twin of the mobile
          drawer bug. */}
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {sections.length > 0 ? (
          <NavSections top={top} sections={sections} />
        ) : (
          <div className="flex flex-col gap-1">
            {primaryItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                    active
                      ? "bg-pitch-600/15 text-pitch-400"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  )}
                >
                  {item.label}
                  {!!item.badge && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </nav>
    </aside>
  )
}
