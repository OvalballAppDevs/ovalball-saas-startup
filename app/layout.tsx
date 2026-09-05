import { Bebas_Neue, Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
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
