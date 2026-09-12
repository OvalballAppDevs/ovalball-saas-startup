# Browser verification

Acceptance evidence that the Chrome extension cannot produce.

Two things are structurally impossible through the extension, and both are
required to accept Communications work:

- **Exact mobile viewports.** The extension resizes a real macOS window, and
  macOS enforces a minimum window width, so a requested 320px silently comes
  back as roughly desktop width. Any overflow measurement taken that way is a
  false pass. Playwright sets the CSS viewport directly, so `innerWidth`
  genuinely reports 320 / 360 / 390 / 430.
- **Two independent authenticated users.** The extension drives one browser
  profile, so "A sends, B receives without refreshing" cannot be expressed in
  it at all. Each Playwright browser *context* has its own cookie jar, which
  is what makes two genuinely separate sessions possible.

## Running

Requires the local stack up: the dev server on `:3000`, Supabase on `:54321`
and the Mailpit catcher on `:54324`.

`playwright-core` is **not** a project dependency — this is ad-hoc
verification tooling, not part of the build. Install it wherever you are
running from, then point the scripts at the Chromium that is already in the
Playwright cache:

```bash
npm install playwright-core axe-core          # in a scratch directory
node scripts/browser-verification/00-harness-validation.mjs
```

**`NODE_PATH` will not work here.** These scripts are ES modules, and ESM
resolution ignores `NODE_PATH` entirely — `node` fails with
`ERR_MODULE_NOT_FOUND` for `playwright-core` no matter what that variable
says. Link the scratch install into this project's `node_modules` instead,
which is not tracked by git and so pollutes nothing:

```bash
ln -sfn /path/to/scratch/node_modules/playwright-core node_modules/playwright-core
```

`axe-core` is already a project dependency and needs no link — the scripts
read `node_modules/axe-core/axe.min.js` directly.

`harness.mjs` resolves the browser at
`~/Library/Caches/ms-playwright/chromium-1187`. Override `APP_URL` or
`MAILPIT_URL` if your ports differ.

## Run the harness gate first

`00-harness-validation.mjs` proves the *mechanism* before any product claim:
that the two contexts really hold different users (read from `/account`, not
from a cookie), that clearing one does not sign the other out, and that each
requested viewport reports itself from inside the page.

This matters for honesty as much as for correctness. When a later check
fails, the gate is what lets you say whether the product broke or the harness
did — a harness failure must never be recorded as either a pass or a product
defect.

## Authentication

Sign-in goes through the real product path: the login form is submitted so
the **server** mints the magic link (which is what sets the PKCE verifier
cookie in that browser context), and the link is then read out of the local
Mailpit catcher. Fetching a link out of band and opening it in a fresh
context fails, correctly.

No password is typed or stored, and no cookie is ever fabricated. The email
field is filled with real key events and the typed value is asserted before
submitting, because assigning `.value` on a React-controlled input leaves the
component holding whatever the browser autofilled.

## The scripts

| Script | Proves |
|---|---|
| `00-harness-validation.mjs` | the harness itself (run this first) |
| `01-direct-realtime.mjs` | a direct message arrives live, both directions, no refresh |
| `02-candidates.mjs` | who is offered as a message candidate, and who must not be |
| `03-u18-bypass.mjs` | the server refuses what the UI does not offer |
| `04-policy.mjs` | Club and Ovalball precedence, in the UI and in the server |
| `05-block-unread.mjs` | block, unblock, report, soft delete, unread separation |
| `06-mobile.mjs` | exact 320 / 360 / 390 / 430 with no horizontal overflow |
| `07-accessibility.mjs` | axe, keyboard operation, focus containment and return |
| `08-announcement-realtime.mjs` | an announcement reply arrives live on its own channel |

Several take a conversation id: `CONV_ID=<uuid> node …/06-mobile.mjs`.

## A note on realtime

A private realtime topic is authorised by the token given to
`realtime.setAuth()`, **not** by the REST `Authorization` header and not by
the cookie session alone. Subscribing before the browser client has restored
its session joins an anonymous socket, RLS refuses it, and the channel
settles in `CLOSED` without raising anything. Both the product hook and
`08-announcement-realtime.mjs` resolve the session first for that reason.
