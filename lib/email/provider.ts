import "server-only"

/**
 * The email provider abstraction.
 *
 * The audit found no provider integration, no provider environment variables
 * and no SDK in this codebase. Ovalball's intended production sender is Zoho
 * ZeptoMail, which is implemented here -- but ONLY here. Nothing above this
 * file knows the product mails through Zoho: the catalogue, policy, recipient
 * resolution, templates and delivery ledger are all provider-agnostic, so
 * swapping sender is a change to this one module.
 *
 * ZeptoMail is a TRANSACTIONAL sender and is used as one. Bulk marketing is a
 * different policy domain with different consent rules, and belongs in Zoho
 * Campaigns rather than in this pipeline -- turning a transactional sender
 * into a mass-mail tool is how a product ends up mailing people who never
 * agreed to hear from it.
 *
 * Selection is by environment, and the rules are deliberately blunt because
 * the failure they prevent is the expensive kind: a developer running the app
 * locally and mailing real people.
 *
 *   EMAIL_PROVIDER unset            -> log-only. Nothing leaves the machine.
 *   EMAIL_PROVIDER=mailpit          -> local catcher (Supabase ships one on 54324).
 *   EMAIL_PROVIDER=zeptomail        -> real send. Requires ZEPTOMAIL_API_KEY.
 *
 * Production additionally refuses to run log-only: silently not sending
 * production mail is worse than failing, because nobody finds out.
 *
 * Every value here is read from the server environment. None of these names
 * is NEXT_PUBLIC_*, so none is inlined into a browser bundle.
 */

export interface OutboundEmail {
  to: string
  subject: string
  html: string
  text: string
}

export interface FromAddress {
  address: string
  name: string | null
}

export type ProviderResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string; errorMessage: string }

export interface EmailProvider {
  readonly name: string
  /** False when this provider deliberately does not deliver (log-only). */
  readonly delivers: boolean
  send(email: OutboundEmail, from: FromAddress): Promise<ProviderResult>
}

const logOnlyProvider: EmailProvider = {
  name: "log-only",
  delivers: false,
  async send(email) {
    // The subject and recipient only. Bodies can carry a safeguarding message
    // or a support reply, and a developer's terminal scrollback is not an
    // appropriate home for either.
    console.log(`[email:log-only] to=${email.to} subject="${email.subject}"`)
    return { ok: true, providerMessageId: null }
  },
}

/**
 * Local development catcher. Supabase's own stack runs Mailpit on 54324, so
 * a developer sees exactly what would have been sent, and nothing reaches a
 * real inbox.
 */
