import "server-only"

import { getSiteUrlForMetadata } from "@/lib/site-url"

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

/**
 * ZeptoMail's documented global Send API endpoint.
 *
 * This is NOT a guess at which data centre an Ovalball ZeptoMail account
 * lives in -- that is chosen when the account/Agent is created and is only
 * knowable from the ZeptoMail console, never inferred from anything else
 * Ovalball has configured. In particular, Zoho Mail's MX region
 * (`mx.zoho.eu`, from the pre-existing `ovalball.co.uk` mailboxes) says
 * nothing about which ZeptoMail data centre the transactional Agent uses --
 * they are two independent decisions, and this file must never treat one as
 * evidence for the other. If the account genuinely needs a regional
 * endpoint, ZEPTOMAIL_API_URL exists precisely so that never has to be
 * guessed: the value is copied verbatim from the ZeptoMail Agent's own
 * SMTP/API screen. See docs/ZEPTOMAIL_PRODUCTION_SETUP.md.
 */
const ZEPTOMAIL_DEFAULT_ENDPOINT = "https://api.zeptomail.com/v1.1/email"

type EndpointResolution = { ok: true; endpoint: string } | { ok: false; error: string }

/**
 * A malformed or non-HTTPS ZEPTOMAIL_API_URL must refuse to deliver rather
 * than hand an API key to whatever that string turns out to be. This is the
 * same class of check getSiteUrl() already applies to its own origin, for
 * the same reason: a configuration value that reaches an outbound request
 * deserves the same scrutiny as one that reaches a browser.
 */
function resolveZeptoMailEndpoint(): EndpointResolution {
  const configured = process.env.ZEPTOMAIL_API_URL?.trim()
  if (!configured) return { ok: true, endpoint: ZEPTOMAIL_DEFAULT_ENDPOINT }

  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    return { ok: false, error: "ZEPTOMAIL_API_URL is not a valid absolute URL." }
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "ZEPTOMAIL_API_URL must be an HTTPS URL." }
  }
  return { ok: true, endpoint: parsed.toString() }
}

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
    // Preview deployments run with NODE_ENV=production (Next treats every
    // Vercel build that way), so the production checks above cannot tell a
    // preview URL from the real site. VERCEL_ENV can: it is only ever set by
    // Vercel's own runtime, never by a developer's shell, so this has no
    // effect on `next dev` or a local `next build`. Preview has no isolated
    // email policy of its own yet -- see docs/ZEPTOMAIL_PRODUCTION_SETUP.md
    // -- so ZeptoMail is refused there even if someone sets the variable,
    // rather than quietly mailing real addresses from a preview branch.
    if (process.env.VERCEL_ENV === "preview") {
      return {
        provider: logOnlyProvider,
        configurationError:
          "EMAIL_PROVIDER=zeptomail is refused in Preview. Preview has no isolated email policy yet -- see docs/ZEPTOMAIL_PRODUCTION_SETUP.md.",
      }
    }

    const key = process.env.ZEPTOMAIL_API_KEY?.trim()
    if (!key) {
      return {
        provider: logOnlyProvider,
        configurationError: "EMAIL_PROVIDER=zeptomail but ZEPTOMAIL_API_KEY is not set.",
      }
    }

    const endpointResult = resolveZeptoMailEndpoint()
    if (!endpointResult.ok) {
      return { provider: logOnlyProvider, configurationError: endpointResult.error }
    }

    return { provider: zeptoMailProvider(key, endpointResult.endpoint), configurationError: null }
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

/**
 * Ovalball's intended production transactional identity.
 *
 * Not a fallback and not enforced by getFromAddress()/getReplyToAddress() --
 * this file still invents no default sender, for the reason those functions
 * already give: a guessed address is a worse failure than a visible one.
 * This exists only so describeEmailConfiguration() can flag when what is
 * actually configured has drifted from what production is supposed to be --
 * a Site Admin seeing "no-reply@ovalball.test" active in what is meant to be
 * the production deployment is the kind of mistake this is built to catch.
 */
const CANONICAL_PRODUCTION_IDENTITY = {
  fromAddress: "no-reply@ovalball.co.uk",
  fromName: "Ovalball",
  replyToAddress: "hello@ovalball.co.uk",
  replyToName: "Ovalball Support",
  siteUrl: "https://ovalball.co.uk",
} as const

