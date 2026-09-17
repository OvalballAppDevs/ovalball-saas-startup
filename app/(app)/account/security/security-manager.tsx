"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

import { regenerateRecoveryCodes, removeTotpFactor, signOutOtherDevices } from "./actions"
import { MAX_TOTP_FACTORS } from "./constants"
import { cancelRecovery } from "./recovery-actions"

type Factor = { id: string; name: string; createdAt: string }
type Session = { id: string; createdAt: string; refreshedAt: string | null; userAgent: string | null; isCurrent: boolean }
type Recovery = { id: string; kind: string; state: string; executeAfter: string | null; reason: string }

const KIND_LABEL: Record<string, string> = {
  MFA_RESET: "a reset of your authenticator",
  MINOR_MFA_RESET: "a reset of your authenticator",
  EMAIL_CHANGE: "a change to your email address",
}

/** A short, human summary of a browser. Never the raw string: it is long and says nothing useful. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device"
  const os = /iPhone|iPad/.test(userAgent) ? "iPhone or iPad"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "Mac"
    : /Windows/.test(userAgent) ? "Windows"
    : "Unknown device"
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : "browser"
  return `${os} · ${browser}`
}

export function SecurityManager({
  factors, sessions, recoveryCodesLeft, atAal2, enforcementGroup, openRecoveries,
}: {
  factors: Factor[]
  sessions: Session[]
  recoveryCodesLeft: number
  atAal2: boolean
  enforcementGroup: string
  openRecoveries: Recovery[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const [pending, start] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const result = await fn()
      if (!result.ok) setError(result.error ?? "That didn't work.")
    })
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      {/* A recovery somebody has started. First, because stopping it is urgent. */}
      {openRecoveries.map((r) => (
        <section key={r.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <h2 className="font-display text-xl text-ink">Someone asked for {KIND_LABEL[r.kind] ?? "a security change"}</h2>
          <p className="mt-2 text-sm text-ink/70">
            Reason given: &ldquo;{r.reason}&rdquo;.{" "}
            {r.executeAfter
              ? `It will go ahead after ${new Date(r.executeAfter).toLocaleString("en-GB")} unless you stop it.`
              : "It is waiting for a second administrator to approve it."}
          </p>
          <p className="mt-2 text-sm text-ink/70">If this wasn&rsquo;t you, cancel it now.</p>
          <Button
            type="button"
            variant="destructive"
            className="mt-4 h-10"
            disabled={pending}
            onClick={() => run(() => cancelRecovery(r.id))}
          >
            Cancel This Request
          </Button>
        </section>
      ))}

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="font-display text-xl text-ink">Authenticator</h2>
        {factors.length === 0 ? (
          <>
            <p className="mt-2 text-sm text-ink/70">
              You haven&rsquo;t set one up. An authenticator app means a stolen password is not enough to
              reach your club&rsquo;s information.
              {enforcementGroup === "PRIVILEGED" &&
                " Your role will need one before long, so it is worth doing now."}
            </p>
            <Button type="button" className="mt-4 h-10" onClick={() => window.location.assign("/security/enrol")}>
              Set Up An Authenticator
            </Button>
          </>
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-2">
              {factors.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-lg border border-ink/10 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 text-sm text-ink/80">
                    {f.name} &middot; added{" "}
                    {new Date(f.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8"
                    disabled={pending || factors.length <= 1}
                    title={factors.length <= 1 ? "Add another authenticator before removing this one" : undefined}
                    onClick={() => run(() => removeTotpFactor(f.id))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {factors.length < MAX_TOTP_FACTORS && (
              <Button type="button" variant="outline" className="mt-3 h-10" onClick={() => window.location.assign("/security/enrol")}>
                Add A Backup Authenticator
              </Button>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="font-display text-xl text-ink">Recovery codes</h2>
        <p className="mt-2 text-sm text-ink/70">
          {recoveryCodesLeft > 0
            ? `${recoveryCodesLeft} unused ${recoveryCodesLeft === 1 ? "code" : "codes"} left. Each one works once.`
            : "You have no unused recovery codes. Without one, losing your phone means asking Ovalball for help."}
        </p>
        {newCodes && (
          <div className="mt-4 rounded-lg bg-mint-100 px-4 py-4">
            <p className="text-sm font-medium text-forest-950">Save these now. They replace your old codes.</p>
            <ul className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm text-forest-950">
              {newCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          className="mt-4 h-10"
          disabled={pending || factors.length === 0}
          onClick={() =>
            start(async () => {
              setError(null)
              const result = await regenerateRecoveryCodes()
              if (result.ok) setNewCodes(result.codes)
              else setError(result.error)
            })
          }
        >
          {recoveryCodesLeft > 0 ? "Replace My Codes" : "Create Recovery Codes"}
        </Button>
        {!atAal2 && factors.length > 0 && (
          <p className="mt-2 text-sm text-ink/60">You&rsquo;ll be asked for a code from your authenticator first.</p>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="font-display text-xl text-ink">Where you&rsquo;re signed in</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-lg border border-ink/10 px-3.5 py-2.5 text-sm">
              <span className="text-ink/80">{deviceLabel(s.userAgent)}</span>
              {s.isCurrent && <span className="ml-2 rounded-full bg-mint-100 px-2 py-0.5 text-xs text-forest-800">This device</span>}
              <span className="mt-0.5 block text-xs text-ink-muted">
                Signed in {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
              </span>
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <Button type="button" variant="outline" className="mt-3 h-10" disabled={pending} onClick={() => run(signOutOtherDevices)}>
            Sign Out Other Devices
          </Button>
        )}
      </section>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
