"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { signOut } from "./actions"

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 sm:h-10"
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true)
        void signOut()
      }}
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </Button>
  )
}
