import Link from "next/link"

import { RememberMeToggle } from "./remember-me-toggle"

/**
 * The summary on the Account page; the real controls live at /account/security.
 *
 * This file used to say, honestly, that Ovalball had no passwords and that MFA, passkeys and a session
 * list were "planned for a future update". Slice 6 is that update, so the list of promises is gone --
 * a page that still advertises as forthcoming something the product now does is worse than one that
 * never mentioned it.
 *
 * Passkeys are NOT claimed here. They remain genuinely unbuilt, and so does anything resembling a
 * security question: Phase 2 rules those out of the recovery path entirely.
 */
export function SecuritySection({ initialRemember }: { initialRemember: boolean }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Account security</p>
      <p className="mt-2 text-sm text-ink/70">
        Manage your password, your authenticator, your recovery codes and the devices you are signed in
        on.
      </p>
      <Link
        href="/account/security"
        className="mt-3 inline-flex h-9 items-center rounded-lg bg-pitch-600 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-pitch-600/80 focus-visible:ring-3 focus-visible:ring-pitch-400/50"
      >
        Security
      </Link>
      <RememberMeToggle initialRemember={initialRemember} />
    </div>
  )
}
