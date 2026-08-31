import Image from "next/image"

import { Reveal } from "@/lib/motion/reveal"

interface PhotoTransitionProps {
  src: string
  alt: string
  line: string
}

/**
 * A full-bleed photography band between two demo sections -- breaks the
 * "another light card section" rhythm the brief warned against, without
 * needing a second scroll-driven mechanism like the hero->emotion
 * transition. One line of copy, restrained, never a competing headline.
 */
export function PhotoTransition({ src, alt, line }: PhotoTransitionProps) {
  return (
    <section className="relative flex h-[46vh] min-h-[320px] items-center justify-center overflow-hidden bg-forest-950 md:h-[54vh]">
      <Image src={src} alt={alt} fill className="object-cover" sizes="100vw" />
      <div className="absolute inset-0 bg-forest-950/45" />
      <Reveal className="relative px-4 text-center">
        <p className="font-display text-display-l text-white">{line}</p>
      </Reveal>
    </section>
  )
}
