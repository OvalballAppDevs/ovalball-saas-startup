"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"

import { deleteBrandImage, restoreBundledLogo, selectBrandImage, uploadBrandImage } from "./brand-actions"

export interface BrandImage {
  path: string
  name: string
  updatedAt: string | null
  bytes: number | null
  previewUrl: string
}

/**
 * The image library for email branding.
 *
 * Upload, then choose. There is deliberately no address bar here: every image
 * is one Ovalball holds, and what recipients receive is a URL on Ovalball's
 * own origin that names no file at all. That is what stops a correctly
 * branded, correctly authenticated Ovalball email from ever being pointed at
 * somebody else's server.
 */
export function BrandPanel({
  canEdit,
  images,
  activePath,
  lockVersion,
  logoUrl,
}: {
  canEdit: boolean
  images: BrandImage[]
  activePath: string | null
  lockVersion: number
  /** The live email logo endpoint, so this panel shows exactly what is sent. */
  logoUrl: string
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Changing the logo changes what the endpoint serves, but the URL stays the
  // same by design -- so the browser would keep showing the old image. This
  // cache-buster is for THIS screen only; it never reaches an email.
  //
  // It starts as null rather than Date.now(). Seeding it with a clock reads
  // naturally and is wrong: the initialiser runs once on the server and again
  // in the browser, producing two different query strings for the same tag,
  // which is a hydration mismatch React cannot patch up. There is nothing to
  // bust on first paint anyway -- the cache only needs breaking once this
  // screen has actually changed the image.
  const [stamp, setStamp] = useState<number | null>(null)

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(success)
      setStamp(Date.now())
      router.refresh()
    })
  }

  function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    const form = new FormData()
    form.set("file", files[0])
    run(() => uploadBrandImage(form), "Image uploaded. Select it to put it on every email.")
    if (fileInput.current) fileInput.current.value = ""
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg text-ink">Email Branding</h2>
      <p className="mt-1 max-w-xl text-sm text-ink-muted">
        The logo at the top of every Ovalball email. Upload an image and choose it here &mdash; emails always load it
        from Ovalball, so the wording of an email can never point it somewhere else.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-white px-4 py-3 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-lg border border-forest-800/25 bg-mint-100/50 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      <div className="mt-4 rounded-lg border border-ink/10 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img
            src={stamp === null ? logoUrl : `${logoUrl}?v=${stamp}`}
            alt="The logo currently used on Ovalball emails"
            width={72}
            height={72}
            className="h-[72px] w-[72px] shrink-0 rounded-xl border border-ink/10"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {activePath ? "A custom image is on every email." : "Ovalball's own logo is on every email."}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              This is exactly what recipients see. Images blocked in a mail app fall back to the word Ovalball.
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ink/8 pt-5">
            <input
              ref={fileInput}
              id="brand-upload"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Button type="button" className="h-11" disabled={pending} onClick={() => fileInput.current?.click()}>
              {pending ? "Working…" : "Upload an image"}
            </Button>
            {activePath && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => restoreBundledLogo(lockVersion), "Ovalball's own logo is back on every email.")}
                className="min-h-11 text-sm text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Restore Ovalball&apos;s logo
              </button>
            )}
            <p className="w-full text-xs text-ink/55">
              PNG, JPEG or WebP, up to 1 MB. A square image works best. Other formats do not render reliably in email.
            </p>
          </div>
        )}
      </div>

      {images.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-medium text-ink">Your images</h3>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((image) => {
              const isActive = image.path === activePath
              return (
                <li key={image.path} className="rounded-lg border border-ink/10 bg-white p-3">
                  <img
                    src={image.previewUrl}
                    alt=""
                    className="mx-auto block size-16 rounded-lg border border-ink/8 object-contain"
                  />
                  {isActive ? (
                    <p className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-forest-800">
                      <Check className="size-3.5" aria-hidden="true" />
                      On every email
                    </p>
                  ) : (
                    canEdit && (
                      <div className="mt-2 flex flex-col items-center gap-1">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => selectBrandImage(image.path, lockVersion),
                              "That image is now on every Ovalball email."
                            )
                          }
                          className="min-h-11 text-xs text-forest-800 underline underline-offset-2 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Use this image
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => deleteBrandImage(image.path), "Image removed from your library.")}
                          className="min-h-11 text-xs text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Remove
                        </button>
                      </div>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
