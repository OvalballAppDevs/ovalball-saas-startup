"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import type { NotificationItem } from "@/lib/app-context/notifications"
import { cn } from "@/lib/utils"

import { NotificationBell } from "./notification-bell"

export interface NavItem {
  href: string
  label: string
}

interface AppNavProps {
  primaryItems: NavItem[]
  clubName: string
  roleLabel: string
  notifications: NotificationItem[]
  unreadCount: number
}

/**
 * Presentation only -- which items appear is decided server-side in
 * layout.tsx from the session's real permissions (buildNavItems below),
 * never here. This component would render whatever list it's given; it is
 * not itself a security boundary, matching the brief's "navigation should
 * adapt to permissions... it is only presentation" instruction.
 */
export function AppNav({ primaryItems, clubName, roleLabel, notifications, unreadCount }: AppNavProps) {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-full flex-col bg-forest-950 text-chalk md:w-64 md:shrink-0">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <OvalballLogo variant="dark" />
        <NotificationBell initialItems={notifications} initialUnreadCount={unreadCount} variant="dark" />
      </div>

      <div className="border-b border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{clubName}</p>
        <p className="mt-0.5 text-xs text-white/50">{roleLabel}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {primaryItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                active
                  ? "bg-pitch-600/15 text-pitch-400"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        <Link
          href="/account"
          className={cn(
            "block rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
            pathname === "/account" ? "bg-pitch-600/15 text-pitch-400" : "text-white/70 hover:bg-white/5 hover:text-white"
          )}
        >
          My Account
        </Link>
      </div>
    </aside>
  )
}
