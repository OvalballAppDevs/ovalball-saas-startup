"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy-shared"

import { setNewPassword } from "./actions"

/**
 * Set a new password, having arrived from a recovery link.
 *
 * The rule is stated up front rather than only enforced on submit, because being told what is wrong
 * after typing a password you cannot see is a poor way to learn a policy. The server is still the
 * authority: `checkPassword` runs there and additionally checks the password against HaveIBeenPwned,
 * which the browser cannot be trusted to do.
 */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (status === "submitting" || password.length === 0) return
    setStatus("submitting")
    setError(null)
    const result = await setNewPassword(password)
    if (!result.ok) {
      setStatus("error")
      setError(result.message)
      return
    }
    // Where to go is the SERVER's answer, not this component's guess: it depends on whether the
    // account holds a factor (E: a reset ends at AAL2) and on whether revoking the other sessions
    // succeeded, and only the action knows both.
    window.location.assign(result.next)
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rp-password" className="text-ink/80">
          New Password
        </Label>
        <Input
          id="rp-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-sm text-ink/60">
          At least {PASSWORD_MIN_LENGTH} characters, with one capital letter and one special character.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
          {error}
        </div>
      )}

      <Button type="submit" className="h-12 rounded-xl text-[15px]" disabled={password.length === 0 || status === "submitting"}>
        {status === "submitting" ? "Saving…" : "Save New Password"}
      </Button>

      <p className="text-sm text-ink/60">
        Saving this signs you out everywhere else, so anybody using your account loses it.
      </p>
    </form>
  )
}
