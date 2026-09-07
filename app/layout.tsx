import type { Metadata, Viewport } from "next"
import { Bebas_Neue, Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { PRODUCT_NAME } from "@/lib/legal/metadata"
import { getSiteUrlForMetadata } from "@/lib/site-url"
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

/**
 * The canonical site identity.
 *
 * Every page needs a <title>: it is what a screen reader announces on
 * arrival and what distinguishes one of a dozen open tabs. The app shipped
 * without any metadata at all, so axe reported a WCAG 2.4.2 (Page Titled)
 * failure on every route.
 *
 * The template appends the product name exactly once, so a route says only
 * what IT is -- `title: "Dashboard"` becomes "Dashboard | Ovalball". Route
 * files used to carry the suffix themselves ("Contact Us | Ovalball"), which
 * under a template renders "Contact Us | Ovalball | Ovalball"; those 23
 * titles were trimmed to the page name so there is one mechanism rather
 * than two.
 *
 * ICONS ARE DELIBERATELY ABSENT FROM THIS OBJECT. Next.js generates the
 * <link> tags from app/favicon.ico, app/icon.png and app/apple-icon.png by
 * file convention. Declaring `icons` here as well would emit a second,
 * competing set of tags for the same assets.
 *
 * metadataBase comes from the one origin resolver this product has -- the
 * same value auth links and invitations are built from. It uses the
 * non-throwing variant because root-layout metadata is evaluated at BUILD
 * time, and a missing origin must not make the build itself impossible.
 */
const siteUrl = getSiteUrlForMetadata()

export const metadata: Metadata = {
  // Omitted rather than guessed when no origin is configured: see
  // getSiteUrlForMetadata() for why this one use does not fail closed.
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: `${PRODUCT_NAME} | Rugby Club Management`,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description:
    "Run your rugby club — fixtures, teams, training, matchdays and members in one place.",
  applicationName: PRODUCT_NAME,
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    title: `${PRODUCT_NAME} | Rugby Club Management`,
    description:
      "Run your rugby club — fixtures, teams, training, matchdays and members in one place.",
    locale: "en_GB",
    url: "/",
  },
}

/** The brand green the icons are drawn on, so a browser's UI chrome matches the mark. */
export const viewport: Viewport = {
  themeColor: "#014527",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable,
        bebasNeue.variable
      )}
    >
      {/* brand-light-scope on body, not just per-route: portaled overlay content (Base UI's
          Dialog/Select/Dropdown/Tooltip) renders outside any inner scoped wrapper, appended
          near the end of body -- so a route-local .brand-light-scope div (as /signup and
          /legal already used) never reaches it. No route in this app has a designed dark-mode
          variant (globals.css's own .dark block exists but is unused by design), so scoping
          the whole document is the actual fix, not a broader version of the same one. */}
      <body className="brand-light-scope">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
