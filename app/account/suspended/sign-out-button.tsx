"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { signOutFromSuspended } from "./actions"

export function SuspendedSignOutButton() {
  const [pending, setPending] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-11"
      disabled={pending}
      onClick={() => {
        setPending(true)
        void signOutFromSuspended()
      }}
    >
      {pending ? "Signing out…" : "Sign Out"}
    </Button>
  )
}
