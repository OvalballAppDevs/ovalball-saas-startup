import { HubShowMe } from "./show-me"
import type { HubExplain } from "./explainer"
import type { HubEntityRef } from "./manifest"

/** The Glossary's word for the same thing: a term you can see, not only read. */
export function HubSeeIt({ entity, explanations, onOpen, inline = false }: { entity: HubEntityRef; explanations: HubExplain; onOpen: (ref: HubEntityRef) => void; inline?: boolean }) {
  return <HubShowMe entity={entity} explanations={explanations} onOpen={onOpen} label="See It" inline={inline} />
}
