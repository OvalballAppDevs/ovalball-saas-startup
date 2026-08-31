"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"

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
import type { NotificationItem } from "@/lib/app-context/notifications"
import { cn } from "@/lib/utils"

import type { NavItem } from "./app-nav"
import { NotificationBell } from "./notification-bell"

interface AppMobileNavProps {
  primaryItems: NavItem[]
  clubName: string
  roleLabel: string
  notifications: NotificationItem[]
  unreadCount: number
}

/**
 * Mobile-only top bar + slide-out menu -- the brief's "do NOT shrink
 * desktop tables, create responsive mobile-specific presentations"
 * applied to navigation itself: this is a different layout, not the
 * sidebar squeezed into a smaller box.
 */
export function AppMobileNav({ primaryItems, clubName, roleLabel, notifications, unreadCount }: AppMobileNavProps) {
  const pathname = usePathname()

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between border-b border-forest-950/10 bg-forest-950 px-4 py-3 md:hidden">
      <OvalballLogo variant="dark" />
      <div className="flex items-center gap-1">
        <NotificationBell initialItems={notifications} initialUnreadCount={unreadCount} variant="dark" />
        <Sheet>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" />}
        >
          <Menu className="size-5" />
          <span className="sr-only">Open menu</span>
        </SheetTrigger>
        <SheetContent side="right" className="bg-forest-950 text-chalk">
          <SheetHeader>
            <SheetTitle className="font-display text-lg tracking-wide text-chalk">{clubName}</SheetTitle>
          </SheetHeader>
          <p className="px-4 -mt-2 text-xs text-white/50">{roleLabel}</p>
          <nav className="flex flex-col gap-1 px-2 pt-2">
            {primaryItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <SheetClose
                  key={item.href}
                  nativeButton={false}
                  render={
                    <Link
                      href={item.href}
                      className={cn(
                        "rounded-md px-3 py-3 text-base outline-none transition-colors focus-visible:bg-white/10 focus-visible:text-white",
                        active ? "bg-pitch-600/15 text-pitch-400" : "text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    />
                  }
                >
                  {item.label}
                </SheetClose>
              )
            })}
            <SheetClose
              nativeButton={false}
              render={
                <Link
                  href="/account"
                  className="rounded-md px-3 py-3 text-base text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
                />
              }
            >
              My Account
            </SheetClose>
          </nav>
        </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
