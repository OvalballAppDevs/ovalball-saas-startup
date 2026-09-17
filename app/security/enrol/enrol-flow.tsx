"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { confirmTotpEnrolment, startTotpEnrolment } from "./actions"

/**
 * Three steps, and the middle one is the only one that can fail in a way the person can fix.
 *
 * The secret and the recovery codes are each shown ONCE. That is not a UX preference: Ovalball keeps a
 * hash of the codes and nothing at all of the secret, so there is genuinely no later screen that could
 * show them again. The copy says so plainly rather than letting somebody assume they can come back.
 */
export function EnrolFlow() {
  const router = useRouter()
  const [step, setStep] = useState<"start" | "scan" | "saved">("start")
  const [factorId, setFactorId] = useState("")
  const [qr, setQr] = useState("")
  const [secret, setSecret] = useState("")
  const [code, setCode] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function begin() {
    setError(null)
    start(async () => {
      const result = await startTotpEnrolment()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFactorId(result.factorId)
      setQr(result.qrCode)
      setSecret(result.secret)
      setStep("scan")
    })
  }

  function confirm() {
    setError(null)
    start(async () => {
      const result = await confirmTotpEnrolment(factorId, code)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCodes(result.recoveryCodes)
      setStep("saved")
    })
  }

  if (step === "start") {
    return (
      <div className="mt-8">
        <Button type="button" className="h-11 px-6" disabled={pending} onClick={begin}>
          {pending ? "Starting…" : "Start Setup"}
        </Button>
        {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
      </div>
    )
  }

  if (step === "scan") {
    return (
      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm text-ink/70">Scan this with your authenticator app.</p>
        {qr && (
          // A plain <img>, not next/image. The QR arrives from the auth server as an SVG DATA URL, and
          // next/image refuses those outright -- which took the whole page down with an unhandled
          // error rather than a broken picture. There is also nothing for an optimiser to do here: the
          // bytes are already in the markup, and they must never be fetched from anywhere else.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="QR code for setting up your authenticator"
            width={200}
            height={200}
            className="mt-4 rounded-lg border border-ink/10 bg-white p-2"
          />
        )}
        <p className="mt-4 text-sm text-ink/70">
          Can&rsquo;t scan it? Enter this key by hand instead. This is the only time it is shown &mdash;
          Ovalball does not keep a copy.
        </p>
        <p className="mt-1 font-mono text-sm break-all text-ink">{secret}</p>

        <div className="mt-5">
          <Label htmlFor="totp-code">Six-Digit Code</Label>
          <Input
            id="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="mt-2 max-w-40 font-mono text-lg tracking-[0.3em]"
          />
        </div>
        <Button type="button" className="mt-4 h-11 px-6" disabled={pending || code.length < 6} onClick={confirm}>
          {pending ? "Checking…" : "Verify & Continue"}
        </Button>
        {error && (
          <p className="mt-3 text-sm text-destructive-text" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="font-display text-xl text-ink">Save your recovery codes</h2>
      <p className="mt-2 text-sm text-ink/70">
        Each code works once, and gets you back in if you lose your phone. Ovalball stores only a
        one-way hash of them, so this is the only time they can be shown. Print them or put them in a
        password manager.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm text-ink">
        {codes.map((c) => (
          <li key={c} className="rounded border border-ink/10 px-2.5 py-1.5">
            {c}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        className="mt-5 h-11 px-6"
        onClick={() => {
          router.push("/dashboard")
          router.refresh()
        }}
      >
        I&rsquo;ve Saved Them
      </Button>
    </div>
  )
}
