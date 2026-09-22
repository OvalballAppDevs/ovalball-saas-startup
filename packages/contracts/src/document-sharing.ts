/**
 * WHICH CLUB DOCUMENTS MAY LEAVE THE CLUB, AND FOR WHOM.
 *
 * `internal.may_share_document_to_target` is the authority and re-checks every share. This is the same
 * rule expressed once for the two clients, so a picker does not OFFER a document the server is about to
 * refuse -- an interface that lists something and then says no is worse than one that never listed it.
 *
 * THE RULE, AND WHY IT IS THIS RULE. `club_documents.category` is the library's own classification, and
 * every value but one is plainly visitor-facing: a visitor guide, fixture information, ground and pitch
 * information, parking, match-day information, an image. `other` is the catch-all -- which is exactly
 * where a document nobody categorised ends up, including a finance paper, a safeguarding note or a
 * committee minute.
 *
 * A FIXTURE CONVERSATION is two clubs' operational contacts, and the long-standing rule there is that
 * you may share what you may view. A DIRECT CONVERSATION is a different audience: the people somebody
 * may direct-message include adults at their own club who are not fixture contacts at all. So `other`
 * is refused for a direct conversation.
 *
 * It fails closed on the safe side of a judgement the platform cannot make. A genuinely shareable
 * document sitting in `other` is fixed by categorising it, which takes thirty seconds and has an owner.
 * A confidential one shared by mistake is not fixable at all.
 */

/** The categories the library itself describes as visitor- and match-day-facing. */
export const DIRECT_SHAREABLE_DOCUMENT_CATEGORIES = [
  "visitor_guide",
  "fixture_information",
  "ground_pitch_information",
  "parking",
  "match_day_information",
  "image",
] as const

export function mayShareDocumentCategory(category: string | null, target: "fixture" | "fixture_request" | "direct"): boolean {
  if (target !== "direct") return true
  return (DIRECT_SHAREABLE_DOCUMENT_CATEGORIES as readonly string[]).includes(category ?? "")
}

/** Said in the club's own vocabulary, so somebody can act on it rather than wonder. */
export const DIRECT_SHARE_CATEGORY_HINT =
  "Only documents categorised for visitors or match days can be sent in a direct message."
