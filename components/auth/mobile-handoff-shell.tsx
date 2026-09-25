import { OvalballLogo } from "@/components/brand/ovalball-logo"

/**
 * THE SHARED FRAME for `/auth/mobile-recovery` and `/auth/mobile-oauth-callback` -- Expo Go's own
 * one-hop pages, extracted here (CA-M11.3) so a second one did not duplicate the first's markup.
 */
export function MobileHandoffShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="brand-light-scope flex min-h-dvh flex-col items-center justify-center bg-chalk px-6 text-center">
      <OvalballLogo variant="dark" className="h-10 w-auto" />
      <h1 className="mt-8 font-display text-display-m text-ink">{title}</h1>
      {children}
    </main>
  )
}
