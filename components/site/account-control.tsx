"use client"

import Link from "next/link"
import { ChevronDown, LogOut } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/profile/user-avatar"
import { Button } from "@/components/ui/button"
import type { PublicHeaderIdentity } from "@/lib/app-context/public-header-identity"

import { signOut } from "@/app/(app)/account/actions"

/**
 * The public homepage never redirects an authenticated visitor away --
 * this control is how they get back into Ovalball from here. The
 * authenticated PERSON is the identity shown (name first, club as
 * context underneath), never "Logged in as {club}" -- a person, not a
 * club, is the authentication principal, and this also holds up once a
 * user belongs to more than one club.
 */
export function AccountControl({ identity }: { identity: PublicHeaderIdentity }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-10 gap-2 rounded-full border border-white/20 pr-3 pl-1.5 text-sm text-white/90 hover:bg-white/10 hover:text-white"
          />
        }
      >
        <UserAvatar avatarUrl={identity.avatarUrl} name={identity.avatarSeed} size="xs" variant="dark" />
        <span className="hidden max-w-[140px] truncate sm:inline">
          {identity.fullName.split(" ")[0]}
          {identity.clubName ? ` · ${identity.clubName}` : ""}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <UserAvatar avatarUrl={identity.avatarUrl} name={identity.avatarSeed} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{identity.fullName}</p>
            <p className="truncate text-xs text-ink/50">
              {identity.roleLabel}
              {identity.clubName ? ` · ${identity.clubName}` : ""}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link href={identity.destination} />}>Open Ovalball</DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link href="/account" />}>Edit Personal Profile</DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link href="/support" />}>Support</DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            void signOut()
          }}
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
