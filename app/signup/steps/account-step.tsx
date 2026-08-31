"use client"

import { useState } from "react"

import { FormField } from "../form-field"

interface AccountStepProps {
  email: string
  onChange: (email: string) => void
}

const EMAIL_PATTERN = /\S+@\S+\.\S+/

export function AccountStep({ email, onChange }: AccountStepProps) {
  const [touched, setTouched] = useState(false)
  const showError = touched && email.length > 0 && !EMAIL_PATTERN.test(email)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Step 1
        </p>
        <h1 className="mt-2 font-display text-display-l text-ink">
          Create your account
        </h1>
        <p className="mt-3 max-w-sm text-base text-ink/60">
          Start with your email. We&apos;ll confirm it once you&apos;re ready
          to join Ovalball &mdash; no need to sign in first.
        </p>
      </div>

      <div>
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError}
          className={showError ? "border-destructive focus-visible:border-destructive" : undefined}
          placeholder="you@example.com"
        />
        {showError && (
          <p className="mt-1.5 text-sm text-destructive">
            Enter a valid email address, like you@example.com.
          </p>
        )}
      </div>

      <p className="text-sm text-ink/45">
        Used only to confirm your account and keep you signed in.
      </p>
    </div>
  )
}
