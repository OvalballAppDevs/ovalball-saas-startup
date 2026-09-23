# Ovalball Mobile — Architecture

The decisions this foundation made, and why. Written to be built against.

## Where the code lives, and why web did not move

```
ovalball-saas-startup/
  app/ lib/ components/ …     the Next.js product, untouched at the repository root
  packages/contracts/         platform-neutral domain code BOTH clients compile from source
  apps/mobile/                the Expo app, with its own node_modules
```

`apps/web` **does not exist**. Moving the Next.js app into it means rewriting every `@/` import, the
test loader, the SQL and browser suite registries, the perimeter manifest's ~200 consumer paths and
every script that names `app/(app)/…` — and it would collide head-on with the Team Operations work
that is mid-flight. The brief's own escape hatch applies: introduce mobile in the least disruptive
place. `apps/mobile` keeps the monorepo shape available for later without pretending it arrived.

Root `tsconfig.json` excludes `apps/**` so the website's compiler never tries to typecheck React
Native, and Metro blocks the root `node_modules` so `next` and a second React never reach a native
bundle.

## The shared package

`packages/contracts` holds code that was already correct on the web and was unreachable from React
Native **only because the file said `import "server-only"`** — a bundling directive, not a secrecy
one. Nothing was rewritten. The modules moved, and `lib/` re-exports them, so every existing web
import path resolves to the same implementation.

| module | what it answers |
|---|---|
| `session-context` | who is signed in, and every relationship they hold |
| `active-context-rules` | which contexts they may operate as, and which is selected |
| `club-logo` | which stored path is a club's crest — **no kit, ever** |
| `personal-avatar` | a person's own picture, from the private `avatars` bucket |
| `governing-body`, `governing-roles`, `role-labels`, `age-state` | the labels and rules those need |

Guarded by `supabase/tests/js/shared_contracts.test.mts`: nothing here may import `next/*`, `react`,
`react-native`, a Node built-in, `server-only` or `@/…`; nothing may read `process.env`; nothing may
decide a capability; and each moved web file must still be a re-export rather than a second copy.

## The boundary: what mobile may decide

**Nothing that matters.** The client renders, navigates, collects input, asks for actions and caches
safe presentation data. The platform decides identity, membership, which contexts exist, capabilities,
fixture authority, age compatibility, family authority, invitation authority, payment truth and
safeguarding access.

Selecting a context changes **what is shown and what is asked for**. It confers nothing. There is no
`if (context.kind === "team") canEdit = true` anywhere, and `mobile_foundation.test.mts` fails if one
appears.

## API boundary, per operation

| operation | route | why |
|---|---|---|
| sign in, MFA, sign out | `supabase.auth` | the canonical auth server; the same calls the website makes |
| session context (memberships, teams, guardians, players, site admin) | direct table reads + `my_governing_bodies` / `my_site_capabilities` RPCs, via the shared reader | RLS is the boundary and already decides every row; this is the website's own reader |
| club crest | `clubs` read + `storage.getPublicUrl` | public bucket, canonical resolver |
| personal avatar | `storage.createSignedUrl` on the private `avatars` bucket | the bucket's policy decides who may see a minor's picture; a URL the viewer may not have simply does not mint |
| next fixture (Home) | direct `fixtures` read, scoped to one team | RLS decides the rows; **interim** — see the debt below |
| capabilities | **not read yet** | nothing in this build gates an action; when one does it goes through an RPC, never a local rule |

Only the publishable (anon) key is bundled. No service role, no provider secret, no pepper.

## The shell

**Launch.** Native splash (forest `#071C14`, the app's own generated mark) → `LaunchCanvas`, the same
colour and the same mark in React → the destination. Nothing in the stack is white, so the handoff has
no colour to change; the canvas fades in 220ms the moment the session's status is known, and unmounts
after it, `pointerEvents="none"` and hidden from assistive tech while it goes. There is no minimum
display time: a fixed logo duration is a cost charged to somebody checking a kick-off time.

**Header** — one row: the person's avatar, the context as the tappable thing (widest target, with a
chevron), notifications. Not the sidebar's identity block, which has a column to spend and this does
not.

