import { Webhook } from "lucide-react"

/**
 * One row of public.gocardless_inbox_health() (20270749000000): counts and times only. The RPC never returns an
 * event's payload or any token, and this card shows nothing it does not return.
 */
export interface GoCardlessInboxHealth {
  unprocessed: number | null
  stranded: number | null
  deferred: number | null
  dead_lettered: number | null
  oldest_unprocessed_seconds: number | null
  revocations_queued: number | null
  oldest_revocation_seconds: number | null
  max_revocation_attempts: number | null
  replay_configured: boolean | null
  replay_scheduled: boolean | null
  last_replay_requested_at: string | null
  last_replay_collected_at: string | null
  last_replay_outcome: string | null
  last_replay_status_code: number | null
}

/** What each recorded outcome of a scheduled replay means, in words. */
const OUTCOME_LABEL: Record<string, string> = {
  ok: "Completed",
  not_ok: "Completed with failures",
  http_error: "Refused by the website",
  timed_out: "Timed out",
  network_error: "Could not reach the website",
  no_response: "No answer recorded",
  refused_insecure_url: "Not sent: the replay address is not HTTPS",
}

/** A token waiting longer than this, or tried more often than this, needs looking at. */
const REVOCATION_AGE_ALERT_SECONDS = 60 * 60
const REVOCATION_ATTEMPTS_ALERT = 3

/**
 * GOCARDLESS WEBHOOKS, ON SYSTEM HEALTH. Whether every event GoCardless has sent about member payments has been
 * processed, and whether the access a club gave up has been revoked at GoCardless -- the failures the webhook
 * replay exists to recover, made visible (the 6 October 2026 audit, gap G2). A read failure is said as one, never
 * shown as zero.
 */
export function GoCardlessInboxCard({ health, readError }: { health: GoCardlessInboxHealth | null; readError: string | null }) {
  const stranded = health?.stranded ?? 0
  const deferred = health?.deferred ?? 0
  const deadLettered = health?.dead_lettered ?? 0
  const queued = health?.revocations_queued ?? 0
  const oldestRevocation = health?.oldest_revocation_seconds ?? null
  const revocationNeedsAttention =
    queued > 0 && ((oldestRevocation ?? 0) > REVOCATION_AGE_ALERT_SECONDS || (health?.max_revocation_attempts ?? 0) > REVOCATION_ATTEMPTS_ALERT)
  const lastOutcome = health?.last_replay_outcome ?? null

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2.5">
        <Webhook aria-hidden="true" className="size-4 text-forest-800" />
        <h2 className="font-display text-xl text-ink">GoCardless Webhooks</h2>
      </div>
      <p className="mt-1 text-sm text-ink/70">
        Whether every event GoCardless has sent about member payments has been processed, and whether access a
        club has given up has been revoked. Counts only: no payment details are read here.
      </p>

      {readError ? null : !health?.replay_configured ? (
        <p className="mt-4 rounded-lg border border-ink/10 bg-white px-5 py-4 text-sm text-ink/70">
          The scheduled replay is not configured in this environment, so a failed event is retried only when
          GoCardless sends it again. This is the deliberate default outside production.
        </p>
      ) : !health.replay_scheduled ? (
        <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-medium text-amber-950">The scheduled replay is switched off</p>
          <p className="mt-1 text-sm text-amber-900">
            Its address and secret are configured, but the job that calls it is not active.
          </p>
        </div>
      ) : null}

      <dl className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        {readError ? (
          <div className="px-5 py-3.5">
            <p role="alert" className="text-sm text-amber-900">
              Webhook figures could not be read &mdash; this is a read failure, not zero activity.
            </p>
            <p className="mt-1 font-mono text-xs break-words text-amber-900/80">{readError}</p>
          </div>
        ) : (
          <>
            <Row label="Unprocessed for over 30 minutes" value={String(stranded)} tone={stranded > 0 ? "warn" : "plain"} />
            <Row label="Waiting for a club to reconnect" value={String(deferred)} tone={deferred > 0 ? "warn" : "plain"} />
            <Row label="Given up after every retry" value={String(deadLettered)} tone={deadLettered > 0 ? "bad" : "plain"} />
            <Row
              label="Oldest unprocessed event"
              value={(health?.unprocessed ?? 0) > 0 ? formatAge(health?.oldest_unprocessed_seconds ?? null) : "None"}
            />
            <Row label="Access tokens waiting to be revoked" value={String(queued)} tone={revocationNeedsAttention ? "warn" : "plain"} />
            {queued > 0 ? (
              <Row
                label="Oldest token waiting"
                value={`${formatAge(oldestRevocation)} (tried ${health?.max_revocation_attempts ?? 0} ${(health?.max_revocation_attempts ?? 0) === 1 ? "time" : "times"} at most)`}
                tone={revocationNeedsAttention ? "warn" : "plain"}
              />
            ) : null}
            <Row
              label="Last scheduled replay"
              value={
                health?.last_replay_requested_at
                  ? `${formatDateTime(health.last_replay_requested_at)} · ${
                      lastOutcome
                        ? `${OUTCOME_LABEL[lastOutcome] ?? lastOutcome}${health.last_replay_status_code ? ` (${health.last_replay_status_code})` : ""}`
                        : "Waiting for its answer"
                    }`
                  : "None recorded"
              }
              tone={lastOutcome && lastOutcome !== "ok" ? "warn" : "plain"}
            />
          </>
        )}
      </dl>
    </section>
  )
}

function Row({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "warn" | "bad" }) {
  const colour = tone === "bad" ? "text-destructive-text" : tone === "warn" ? "text-amber-900" : "text-ink"
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <dt className="text-sm text-ink/70">{label}</dt>
      <dd className={`text-right font-mono text-sm tabular-nums ${colour}`}>{value}</dd>
    </div>
  )
}

/** An age in words: "under a minute", "12 minutes", "3 hours 5 minutes", "2 days 4 hours". */
function formatAge(seconds: number | null): string {
  if (seconds === null || seconds < 60) return seconds === null ? "Unknown" : "Under a minute"
  const minutes = Math.floor(seconds / 60)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`
  if (minutes < 60) return plural(minutes, "minute")
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${plural(hours, "hour")} ${plural(minutes % 60, "minute")}` : plural(hours, "hour")
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${plural(days, "day")} ${plural(hours % 24, "hour")}` : plural(days, "day")
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}
