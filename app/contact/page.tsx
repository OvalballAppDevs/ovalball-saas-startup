import type { Metadata } from "next"
import Link from "next/link"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { CONTACT_EMAIL, CONTACT_MAILTO, PRODUCT_NAME } from "@/lib/legal/metadata"

import { ContactForm } from "./contact-form"

export const metadata: Metadata = {
  title: "Contact Us | Ovalball",
  description:
    "Get in touch with the Ovalball team about using Ovalball at your rugby club, your account, or a question about the service.",
}

export default async function ContactPage() {
  const identity = await getPublicHeaderIdentity()

  return (
    <>
      <Header identity={identity} />
      <main className="brand-light-scope bg-chalk pt-32 pb-24 md:pt-40">
        <div className="mx-auto max-w-2xl px-4 md:px-8">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Contact</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Contact {PRODUCT_NAME}</h1>
          <p className="mt-4 max-w-lg text-base text-ink/65">
            Have a question about {PRODUCT_NAME}? Whether you&apos;re interested in using it for
            your rugby club, need help with your account, or simply want to speak to us, we&apos;d
            be pleased to hear from you.
          </p>

          {/* The address comes before the form on purpose. Someone who
              prefers their own mail client should not have to fill in a
              form to discover where to write. */}
          <section
            aria-labelledby="contact-email-heading"
            className="mt-8 rounded-xl border border-ink/10 bg-white px-6 py-5"
          >
            <h2
              id="contact-email-heading"
              className="text-sm font-medium tracking-[0.08em] text-ink/50 uppercase"
            >
              Email
            </h2>
            <a
              href={CONTACT_MAILTO}
              className="mt-1.5 inline-block font-display text-2xl text-forest-800 underline decoration-forest-800/25 underline-offset-4 hover:text-forest-950 hover:decoration-forest-800/60 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              {CONTACT_EMAIL}
            </a>
            <p className="mt-2 text-sm text-ink/55">
              Or use the form below and your message will be sent to the {PRODUCT_NAME} team.
            </p>
          </section>

          <div className="mt-8">
            <ContactForm />
          </div>

          <p className="mt-8 text-sm text-ink/50">
            Already have an {PRODUCT_NAME} account?{" "}
            <Link
              href="/support"
              className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Sign in for tracked support
            </Link>{" "}
            &mdash; you&apos;ll be able to follow your request and see our replies in one place.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
