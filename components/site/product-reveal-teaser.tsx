import { Reveal } from "@/lib/motion/reveal"

/**
 * Phase 1 stops here deliberately: this establishes the section boundary and
 * entry motion into the Product Reveal (dark forest, quiet, the last line the
 * visitor reads before the story turns from rugby to software) without
 * building the pinned oval-mask scroll-scrub transition itself, which the
 * approved storyboard reserves for Phase 2.
 */
export function ProductRevealTeaser() {
  return (
    <section id="product" className="flex min-h-[60vh] items-center justify-center bg-forest-950">
      <Reveal className="px-4 text-center">
        <p className="font-display text-display-l text-chalk">This is Ovalball.</p>
      </Reveal>
    </section>
  )
}
