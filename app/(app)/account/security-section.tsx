import { RememberMeToggle } from "./remember-me-toggle"

/**
 * Deliberately static and honest -- no security-question persistence, no
 * MFA/passkeys, per the brief's explicit warning that weak recovery
 * questions must never be wired into an active auth/recovery path without
 * a dedicated security review. This section states what's true today
 * (email magic-link sign-in) and what's planned, never what's implemented.
 * The "Keep me signed in" toggle is the one real, working control here.
 */
export function SecuritySection({ initialRemember }: { initialRemember: boolean }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Account security</p>
      <p className="mt-2 text-sm text-ink/70">
        You currently sign in with a one-time link sent to your email address -- there is no password to manage.
      </p>
      <RememberMeToggle initialRemember={initialRemember} />
      <div className="mt-3 rounded-lg border border-ink/10 bg-chalk px-3.5 py-2.5">
        <p className="text-xs font-medium text-ink/55">Planned for a future update</p>
        <ul className="mt-1.5 list-inside list-disc text-xs text-ink/45">
          <li>Two-factor authentication (MFA)</li>
          <li>Passkeys</li>
          <li>A list of active sessions you can sign out remotely</li>
        </ul>
        <p className="mt-2 text-xs text-ink/40">
          Not yet available. Recovery questions are not used for sign-in or account recovery on Ovalball --
          they are a weak security mechanism on their own and won&rsquo;t be added without a dedicated review.
        </p>
      </div>
    </div>
  )
}
