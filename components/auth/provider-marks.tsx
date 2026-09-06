/**
 * Official provider marks for sign-in buttons.
 *
 * These are each provider's own logo, reproduced as inline SVG at the
 * geometry their sign-in branding guidance specifies -- Google's four-colour
 * G, Apple's monochrome mark, Meta's Facebook "f". They are the providers'
 * trade marks, used here only to label the corresponding sign-in button,
 * which is the use each provider's brand guidance permits.
 *
 * Rules that come with that permission, and which the buttons honour:
 *   - the mark is never recoloured, stretched or rotated;
 *   - it is never combined with Ovalball's own mark;
 *   - Apple's mark is monochrome and takes the button's foreground colour;
 *   - the wording is theirs too ("Sign in with Apple", not "Continue with").
 *
 * All three are decorative: the button already carries an accessible name,
 * so every mark is aria-hidden rather than announced twice.
 */

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.22 9.58c.02 2.1 1.84 2.8 1.86 2.81-.01.05-.29 1-.96 1.98-.58.85-1.18 1.7-2.13 1.71-.93.02-1.23-.55-2.3-.55-1.06 0-1.4.53-2.28.57-.91.03-1.6-.92-2.19-1.76-1.2-1.74-2.11-4.9-.88-7.05a3.4 3.4 0 0 1 2.87-1.74c.9-.02 1.74.6 2.29.6.54 0 1.57-.74 2.65-.63.45.02 1.72.18 2.53 1.37-.06.04-1.51.88-1.5 2.63M10.5 3.3c.48-.58.8-1.4.71-2.21-.69.03-1.53.46-2.03 1.04-.44.52-.83 1.35-.73 2.14.77.06 1.56-.39 2.05-.97"
      />
    </svg>
  )
}

export function FacebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#1877F2"
        d="M18 9a9 9 0 1 0-10.41 8.89v-6.29H5.31V9h2.28V7.02c0-2.25 1.34-3.5 3.4-3.5.98 0 2.01.18 2.01.18v2.21h-1.13c-1.12 0-1.47.7-1.47 1.4V9h2.5l-.4 2.6h-2.1v6.29A9 9 0 0 0 18 9Z"
      />
      <path
        fill="#fff"
        d="m12.5 11.6.4-2.6h-2.5V7.31c0-.71.35-1.4 1.47-1.4H13V3.7s-1.03-.18-2.01-.18c-2.06 0-3.4 1.25-3.4 3.5V9H5.31v2.6h2.28v6.29a9.06 9.06 0 0 0 2.81 0V11.6h2.1Z"
      />
    </svg>
  )
}

export const PROVIDER_MARKS = {
  google: GoogleMark,
  apple: AppleMark,
  facebook: FacebookMark,
} as const