/**
 * THE one canonical, server-only ZeptoMail/email configuration validator.
 *
 * Every surface that needs to answer "is production email actually ready" --
 * System Health, the Email Configuration provider status panel, this
 * session's own live-verification passes -- reads it from here and nowhere
 * else, so there is exactly one place that knows how to interpret the
 * environment.
 *
 * WHAT THIS NEVER DOES, BY CONSTRUCTION
 * --------------------------------------
 * It never returns ZEPTOMAIL_API_KEY, in any form -- only whether one is
 * set. It never puts a secret into configurationError's text (every error
 * string above is a fixed sentence naming a variable, never a value). And
 * this whole module is `server-only`, so none of it can reach a browser
 * bundle regardless of what a caller does with the result.
 *
 * WHAT "DOMAIN VERIFICATION" DELIBERATELY DOES NOT APPEAR HERE
 * --------------------------------------------------------------
 * ZeptoMail domain verification is decided by ZeptoMail, from DKIM and
 * bounce/return-path CNAME records generated per account and copied from
 * ITS console -- there is no selector name stable enough to look up, and no
 * DNS query this function could run would be authoritative. A caller that
 * wants to show verification status must say, plainly, that it requires
 * checking the ZeptoMail console -- never compute or guess it here.
 */
export function describeEmailConfiguration(): {
  providerName: string
  delivers: boolean
  configurationError: string | null
  environment: "production" | "preview" | "development"
  /** Whether an outbound send in this environment would actually reach ZeptoMail. */
  apiKeyConfigured: boolean
  /** Whether ZEPTOMAIL_API_URL was explicitly set, as opposed to using the documented default. */
  apiUrlConfigured: boolean
  /** The endpoint that would actually be used if the provider is zeptomail. Not a secret -- an API host, not a key. Null for every other provider. */
  apiUrlEffective: string | null
  fromConfigured: boolean
  fromAddress: string | null
  fromName: string | null
  /** Whether replies reach a mailbox. Not an error when false -- see getReplyToAddress. */
  replyToConfigured: boolean
  replyToAddress: string | null
  replyToName: string | null
  siteUrl: string | null
  /** True only when provider is zeptomail AND From/Reply-To/Site all match Ovalball's intended production identity exactly. */
  identityMatchesCanonicalProduction: boolean
} {
  const { provider, configurationError } = selectEmailProvider()
  const from = getFromAddress()
  const replyTo = getReplyToAddress()
  const siteUrl = getSiteUrlForMetadata()

  const environment: "production" | "preview" | "development" =
    process.env.VERCEL_ENV === "preview"
      ? "preview"
      : process.env.NODE_ENV === "production"
        ? "production"
        : "development"

  const endpointResult = resolveZeptoMailEndpoint()

  const identityMatchesCanonicalProduction =
    provider.name === "zeptomail" &&
    from?.address === CANONICAL_PRODUCTION_IDENTITY.fromAddress &&
    (from?.name ?? null) === CANONICAL_PRODUCTION_IDENTITY.fromName &&
    replyTo?.address === CANONICAL_PRODUCTION_IDENTITY.replyToAddress &&
    (replyTo?.name ?? null) === CANONICAL_PRODUCTION_IDENTITY.replyToName &&
    siteUrl === CANONICAL_PRODUCTION_IDENTITY.siteUrl

  return {
    providerName: provider.name,
    delivers: provider.delivers,
    configurationError,
    environment,
    apiKeyConfigured: (process.env.ZEPTOMAIL_API_KEY?.trim().length ?? 0) > 0,
    apiUrlConfigured: (process.env.ZEPTOMAIL_API_URL?.trim().length ?? 0) > 0,
    apiUrlEffective: provider.name === "zeptomail" && endpointResult.ok ? endpointResult.endpoint : null,
    fromConfigured: from !== null,
    fromAddress: from?.address ?? null,
    fromName: from?.name ?? null,
    replyToConfigured: replyTo !== null,
    replyToAddress: replyTo?.address ?? null,
    replyToName: replyTo?.name ?? null,
    siteUrl,
    identityMatchesCanonicalProduction,
  }
}