**Bottom bar** — five cells, drawn by Ovalball rather than by the library, because the library's own
label slot clipped the word on a bar this height while leaving it in the accessibility tree. Home,
Fixtures, Calendar and Rugby Hub are in the same position for everybody; the fifth is Subscriptions
for somebody the **server** says holds `finance.subscription.view` at team scope, and More for
everyone else. Cells are 46pt, the home indicator's height is added rather than absorbed, and the
active state is three signals — a pitch-green rule, a heavier glyph stroke, a heavier label — never
colour alone. `projectTabs` is a pure function so the projection can be asserted rather than
inspected.

**Context sheet** — a real bottom sheet: spring in, drag to dismiss, the page still visible behind it.
The person is named first, then their rugby, from `listSwitchableContexts`.

**Icons** — Lucide, the website's own family, so a calendar is the same calendar on both clients. The
one exception is Fixtures: Lucide has no rugby ball, and a trophy or a flag says something Ovalball
does not mean, so it draws the brand's own oval.

## Navigation

`expo-router`, file-based, with one gate in `app/_layout.tsx` that maps session status to a place:
`restoring` → brand hold, `needs-mfa` → `/verify`, `signed-out` → `/sign-in`, `signed-in` →
`/(tabs)`. No screen decides its own access, so no screen can be the one that forgets.

Bottom bar: Home · Fixtures · Calendar · Rugby Hub · More. Not the desktop sidebar compressed — the
website's grouped disclosure is a shape for a pointer.

## Deep links

Scheme per environment (`ovalball`, `ovalball-dev`, `ovalball-staging`) plus expo-router's own URL
mapping, so any route is addressable now and a link resolves to a ROUTE rather than to React state.
Nothing beyond that is wired: invitations, fixtures, Match Centre, messages and subscriptions get
their handlers when those surfaces exist, and each will be authorised server-side on arrival — a deep
link is a request, never a grant.

Rugby Hub links are wired: any `/rugby-hub…` address — in the app's scheme, in Expo Go, or as https —
is read by the shared `parseHubHref` into a typed destination and mapped by `src/hub/route-table.ts`
to the native screen, with `?identity=`, `?code=` and `#section-` carried as browsing params. An
address the vocabulary does not know resolves to nothing rather than to a guess. See
`RUGBY_HUB.md`.

## Design

Native tokens in `src/design/tokens.ts`, copied by value from `app/globals.css` (a React Native app
cannot read a CSS custom property, and translating Tailwind at runtime is a second design system
pretending to be one). The measured contrast ratios come with them. Bebas Neue and Inter are bundled
via `@expo-google-fonts` — both OFL, so embedding is legitimate — and **rendering never waits on
them**: the splash clears when fonts settle, loaded or failed, because blocking on a typeface is the
web product's own development webfont defect moved onto a phone. It was reproduced once during this
build and fixed.

## Mobile hardening debt

1. **The agenda is not shared yet.** `src/context/home-data.ts` asks a small fixtures question of its
   own because `lib/agenda/load.ts` depends on a React component's props type and a `.server` module.
   Extracting it belongs to M5, where Fixtures is built and the extraction can be verified against the
   surfaces it serves. Until then there is one small read here that M5 must delete.
2. **No simulator proof.** This machine has no Xcode and no Android SDK, so neither native platform
   has been launched. `expo-secure-store` is therefore unexercised — the journey ran on Expo Web,
   where storage falls back to `localStorage`.
3. **No capability read yet**, because nothing gates an action. The first one sets the pattern.
4. **Push, offline caching and background refresh** are untouched (M7/M10).
5. **No release signing, store identity or crash reporting** (M11).
