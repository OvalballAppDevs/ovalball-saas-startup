import { EmotionSection } from "@/components/site/emotion-section"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { HeroSection } from "@/components/site/hero-section"
import { OrganiseFixturesSection } from "@/components/site/organise-fixtures-section"
import { PartnerCommunicationSection } from "@/components/site/partner-communication-section"
import { PhotoTransition } from "@/components/site/photo-transition"
import { PlanSeasonSection } from "@/components/site/plan-season-section"
import { ProductRevealTeaser } from "@/components/site/product-reveal-teaser"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"

// Server Component: composes the marketing page from client-side section
// components rather than making the whole page a client boundary. An
// authenticated visitor still sees this public homepage -- never
// redirected away from it -- with the header's account control standing
// in for "Sign In" instead.
export default async function Page() {
  const identity = await getPublicHeaderIdentity()

  return (
    <>
      <Header identity={identity} />
      <main>
        <HeroSection />
        <EmotionSection />
        <ProductRevealTeaser />
        <OrganiseFixturesSection />
        <PhotoTransition
          src="/images/playing-rugby.png"
          alt="A rugby player mid-tackle during a match"
          line="Built around the game, not a generic calendar."
        />
        <PlanSeasonSection />
        <PhotoTransition
          src="/images/muddy-phone.png"
          alt="A muddy hand holding a phone pitchside"
          line="On the touchline, on your phone."
        />
        <PartnerCommunicationSection />
      </main>
      <Footer />
    </>
  )
}
