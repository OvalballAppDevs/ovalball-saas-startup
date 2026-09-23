import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * WHO THIS PERSON MAY MESSAGE.
 *
 * `my_direct_message_candidates()` is the whole answer and it is a per-caller FUNCTION, not a table:
 * there is nothing to read around, no membership to enumerate, and no id to guess at. It applies
 * `internal.may_direct_message` to its own output, which is the same predicate the send path applies
 * -- so the picker and the send can never disagree.
 *
 * WHAT THAT PREDICATE DOES, in its own order: both parties must be adults for messaging purposes,
 * first and unconditionally -- a minor's account disqualifies, and *nothing* below reaches past it,
 * "not a shared club, not a guardian relationship, not a fixture, not an existing thread, not
 * administrator status". Then a block in either direction is absolute. Then site and club policy.
 * Only then does relationship matter: the same club, the same team's staff, or opposite sides of a
 * fixture within sixty days.
 *
 * SO THE APP ADDS NOTHING. It does not filter, rank by role, or hide anybody: doing so would be a
 * second opinion about safeguarding held on a handset. It groups what comes back, because the
 * function already returns the grouping label it wants used.
 *
 * AND IT NEVER EXPLAINS AN ABSENCE. Somebody who is blocked and somebody who is a minor are both
 * simply not in the list, which is the point -- an interface that said which would disclose exactly
 * what the rule exists to protect.
 */

export interface Recipient {
  userId: string
  name: string
  /** The canonical grouping label: "Your team", "Your club", "Fixture contact". */
  group: string
  /** The team or club that label refers to -- "Under 12 Boys". */
  detail: string | null
  /**
   * WHOSE Under 12 Boys.
   *
   * A fixture contact is by definition somebody from the other side, and a club
   * that plays three different Under 12 sides across a season produced three
   * identical-looking rows. The club is the Club Directory's canonical name and
   * comes from the same RPC as everything else on the row.
   *
   * Null for nobody in practice, but typed honestly rather than defaulted to a
   * club that might be the wrong one.
   */
  club: string | null
}

export interface RecipientGroup {
  label: string
  people: Recipient[]
}

export async function loadRecipients(supabase: SupabaseClient<Database>): Promise<Recipient[]> {
  const { data } = await supabase.rpc("my_direct_message_candidates")
  return (data ?? [])
    .filter((row) => Boolean(row.user_id))
    .map((row) => ({
      userId: row.user_id as string,
      // A person with no name recorded is still a real person; the address is not shown here, because
      // a picker is not a directory.
      name: row.display_name?.trim() || "Ovalball user",
      group: row.context_label ?? "Ovalball",
      detail: row.context_detail ?? null,
      club: row.context_club ?? null,
    }))
}

/**
 * Grouped for a rugby product rather than an address book: your team first, then your club, then the
 * people a fixture put you in touch with. The order is the function's own ranking, preserved.
 */
const GROUP_ORDER = ["Your team", "Your club", "Fixture contact"]

/**
 * ONE SEARCH OVER EVERYTHING A ROW SAYS.
 *
 * A person, their team and their CLUB. Searching a club name is the case the
 * owner asked for and the one a long list actually needs -- somebody looking for
 * the Preston contact types "Preston", not the name of a person they have never
 * met. It matches the club because the row now carries the club, rather than
 * because the search was taught to guess at one.
 *
 * NARROWING ONLY. Nothing here reaches past `my_direct_message_candidates`: the
 * search removes rows from a list the server already decided, so a clever query
 * cannot surface somebody the safeguarding rule excluded. That is also why there
 * is no "no results, try searching the directory" affordance -- there is nothing
 * else to search.
 */
export function groupRecipients(recipients: Recipient[], search: string): RecipientGroup[] {
  const needle = search.trim().toLowerCase()
  const matching = needle
    ? recipients.filter((r) =>
        [r.name, r.detail, r.club, r.group].some((field) => (field ?? "").toLowerCase().includes(needle))
      )
    : recipients

  const byGroup = new Map<string, Recipient[]>()
  for (const recipient of matching) {
    const list = byGroup.get(recipient.group) ?? []
    list.push(recipient)
    byGroup.set(recipient.group, list)
  }

  return [...byGroup.entries()]
    .sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0])
      const bi = GROUP_ORDER.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    .map(([label, people]) => ({ label, people: people.sort((a, b) => a.name.localeCompare(b.name)) }))
}

/**
 * Start (or reopen) a conversation with somebody.
 *
 * `open_direct_conversation` is the canonical way, and it decides: it applies the same eligibility
 * rule again rather than trusting that the caller only ever got here from the picker. A user id that
 * arrived some other way -- a stale list, a modified client -- is refused here, not in the interface.
 * One conversation per pair, so asking twice returns the same thread rather than a second one.
 */
export async function openConversationWith(
  supabase: SupabaseClient<Database>,
  otherUserId: string
): Promise<{ ok: true; conversationId: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("open_direct_conversation", { p_other_user_id: otherUserId })
  if (error || !data) {
    // One sentence, whatever the reason. A refusal here means the same things an absence from the
    // picker means, and they must read the same.
    return { ok: false, message: "You can't start a conversation with that person." }
  }
  return { ok: true, conversationId: data as string }
}
