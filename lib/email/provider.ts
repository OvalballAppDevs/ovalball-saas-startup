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

/** Where a human reply goes. Same shape as a sender; a different job. */
export type ReplyToAddress = FromAddress

/**
 * Who a message is from, and where a reply to it should land.
 *
 * These travel together because they are one decision. The From address is a
 * verified sending identity the provider will accept; Reply-To is the mailbox
 * a person actually reaches when they hit reply. Keeping them in one object
 * means no call site can set one and forget the other.
 *
 * Both come from server configuration. There is deliberately no way for a
 * feature -- still less a browser request -- to name its own Reply-To: an
 * arbitrary reply address redirects a real person's response, and the same
 * reasoning that removed `to` from this pipeline applies to it.
 */
export interface SenderIdentity {
  from: FromAddress
  replyTo: ReplyToAddress | null
}

export type ProviderResult =
  | {
      ok: true
      /**
       * The provider's reference for the ACCEPTED REQUEST -- not a message id.
       *
       * ZeptoMail's send endpoint returns `request_id` and no per-message
       * identifier, so this is what an operator quotes to Zoho support when a
       * club says a message never arrived. Calling it a message id would
       * invite them to look up something that does not exist.
       */
      providerReference: string | null
    }
  | { ok: false; errorCode: string; errorMessage: string }

export interface EmailProvider {
  readonly name: string
  /** False when this provider deliberately does not deliver (log-only). */
  readonly delivers: boolean
  send(email: OutboundEmail, sender: SenderIdentity): Promise<ProviderResult>
}

const logOnlyProvider: EmailProvider = {
  name: "log-only",
  delivers: false,
  async send(email) {
    // The subject and recipient only. Bodies can carry a safeguarding message
    // or a support reply, and a developer's terminal scrollback is not an
    // appropriate home for either.
    console.log(`[email:log-only] to=${email.to} subject="${email.subject}"`)
    return { ok: true, providerReference: null }
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
    async send(email, sender) {
      try {
        const res = await fetch(`${base}/api/v1/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: { Email: sender.from.address, Name: sender.from.name ?? undefined },
            To: [{ Email: email.to }],
            // Carried locally too, so a developer sees the header a real
            // recipient would get rather than discovering it in production.
            ...(sender.replyTo
              ? { ReplyTo: [{ Email: sender.replyTo.address, Name: sender.replyTo.name ?? undefined }] }
              : {}),
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
          }),
        })
        if (!res.ok) {
          return { ok: false, errorCode: `http_${res.status}`, errorMessage: await res.text() }
        }
        const body = (await res.json().catch(() => null)) as { ID?: string } | null
        return { ok: true, providerReference: body?.ID ?? null }
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
    async send(email, sender) {
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
            from: { address: sender.from.address, ...(sender.from.name ? { name: sender.from.name } : {}) },
            to: [{ email_address: { address: email.to } }],
            // reply_to is an ARRAY of {address, name} in ZeptoMail's own API
            // example -- a different shape from `to`, which nests the address
            // inside email_address. Omitted entirely when unconfigured rather
            // than sent empty: an empty array is a value, and providers are
            // entitled to reject one.
            ...(sender.replyTo
              ? {
                  reply_to: [
                    {
                      address: sender.replyTo.address,
                      ...(sender.replyTo.name ? { name: sender.replyTo.name } : {}),
                    },
                  ],
                }
              : {}),
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

        // ZeptoMail's documented success body is
        //   { data: [{ code, additional_info, message }], message, request_id, object }
        // There is NO per-message identifier in it. This previously read
        // `data[0].message_id` first -- a field the API does not return -- and
        // fell through to request_id every time, so the ledger has always in
        // fact held a request reference under a column that claimed otherwise.
        // Only the documented field is read now, and it is named for what it is.
        const parsed = JSON.parse(raw) as { request_id?: string } | null
        return { ok: true, providerReference: parsed?.request_id ?? null }
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

/**
 * Where replies to Ovalball's transactional mail go.
 *
 * From and Reply-To are deliberately separate settings. The From address has
 * to be a sender ZeptoMail has verified for the domain, which is a delivery
 * constraint; Reply-To is a monitored human mailbox, which is a product one.
 * Tying them together would mean either mailing from an address nobody reads
 * or being unable to send at all.
 *
 * Unset is a legitimate state and is NOT an error: mail still goes out, it
 * simply carries no reply address, exactly as it did before this existed. An
 * unmonitored inbox is worse than none, so this is opt-in configuration rather
 * than a default address invented here.
 */
export function getReplyToAddress(): ReplyToAddress | null {
  const address = process.env.EMAIL_REPLY_TO_ADDRESS?.trim()
  if (!address) return null
  const name = process.env.EMAIL_REPLY_TO_NAME?.trim()
  return { address, name: name || null }
}

/**
 * The complete sender identity for every transactional message.
 *
 * One place resolves it, so no event sender chooses its own -- which is the
 * point: a per-feature Reply-To is how a reply to a safeguarding email ends up
 * somewhere it should not.
 */
export function getSenderIdentity(): SenderIdentity | null {
  const from = getFromAddress()
  if (!from) return null
  return { from, replyTo: getReplyToAddress() }
}

/** What System Health reports. Deliberately separates "off on purpose" from "broken". */
export function describeEmailConfiguration(): {
  providerName: string
  delivers: boolean
  configurationError: string | null
  fromConfigured: boolean
  /** Whether replies reach a mailbox. Not an error when false -- see getReplyToAddress. */
  replyToConfigured: boolean
} {
  const { provider, configurationError } = selectEmailProvider()
  return {
    providerName: provider.name,
    delivers: provider.delivers,
    configurationError,
    fromConfigured: getFromAddress() !== null,
    replyToConfigured: getReplyToAddress() !== null,
  }
}
