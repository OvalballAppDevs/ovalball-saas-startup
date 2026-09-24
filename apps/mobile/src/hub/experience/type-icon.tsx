import type { HubEntityType } from "@ovalball/contracts/rugby-hub/related"

import { BookOpen, Compass, Dumbbell, Gavel, Globe, GraduationCap, HeartHandshake, Landmark, Layers, Milestone, Scale, Trophy, UserRound } from "../../components/icons"

/**
 * One small glyph per entity type, so the path through the graph is obvious at a glance -- a term
 * looks like a term, a rule like a rule -- alongside the type label that carries the meaning for a
 * screen reader. Never colour alone.
 */
export function HubTypeIcon({ type, size = 16, color }: { type: HubEntityType; size?: number; color: string }) {
  const props = { size, color, strokeWidth: 1.9 }
  switch (type) {
    case "GAME_CONCEPT":
      return <Compass {...props} />
    case "GLOSSARY_TERM":
      return <BookOpen {...props} />
    case "RULE":
      return <Scale {...props} />
    case "OFFICIATING_CONCEPT":
      return <Gavel {...props} />
    case "COACHING_CONCEPT":
      return <GraduationCap {...props} />
    case "PLAYER_DEVELOPMENT_CONCEPT":
    case "SKILL":
      return <Dumbbell {...props} />
    case "PARENT_GUIDE":
      return <HeartHandshake {...props} />
    case "COMPETITION_GUIDE":
      return <Trophy {...props} />
    case "RUGBY_TEAM":
      return <Globe {...props} />
    case "RUGBY_PERSON":
      return <UserRound {...props} />
    case "POSITION":
      return <Layers {...props} />
    case "STORY":
      return <Milestone {...props} />
    case "CLUB":
      return <Landmark {...props} />
  }
}
