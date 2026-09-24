/**
 * THE WAYS INTO OVALBALL -- the only ones that exist.
 *
 * Get Started is a decision, not a registration form. There is no open sign-up that ends in access, no
 * role picker and no "I am a coach" declaration that means anything: access comes from an invitation,
 * a team's code, a club claim reviewed by Ovalball, or an account that already exists. Each client
 * draws these four the same way and sends each to its canonical surface.
 */
export type EntryPathKey = "INVITATION" | "CODE" | "CLUB" | "SIGN_IN"

export type EntryPath = {
  key: EntryPathKey
  title: string
  body: string
  /** NATIVE: the phone owns the surface. WEB: the canonical surface is the website and the phone opens it. */
  surface: "NATIVE" | "WEB"
  /** The website path for a WEB surface, or the one the phone would deep-link from. */
  webPath: string
}

export const ENTRY_PATHS: readonly EntryPath[] = [
  {
    key: "INVITATION",
    title: "I have an invitation",
    body: "Somebody at your club sent you a link or a code.",
    surface: "NATIVE",
    webPath: "/join",
  },
  {
    key: "CODE",
    title: "I have a team code",
    body: "A code from your team to ask to join it.",
    surface: "NATIVE",
    webPath: "/join",
  },
  {
    key: "CLUB",
    title: "Join or set up my club",
    body: "Find your club, ask to join it, or bring it onto Ovalball.",
    surface: "WEB",
    webPath: "/signup",
  },
  {
    key: "SIGN_IN",
    title: "I already have an account",
    body: "Sign in with your email and password.",
    surface: "NATIVE",
    webPath: "/login",
  },
]

/** What no entry path may ever be: a self-declared role. Pinned by test. */
export const FORBIDDEN_ENTRY_CHOICES = ["I am a coach", "I am a parent", "I am a club admin", "Choose your role", "Create account"] as const
