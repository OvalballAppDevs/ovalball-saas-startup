/**
 * PROVIDER STATUS -- read-only, and deliberately narrow.
 *
 * This answers "would Send Test Email actually reach ZeptoMail right now",
 * for the operator setting production email up. It never shows a secret:
 * everything here comes from describeEmailConfiguration() (lib/email/
 * provider.ts), the one canonical validator, which returns presence booleans
 * and non-secret values (a From address, an API host) but never a key.
 *
 * Domain Verification always reads "Requires external verification" and
 * never anything else -- ZeptoMail decides that from DKIM/CNAME records
 * generated per account, and no DNS lookup this application could run would
 * be authoritative. Claiming "Verified" from here would be a guess wearing
 * a status label.
 */

const PROVIDER_LABELS: Record<string, string> = {
  zeptomail: "ZeptoMail",
  mailpit: "Mailpit (local catcher)",
  "log-only": "Log-only (nothing sent)",
}

const ENVIRONMENT_LABELS: Record<string, string> = {
  production: "Production",
  preview: "Preview",
  development: "Local / Development",
}

export interface LastTestSend {
  status: string
  eventKey: string
  provider: string | null
  queuedAt: string
}

export interface ProviderStatusPanelProps {
  providerName: string
  delivers: boolean
  configurationError: string | null
  environment: "production" | "preview" | "development"
  apiKeyConfigured: boolean
  apiUrlEffective: string | null
  fromAddress: string | null
  fromName: string | null
  replyToAddress: string | null
  replyToName: string | null
  identityMatchesCanonicalProduction: boolean
  lastTestSend: LastTestSend | null
}

export function ProviderStatusPanel({
  providerName,
  delivers,
  configurationError,
  environment,
  apiKeyConfigured,
  apiUrlEffective,
  fromAddress,
  fromName,
  replyToAddress,
  replyToName,
  identityMatchesCanonicalProduction,
  lastTestSend,
}: ProviderStatusPanelProps) {
  const isZeptoMail = providerName === "zeptomail"

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg text-ink">Provider Status</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Whether Send Test Email would actually reach a real mail provider from this deployment.
      </p>

      {configurationError && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3 text-sm text-ink">
          {configurationError}
        </p>
      )}

      {isZeptoMail && environment === "production" && !identityMatchesCanonicalProduction && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3 text-sm text-ink">
          The configured sender identity does not match Ovalball&apos;s intended production identity
          (Ovalball &lt;no-reply@ovalball.co.uk&gt;, reply-to hello@ovalball.co.uk, site
          https://ovalball.co.uk). Worth checking this is deliberate.
        </p>
      )}

      <dl className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        <Row label="Provider" value={PROVIDER_LABELS[providerName] ?? providerName} />
        <Row label="Environment" value={ENVIRONMENT_LABELS[environment]} />
        <Row label="Sends mail" value={delivers ? "Yes" : "No"} tone={delivers ? "ok" : "warn"} />
        <Row label="From address" value={fromAddress ? `${fromName ? `${fromName} ` : ""}<${fromAddress}>` : "Not set"} />
        <Row label="Reply-To" value={replyToAddress ? `${replyToName ? `${replyToName} ` : ""}<${replyToAddress}>` : "Not set"} />
        {isZeptoMail && (
          <>
            <Row
              label="API credential"
              value={apiKeyConfigured ? "Configured" : "Missing"}
              tone={apiKeyConfigured ? "ok" : "warn"}
            />
            <Row label="Provider endpoint" value={apiUrlEffective ?? "Not set"} />
          </>
        )}
        <Row label="Domain verification" value="Requires external verification" tone="neutral" />
        <Row label="Last test send" value={formatLastTestSend(lastTestSend)} />
      </dl>
    </section>
  )
}

function formatLastTestSend(last: LastTestSend | null): string {
  if (!last) return "None sent from this deployment yet"
  const when = new Date(last.queuedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
  const status = last.status === "sent" ? "Sent" : last.status === "failed" ? "Failed" : last.status
  return `${status} · ${last.eventKey} · ${when}`
}

function Row({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" | "neutral" }) {
  const toneClass =
    tone === "ok" ? "text-forest-800" : tone === "warn" ? "text-amber-900" : tone === "neutral" ? "text-ink-muted" : "text-ink"
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={`font-mono text-sm ${toneClass}`}>{value}</dd>
    </div>
  )
}