function mailpitProvider(): EmailProvider {
  const base = process.env.MAILPIT_URL?.trim() || "http://127.0.0.1:54324"
  return {
    name: "mailpit",
    delivers: true,
    async send(email, from) {
      try {
        const res = await fetch(`${base}/api/v1/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: { Email: from.address, Name: from.name ?? undefined },
            To: [{ Email: email.to }],
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
          }),
        })
        if (!res.ok) {
          return { ok: false, errorCode: `http_${res.status}`, errorMessage: await res.text() }
        }
        const body = (await res.json().catch(() => null)) as { ID?: string } | null
        return { ok: true, providerMessageId: body?.ID ?? null }
      } catch (error) {
        return {
          ok: false,
          errorCode: "mailpit_unreachable",
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Zoho ZeptoMail, via its REST Send API rather than SMTP.
 *
 * REST is chosen for observability: it returns a structured result with a
 * per-message id and a machine-readable error code, which is what the
 * delivery ledger needs to answer "what actually happened to this message".
 * SMTP would give a 250 and a text blob.
 *
 * The API key is a ZeptoMail "Send Mail" token and is read from the server
 * environment only. It is never NEXT_PUBLIC_*, so it cannot reach a browser
 * bundle.
 */
function zeptoMailProvider(apiKey: string, endpoint: string): EmailProvider {
  return {
    name: "zeptomail",
    delivers: true,
    async send(email, from) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            // ZeptoMail's own scheme. The token already carries its prefix in
            // some consoles, so a token supplied with it is not doubled up.
            Authorization: apiKey.startsWith("Zoho-enczapikey")
              ? apiKey
              : `Zoho-enczapikey ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            from: { address: from.address, ...(from.name ? { name: from.name } : {}) },
            to: [{ email_address: { address: email.to } }],
            subject: email.subject,
            htmlbody: email.html,
            textbody: email.text,
          }),
        })

        const raw = await res.text()
        if (!res.ok) {
          // Surface ZeptoMail's own error code where it gives one -- "TM_3201
          // sender address not verified" is actionable; "http_400" is not.
          let code = `http_${res.status}`
          try {
            const parsed = JSON.parse(raw) as { error?: { code?: string } }
            if (parsed.error?.code) code = parsed.error.code
          } catch {
            // Non-JSON error body; the status code stands.
          }
          return { ok: false, errorCode: code, errorMessage: raw.slice(0, 500) }
        }

        const parsed = JSON.parse(raw) as {
          data?: Array<{ message_id?: string }>
          request_id?: string
        } | null
        return {
          ok: true,
          providerMessageId: parsed?.data?.[0]?.message_id ?? parsed?.request_id ?? null,
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: "provider_unreachable",
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/** ZeptoMail is region-hosted; the default is the global endpoint. */
const ZEPTOMAIL_DEFAULT_ENDPOINT = "https://api.zeptomail.com/v1.1/email"

export interface ProviderSelection {
  provider: EmailProvider
  /** Non-null when the environment is misconfigured in a way that must fail loudly. */
  configurationError: string | null
}

export function selectEmailProvider(): ProviderSelection {
  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase()
  const isProduction = process.env.NODE_ENV === "production"

  if (!configured) {
    if (isProduction) {
      return {
        provider: logOnlyProvider,
        configurationError:
          "EMAIL_PROVIDER is not set in production. Refusing to silently discard outbound mail.",
      }
    }
    return { provider: logOnlyProvider, configurationError: null }
  }

  if (configured === "mailpit") {
    if (isProduction) {
      return {
        provider: logOnlyProvider,
        configurationError: "EMAIL_PROVIDER=mailpit is a local development catcher and must not be used in production.",
      }
    }
    return { provider: mailpitProvider(), configurationError: null }
  }

  if (configured === "zeptomail") {
    const key = process.env.ZEPTOMAIL_API_KEY?.trim()
    if (!key) {
      return {
        provider: logOnlyProvider,
        configurationError: "EMAIL_PROVIDER=zeptomail but ZEPTOMAIL_API_KEY is not set.",
      }
    }
    const endpoint = process.env.ZEPTOMAIL_API_URL?.trim() || ZEPTOMAIL_DEFAULT_ENDPOINT
    return { provider: zeptoMailProvider(key, endpoint), configurationError: null }
  }

  return {
    provider: logOnlyProvider,
    configurationError: `EMAIL_PROVIDER="${configured}" is not a provider this build knows how to use.`,
  }
}

/** The From address. No default sender is invented -- an unset value is a configuration error, not a guess. */
export function getFromAddress(): FromAddress | null {
  const address = process.env.EMAIL_FROM_ADDRESS?.trim()
  if (!address) return null
  const name = process.env.EMAIL_FROM_NAME?.trim()
  return { address, name: name || null }
}

/** What System Health reports. Deliberately separates "off on purpose" from "broken". */
export function describeEmailConfiguration(): {
  providerName: string
  delivers: boolean
  configurationError: string | null
  fromConfigured: boolean
} {
  const { provider, configurationError } = selectEmailProvider()
  return {
    providerName: provider.name,
    delivers: provider.delivers,
    configurationError,
    fromConfigured: getFromAddress() !== null,
  }
}
