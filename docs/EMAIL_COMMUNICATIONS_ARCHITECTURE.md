# Ovalball Email Communications Architecture

The single source of truth for what Ovalball emails, to whom, and under what
policy. Policy decisions live here and in `public.email_events` — never
scattered through React components.

---

## 1. The pipeline

```
domain event
  → email policy            (classification + notification_topics preference)
  → recipient resolution    (SERVER-SIDE, from a canonical record)
  → Ovalball template       (HTML + hand-written plain text)
  → provider adapter        (lib/email/provider.ts)
  → Zoho ZeptoMail
  → delivery status / audit (public.email_deliveries)
```

Nothing above the adapter knows the product sends through Zoho. Swapping
sender is a change to `lib/email/provider.ts` and nowhere else.

## 2. What already existed, and was NOT rebuilt

The product already had the canonical notification architecture, and it
already contained the email policy layer:

| Table | Role |
|---|---|
| `notification_topics` | 8 topics, each with `mandatory`, `email_ready`, `push_ready` |
| `notification_types` | 40 in-app domain events, each mapped to a topic |
| `notification_preferences` | per user, per topic: `in_app_enabled`, `email_enabled` |

`mandatory` is already "cannot be turned off". `email_enabled` is already the
consent record. `email_ready` already existed to say whether a topic has a
real implementation behind it — and was correctly `false` everywhere, because
nothing could send.

**No second notification system, preference store, or definition of
"mandatory" was created.** Two things were genuinely missing and were added:
a catalogue of the email events themselves (`email_events`) and a delivery
ledger (`email_deliveries`).

## 3. Classification

Every email event states, once, which of three kinds it is. The policy engine
reads only this — never a flag a caller passes.

| Classification | Preference consulted? | Why |
|---|---|---|
| `TRANSACTIONAL_IDENTITY` | No | The recipient has no Ovalball account. No preference row can exist, so none is invented. Invitations and the safeguarding fallback. |
| `MANDATORY_OPERATIONAL` | No | Operational mail a club cannot opt out of and still be safely run. |
| `OPTIONAL_OPERATIONAL` | Yes | Honours `notification_preferences.email_enabled` for its topic. |

**Marketing is not in this pipeline.** ZeptoMail is a transactional sender and
is used as one. Bulk campaigns are a different policy domain with different
consent rules and belong in Zoho Campaigns; a regression test asserts no
`MARKETING` classification exists here. Turning a transactional sender into a
mass-mail tool is how a product ends up mailing people who never agreed to
hear from it.

A database CHECK enforces the identity rule: an identity event **must not**
name a topic, and a topic-scoped event **must**.

## 4. The event matrix

| Event key | Domain | Trigger | Recipient source | In-app? | Email? | Classification | Template | Wired | Provider | Ledger |
|---|---|---|---|---|---|---|---|---|---|---|
| `club_invitation` | Access | `createInvitation` | `invitations.invited_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `guardian_invitation` | Youth | `sendReplacementGuardianInvitation` | `guardian_invitations.invited_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `player_account_invitation` | Youth | `invitePlayerAccount` | `player_account_invitations.invited_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `safeguarding_officer_invitation` | Safeguarding | invite / resend | `club_safeguarding_officers.contact_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `safeguarding_officer_message` | Safeguarding | `messageSafeguardingOfficer` fallback | `club_safeguarding_officers.contact_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `site_admin_invitation` | Access | `inviteSiteAdmin` | `site_admin_invitations.invited_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `partner_club_invitation` | Referral | `createPartnerInvitation` | `club_ovalball_invitations.contact_email` | — | ✅ | IDENTITY | ✅ | ✅ | adapter | ✅ |
| `club_claim_submitted` | Access | `completeSignupIfNeeded` | `SITE_ADMIN_NOTIFICATION_EMAIL` | ✅ trigger | ✅ | MANDATORY (`access_invitations`) | ✅ | ✅ | adapter | ✅ |
| `support_ticket_reply` | Support | `sendSupportReply` / status change | `support_tickets.contact_email`, public origin only | n/a (no account) | ✅ | MANDATORY (`support_moderation`) | ✅ | ✅ | adapter | ✅ |
| `referral_reward_earned` | Commercial | `qualify_referral_for_payment` | Club's active Club Admins | ✅ existing | ✅ | MANDATORY (`platform_billing`) | ✅ | template ready, trigger not wired — see §11 | adapter | ✅ |

