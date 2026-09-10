# ZeptoMail production setup — operator runbook

Everything Ovalball's code needs from ZeptoMail is already built: the
adapter, the fail-closed rules, the config validator, and the Send Test
Email tool. What remains is entirely outside this repository — an account
decision in ZeptoMail's own console, DNS records in Cloudflare, and one
secret placed into Vercel. This document is that remaining checklist. It
contains no credentials, and none should ever be added to it.

## Readiness stages

Ovalball's Site Admin → Email Configuration → **Provider Status** panel
(Full Site Admin only) reports which of these stages the current deployment
has reached. None of them can be skipped, and code alone can only ever prove
the first:

| Stage | What it means | Who/what determines it |
|---|---|---|
| **CODE READY** | The adapter, fail-closed rules, config validator and Send Test Email tool exist and are tested. | This repository. Already true. |
| **DOMAIN VERIFIED** | ZeptoMail has confirmed `ovalball.co.uk` via its own DKIM + bounce/return-path CNAME records. | **Only the ZeptoMail console.** Ovalball's code cannot determine this and must never claim it from a DNS guess — see Step 5. |
| **PROVIDER CONFIGURED** | `EMAIL_PROVIDER=zeptomail` and `ZEPTOMAIL_API_KEY` are set in Vercel Production, and the deployment has picked them up. | Vercel Production environment variables, confirmed by the Provider Status panel after redeploy. |
| **LIVE SEND VERIFIED** | One real `[TEST]` email, sent through Send Test Email, was accepted by ZeptoMail and actually arrived. | Step 10–12 below, done once. |

Do not mark anything "activated" or "verified" ahead of the stage that
actually proves it.

## Step 1 — Create/open the Ovalball Transactional Agent in ZeptoMail

Sign in to the ZeptoMail console for the account that will send Ovalball's
mail. Create a Mail Agent if one does not already exist — name it something
identifiable, e.g. "Ovalball Transactional".

## Step 2 — Associate `ovalball.co.uk`

Add `ovalball.co.uk` as the Agent's sending domain.

## Step 3 — Copy the exact DKIM and bounce/return-path CNAME ZeptoMail generates

ZeptoMail generates these per account — there is no standard selector name
to look up or assume. Copy the **host** and **value** for each record
directly from the ZeptoMail console, exactly as shown, into a safe place for
Step 4. Do not abbreviate or guess at either.

## Step 4 — Add those exact records in Cloudflare DNS

Add the DKIM TXT record and the bounce/return-path CNAME exactly as
ZeptoMail generated them.

- **Do not create a second SPF record.** `ovalball.co.uk` already has one,
  for the existing Zoho Mail setup (`v=spf1 include:zoho.com
  include:one.zoho.eu include:zohomail.eu ~all`). A domain with two SPF
  records fails SPF outright. ZeptoMail no longer requires an SPF entry for
  domain verification — it verifies by DKIM and the bounce CNAME instead.
- **Leave the existing Zoho Mail SPF record untouched.**
- For any CNAME ZeptoMail asks for: set it **DNS only** in Cloudflare (grey
  cloud, not orange/proxied). A proxied CNAME breaks the verification check
  and, for a bounce domain, breaks bounce handling.
- Records can take 24–48 hours to propagate. The domain will not verify, and
  sending will not work, until they do.

## Step 5 — Return to ZeptoMail and verify the domain

Use ZeptoMail's own "Verify" action in the console. Domain verification
status lives there — nowhere in Ovalball can substitute for it, and the
Provider Status panel deliberately never claims "Verified" on its own
authority.

## Step 6 — Generate the Agent-specific Send API key

In the Agent, open **SMTP/API → API** and generate (or copy, if one already
exists) the Send Mail API key for this Agent specifically — not a
account-wide key, not an SMTP password.

## Step 7 — Set the Vercel Production environment variables

In the Ovalball Vercel project, **Production** environment:

```
EMAIL_PROVIDER=zeptomail
ZEPTOMAIL_API_KEY=<the key from Step 6>
```

