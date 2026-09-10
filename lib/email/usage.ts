import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * TRANSACTIONAL EMAIL USAGE -- read from the ONE canonical delivery ledger
 * (public.email_deliveries) through set-based aggregate SQL
 * (email_usage_summary, email_recent_deliveries), never by loading rows
 * into the browser to be counted in React. See the migration's own header
 * for exactly what each metric means and why send occurrences and
 * recipient deliveries are two different numbers.
 */

export interface EmailUsageRow {
  eventKey: string
  sendOccurrences: number
  recipientDeliveries: number
  providerAccepted: number
  failed: number
  suppressed: number
  testSends: number
  lastSentAt: string | null
}

export async function fetchEmailUsageSummary(
  supabase: SupabaseClient<Database>,
  since: Date | null = null,
  until: Date | null = null
): Promise<Record<string, EmailUsageRow>> {
  const { data, error } = await supabase.rpc("email_usage_summary", {
    p_since: since ? since.toISOString() : undefined,
    p_until: until ? until.toISOString() : undefined,
  })
  if (error || !data) return {}

  const out: Record<string, EmailUsageRow> = {}
  for (const row of data) {
    out[row.event_key] = {
      eventKey: row.event_key,
      sendOccurrences: Number(row.send_occurrences),
      recipientDeliveries: Number(row.recipient_deliveries),
      providerAccepted: Number(row.provider_accepted),
      failed: Number(row.failed),
      suppressed: Number(row.suppressed),
      testSends: Number(row.test_sends),
      lastSentAt: row.last_sent_at,
    }
  }
  return out
}

/** The compact dashboard header's own totals -- a sum over every event's row, computed here rather than a second SQL query. */
export interface EmailUsageTotals {
  recipientDeliveries: number
  providerAccepted: number
  failed: number
  testSends: number
  activeEventCount: number
}

export function summariseTotals(
  usage: Record<string, EmailUsageRow>,
  activeByKey: Record<string, boolean>
): EmailUsageTotals {
  let recipientDeliveries = 0
  let providerAccepted = 0
  let failed = 0
  let testSends = 0
  for (const row of Object.values(usage)) {
    recipientDeliveries += row.recipientDeliveries
    providerAccepted += row.providerAccepted
    failed += row.failed
    testSends += row.testSends
  }
  const activeEventCount = Object.values(activeByKey).filter(Boolean).length
  return { recipientDeliveries, providerAccepted, failed, testSends, activeEventCount }
}

export interface EmailRecentDelivery {
  id: string
  queuedAt: string
  status: string
  recipientKind: string
  isTest: boolean
  destination: string | null
  provider: string | null
  providerReference: string | null
  errorCode: string | null
}

export async function fetchRecentDeliveries(
  supabase: SupabaseClient<Database>,
  eventKey: string,
  limit = 20
): Promise<EmailRecentDelivery[]> {
  const { data, error } = await supabase.rpc("email_recent_deliveries", { p_event_key: eventKey, p_limit: limit })
  if (error || !data) return []
  return data.map((row) => ({
    id: row.id,
    queuedAt: row.queued_at,
    status: row.status,
    recipientKind: row.recipient_kind,
    isTest: row.is_test,
    destination: row.destination,
    provider: row.provider,
    providerReference: row.provider_reference,
    errorCode: row.error_code,
  }))
}

/** UK-friendly period boundaries for the lightweight date filter -- Today / 7 Days / This Month / Last Month. Never a heavyweight analytics range picker. */
export type UsagePeriod = "today" | "7days" | "thisMonth" | "lastMonth" | "allTime"

export function periodBounds(period: UsagePeriod, now: Date = new Date()): { since: Date | null; until: Date | null } {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  switch (period) {
    case "today":
      return { since: startOfDay(now), until: null }
    case "7days": {
      const since = startOfDay(now)
      since.setDate(since.getDate() - 6)
      return { since, until: null }
    }
    case "thisMonth":
      return { since: new Date(now.getFullYear(), now.getMonth(), 1), until: null }
    case "lastMonth":
      return {
        since: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        until: new Date(now.getFullYear(), now.getMonth(), 1),
      }
    case "allTime":
      return { since: null, until: null }
  }
}