### Audited and deliberately NOT emailed

Not every domain event should generate email. These have working in-app
notifications and adding email was rejected rather than deferred:

| Event family | In-app types | Why no email |
|---|---|---|
| Fixture requests / updates | 9 + 9 types | Every recipient is an account holder reading the app. Email here is high-volume noise; it belongs behind an `OPTIONAL_OPERATIONAL` preference, which is a product decision, not an implementation one. |
| Training created/changed/cancelled | 3 types | Same. Also the highest-frequency events in the product. |
| Calendar sharing | 2 types | Low-stakes and in-app. |
| Messages | 3 types | Emailing message contents duplicates the conversation and leaks it to an inbox. |
| Tournament lifecycle | 5 types | Account holders. |
| Site Admin access changes | 7 types | `account_security` is mandatory in-app; those recipients are, by definition, signed in. |
| Trial ending / ended | 2 types | Genuinely wants email. Not wired because it needs a scheduled job, which does not exist yet — see §11. |
| Dispensation, attendance, season handover | — | No canonical notification types exist for these yet. Nothing was invented to fill the table. |

## 5. Recipient security

**There is no `to` parameter anywhere in this system.** A caller names an
ENTITY it is already authorized to act on; `lib/email/recipients.ts` reads that
entity's canonical contact **through the caller's own Supabase session**, so
RLS applies and a caller who cannot see the record cannot mail it.

This is the shape that allowed the safeguarding open-relay bug: an action took
an officer id, swallowed the database's refusal, and mailed the caller's own
text to an address the caller supplied — reporting success. That was fixed in
that one action; removing `to` from the dispatcher removes the shape.

An invitation address IS legitimately chosen by the inviter — that is what
inviting means. But it is chosen when the invitation ROW is created, under
that RPC's authorization, and read back from the row. The email cannot be
aimed anywhere the invitation is not.

`recipient_kind` is a CHECK-constrained vocabulary on `email_events`, so
"who receives this" is a property of the event, decided once, not an argument.

## 6. Delivery lifecycle and idempotency

`email_deliveries` holds one row per logical occurrence per recipient.

```
queued → sending → sent
                 → failed      (provider error code + message retained)
                 → suppressed  (must record why)
```

**A domain event succeeding is not proof an email was delivered.** The ledger
is where that question is answered, and System Health reads it.

`claim_email_delivery()` claims the idempotency key and returns an id, or NULL
if the occurrence is already recorded. The caller sends only when it gets an
id, which makes retry-safety structural rather than a convention every call
site must remember.

Keys are built from the **entity**, never a timestamp:

| Event | Key | Why |
|---|---|---|
| Invitations | `<event>:<invitation_id>` | One invitation row, one email. A resend creates a new row and so is a new occurrence. |
| Support reply | `support_ticket_reply:<event_id>` | The occurrence is the REPLY. Keying on the ticket would deliver the first reply and silently swallow every later one. |
| Safeguarding message | `<officer_id>:<message fingerprint>` | A double-submitted form does not send twice; a genuinely different message always does. |

Suppression must never swallow a legitimate later event. A regression test
asserts a different occurrence still sends.

## 7. Provider

| `EMAIL_PROVIDER` | Behaviour |
|---|---|
| unset | Log-only. Nothing leaves the machine. **Production refuses to run this** rather than silently discard mail. |
| `mailpit` | Local catcher (Supabase runs one on 54324). Refused in production. |
| `zeptomail` | Zoho ZeptoMail REST Send API. |