`ZEPTOMAIL_API_URL` is **optional** and should be left unset unless the
ZeptoMail Agent's own SMTP/API screen states a different endpoint than the
documented global one (`https://api.zeptomail.com/v1.1/email`) — for
example, an EU or India data-centre account. **Do not guess this from
anything else Ovalball uses**, including the existing Zoho Mail MX records —
Zoho Mail's region and the ZeptoMail Agent's API region are two separate
account decisions and one cannot be inferred from the other. If the Agent's
own console names a specific endpoint, copy it verbatim into
`ZEPTOMAIL_API_URL`; otherwise leave it unset and the documented default is
used.

Never place this key in `.env.local`, in a Preview environment variable, or
anywhere in this repository. Vercel's Production environment is the only
place it should exist.

## Step 8 — Confirm production From/Reply-To configuration

Also in Vercel Production, confirm (or set) the transactional identity:

```
EMAIL_FROM_ADDRESS=no-reply@ovalball.co.uk
EMAIL_FROM_NAME=Ovalball
EMAIL_REPLY_TO_ADDRESS=hello@ovalball.co.uk
EMAIL_REPLY_TO_NAME=Ovalball Support
NEXT_PUBLIC_SITE_URL=https://ovalball.co.uk
```

`EMAIL_FROM_ADDRESS` must be a sender ZeptoMail has verified for
`ovalball.co.uk` (Steps 1–5) or the provider will reject every send. The
Provider Status panel flags when the configured identity does not match
this canonical set, as a safety check against an accidental `.test` address
or a mistyped domain reaching production.

## Step 9 — Redeploy Production

Vercel only injects newly-set environment variables into a running
deployment on the next build. Trigger a Production redeploy so the runtime
actually has `EMAIL_PROVIDER`, `ZEPTOMAIL_API_KEY` and the identity
variables from Steps 7–8.

After the redeploy, the Provider Status panel (Site Admin → Email
Configuration, Full Site Admin) should show:

- Provider: **ZeptoMail**
- Environment: **Production**
- API credential: **Configured**
- Provider endpoint: the effective URL that will be used
- From address / Reply-To: the values from Step 8

Domain verification still reads "Requires external verification" — that is
correct and expected; it only changes in the ZeptoMail console (Step 5), and
this panel is not the place that decides it.

## Step 10 — Send one test email

As a Full Site Admin: **Email Configuration → any template → Send Test
Email**, to an address you control.

## Step 11 — Verify the received email

Check, in the actual received message:

- Subject carries the **`[TEST]`** prefix.
- The Ovalball From identity (`Ovalball <no-reply@ovalball.co.uk>`).
- Reply-To (`Ovalball Support <hello@ovalball.co.uk>`), if your mail client
  shows it.
- The Ovalball logo renders, and a club crest if the template includes one.
- Both the HTML view and the **plain-text view** (most clients let you
  switch, or check the raw source) show the test disclosure banner.
- The CTA button points at `https://ovalball.co.uk/...` — never anything
  else.
- Check the message's own authentication results (most mail clients expose
  "show original" or similar): **SPF**, **DKIM**, and **DMARC** (where your
  domain has one configured) should all show as passing for this message.

## Step 12 — Mark external activation VERIFIED

Only once Step 11 is fully confirmed, external ZeptoMail activation for
Ovalball can be considered verified. Before that point, nothing in this
codebase should claim it — code readiness and external activation are
different questions, and only this step answers the second one.

---

## Preview environment — deliberately not activated

Ovalball's Vercel **Preview** environment does not send through ZeptoMail,
even if `EMAIL_PROVIDER=zeptomail` were set there by mistake — the provider
selection code refuses it explicitly (`lib/email/provider.ts`), because
Preview does not yet have an isolated email policy (real recipient data
reachable from a preview branch, no separate rate limiting, no separate
credential). Production activation does not require, and must not be
gated on, deciding a Preview policy. That is a deliberate, separate decision
for later.

## Supabase — no provider credential lives there

The ZeptoMail API key belongs in Vercel's server environment only. Supabase
holds only application data that is safe to store there: the email
template registry (`email_template_versions`, `email_template_settings`),
the delivery ledger (`email_deliveries`), and audit state. Nothing in
Supabase needs, or should ever be given, a ZeptoMail credential.
