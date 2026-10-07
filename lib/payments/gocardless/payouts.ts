import type { SupabaseClient } from "@supabase/supabase-js"

import { GoCardlessApiError, gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"
import type { Database } from "@/types/database.types"

/**
 * THE MONEY REACHES THE CLUB (20270754000000, Part 2 §29). A payout is read from GoCardless when it is paid, with
 * every item in it, and recorded through `record_gocardless_payout` -- GoCardless keeps payout items for six months
 * only (https://docs.gocardless.com/docs/api-reference/payout-item), so they are kept here. A refund is read from
 * GoCardless's own refund resource and recorded through `record_gocardless_refund`. Nothing is taken from the event
 * body: every event is a link, and the resource is re-fetched with the club's own connection.
 */

export interface GoCardlessPayout {
  id: string
  amount: number
  currency: string
  status: "pending" | "paid" | "bounced"
  arrival_date: string | null
  reference: string | null
  payout_type: "merchant" | "partner" | null
  deducted_fees: number | null
  created_at: string | null
}

export interface GoCardlessPayoutItem {
  type: string
  /** Pence, to one decimal place, as a string: positive is money to the club, negative money taken. */
  amount: string
  taxes?: { amount: string }[]
  links?: { payment?: string; refund?: string; mandate?: string }
}

/** GoCardless serves at most 500 items a page; a payout with more is read page by page. */
export const PAYOUT_ITEMS_PAGE = 500
/** A safety stop far beyond any club's payout, so a cursor that never ends cannot spin for ever. */
const MAX_PAGES = 100

type Connection = { environment: GoCardlessEnvironment; accessToken: string }

export async function fetchGoCardlessPayout(connection: Connection, gcPayoutId: string): Promise<GoCardlessPayout> {
  const r = await gcRequest<{ payouts: GoCardlessPayout }>({ ...connection, method: "GET", path: `/payouts/${encodeURIComponent(gcPayoutId)}` })
  return r.payouts
}

/**
 * Every item in a payout, following GoCardless's cursor. Null when GoCardless no longer serves them (410 Gone after
 * six months): the caller then keeps whatever is already held rather than recording an empty payout.
 */
export async function fetchAllPayoutItems(connection: Connection, gcPayoutId: string): Promise<GoCardlessPayoutItem[] | null> {
  const items: GoCardlessPayoutItem[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ payout: gcPayoutId, limit: String(PAYOUT_ITEMS_PAGE) })
    if (after) query.set("after", after)
    let r: { payout_items: GoCardlessPayoutItem[]; meta?: { cursors?: { after?: string | null } } }
    try {
      r = await gcRequest({ ...connection, method: "GET", path: `/payout_items?${query.toString()}` })
    } catch (error) {
      if (error instanceof GoCardlessApiError && error.status === 410) return null
      throw error
    }
    items.push(...(r.payout_items ?? []))
    after = r.meta?.cursors?.after ?? null
    if (!after) return items
  }
  throw new Error(`GoCardless payout ${gcPayoutId} has more than ${MAX_PAGES * PAYOUT_ITEMS_PAGE} items; recording stopped rather than keep a partial list.`)
}

/** Records a payout GoCardless returned, and its items, for one club. Idempotent: a replay replaces the items. */
export async function recordGoCardlessPayout(supabase: SupabaseClient<Database>, clubId: string, payout: GoCardlessPayout, items: GoCardlessPayoutItem[] | null): Promise<void> {
  const { error } = await supabase.rpc("record_gocardless_payout", {
    p_club_id: clubId,
    p_payout: payout as unknown as Database["public"]["Functions"]["record_gocardless_payout"]["Args"]["p_payout"],
    // Null (archived at GoCardless) keeps the items already held.
    p_items: items as unknown as Database["public"]["Functions"]["record_gocardless_payout"]["Args"]["p_items"],
  })
  if (error) throw new Error(error.message)
}

/** Which of the clubs holding a GoCardless account a payout belongs to: the one whose payments are in it. */
export async function payoutClub(supabase: SupabaseClient<Database>, candidateClubIds: string[], items: GoCardlessPayoutItem[] | null): Promise<string | null> {
  if (candidateClubIds.length === 1) return candidateClubIds[0]
  const paymentIds = [...new Set((items ?? []).map((i) => i.links?.payment).filter((p): p is string => Boolean(p)))]
  if (paymentIds.length === 0) return null
  const { data, error } = await supabase.from("gocardless_payments").select("club_id").in("gc_payment_id", paymentIds).in("club_id", candidateClubIds)
  if (error) throw new Error(error.message)
  const counts = new Map<string, number>()
  for (const row of data ?? []) counts.set(row.club_id, (counts.get(row.club_id) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
}

export interface GoCardlessRefund {
  id: string
  amount: number
  status: string
  links?: { payment?: string }
}

export async function fetchGoCardlessRefund(connection: Connection, gcRefundId: string): Promise<GoCardlessRefund> {
  const r = await gcRequest<{ refunds: GoCardlessRefund }>({ ...connection, method: "GET", path: `/refunds/${encodeURIComponent(gcRefundId)}` })
  return r.refunds
}

/** Reads one refund from GoCardless and records it against Ovalball's payment, if the payment is Ovalball's. */
export async function reconcileGoCardlessRefund(params: { supabase: SupabaseClient<Database>; connection: Connection; gcRefundId: string }): Promise<void> {
  const refund = await fetchGoCardlessRefund(params.connection, params.gcRefundId)
  if (!refund.links?.payment) return
  const { error } = await params.supabase.rpc("record_gocardless_refund", {
    p_gc_refund_id: refund.id,
    p_gc_payment_id: refund.links.payment,
    p_amount_minor: refund.amount,
    p_gc_status: refund.status,
  })
  if (error) throw new Error(error.message)
}