ZeptoMail's REST API is used rather than SMTP because it returns a structured
per-message id and a machine-readable error code — which is what the ledger
needs. SMTP would give a `250` and a text blob. ZeptoMail's own error codes
are preserved (`TM_3201 sender address not verified` is actionable; `http_400`
is not).

### Required server-side environment

Every one is server-only. **None is `NEXT_PUBLIC_*`**, so none can reach a
browser bundle. Documented in `.env.example`; no credential is hardcoded.

| Variable | Purpose |
|---|---|
| `EMAIL_PROVIDER` | `mailpit` \| `zeptomail`; unset = log-only |
| `ZEPTOMAIL_API_KEY` | ZeptoMail "Send Mail" token, with or without its `Zoho-enczapikey ` prefix |
| `ZEPTOMAIL_API_URL` | Only for a non-global (EU/IN) data centre |
| `EMAIL_FROM_ADDRESS` | Must be a ZeptoMail-verified domain. No default is invented |
| `EMAIL_FROM_NAME` | Optional display name |
| `SITE_ADMIN_NOTIFICATION_EMAIL` | Where club-claim due-diligence mail goes |

Zoho Mail is the right home for human mailboxes (support@, admin@); this
pipeline sends application-generated mail only.

## 8. Templates and plain text

`lib/email/design/components.ts` is the design system: table-based layout,
inline styles, no external CSS, no web fonts, no JavaScript, no SVG. Email
clients are not browsers, and fighting that produces mail that looks broken
for a large minority of real recipients. Primitives: wordmark header, content
container, heading, body, muted body, quoted body, info card, club identity
(crest optional), bulletproof CTA, CTA fallback, status note, divider, support
block, legal footer.

**Plain text is written, not stripped.** Every template composes its own
`text`. A tag-stripper produces something technically present and practically
useless — buttons become bare words with the destination lost. A regression
test asserts every email whose HTML contains a link also spells that URL out
in the text, and that no generated markup appears in the text.

Author-supplied content (a safeguarding message, a support reply) is escaped
and rendered as text, never as HTML.

## 9. Youth and privacy

The guardian invitation carries **no child identifying detail** — no name,
date of birth, medical or attendance information. It says a club has invited
you and links to a login. A regression test asserts this.

The club-claim notification carries no claimant email; a Site Admin opens the
claim to see contact detail under the app's own authorization, rather than
having personal data copied into an operations inbox.

The ledger stores recipient address and subject for operator triage. It
deliberately **does not store message bodies** — structured event data plus
the template reconstructs what was sent without retaining recipient content
indefinitely.

## 10. Links

Every CTA is built from `getSiteUrl()` — the canonical origin resolver that
fails closed in production. `safeUrl()` re-checks that the destination is
this origin and drops anything else, so a template can never emit an open
redirect out of a trusted email. Templates receive a token or a path, never a
destination. Invitation tokens keep their existing expiry and single-use
semantics; email is a transport for them, not a second issuer.

## 11. Genuine remaining gaps

Stated rather than quietly deferred:

- **`referral_reward_earned` is not yet triggered.** The template, recipient
  resolver, classification and ledger entry all exist and are tested, but
  `internal.qualify_referral_for_payment` currently raises only the in-app
  notification. Wiring it means calling out of a SQL function into the app
  layer, which this codebase has no pattern for — it needs either an outbox
  the app drains or a webhook, and choosing between those is an architecture
  decision, not a detail.
- **Trial ending / ended** wants email and cannot have it without a scheduled
  job. `platform_trial_ending_soon` exists in-app.
- **No retry worker.** A `failed` delivery is recorded and visible in System
  Health, but nothing re-attempts it. `attempts` exists for when one is built.
- **No provider webhook.** ZeptoMail can report bounces and opens; nothing
  consumes them, so `sent` means "the provider accepted it", not "it arrived".
  The column names are honest about this.
- **Fixture and training email** is an open product decision (§4), not an
  implementation gap.
