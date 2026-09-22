# Ovalball Mobile — Development

Real commands, in order.

## Once

```bash
cd apps/mobile
npm install
cp .env.example .env.local
```

Then fill `.env.local`. Get the publishable key from the running local stack:

```bash
supabase status --output env | grep ANON_KEY     # or: cat ../../.env.local | grep PUBLISHABLE
```

```
EXPO_PUBLIC_OVALBALL_ENV=development
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<the local anon key>
EXPO_PUBLIC_OVALBALL_WEB_URL=http://localhost:3000
```

**Everything in that file is compiled into the app bundle and is public.** The publishable key is the
anon key — it authorises nothing by itself. A service-role key, a GoCardless secret, a ZeptoMail key
or an invitation pepper must never appear there; `supabase/tests/js/mobile_foundation.test.mts` fails
the build if one does.

## Every session

```bash
# 1. the platform
supabase start                       # from the repository root

# 2. the website, only if you want the "open on the web" links to work
npm run dev                          # repository root, :3000

# 3. the app
cd apps/mobile && npx expo start
```

Then press `i` for iOS, `a` for Android, `w` for web, or scan the QR code with Expo Go.

## On a physical phone: localhost will not work

A handset cannot resolve your Mac's `localhost` — that is the simulator's privilege. Point the app at
the Mac's LAN address, with both devices on the same Wi-Fi:

```bash
ipconfig getifaddr en0          # e.g. 192.168.1.42
```

```
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.42:54321
EXPO_PUBLIC_OVALBALL_WEB_URL=http://192.168.1.42:3000
```

The app detects the loopback case on a device and says so on the sign-in screen rather than failing
silently — but it cannot fix it for you.

## This machine cannot run a simulator

`xcodebuild` reports only Command Line Tools, and there is no Android SDK or `adb`. So:

- **iOS** — needs Xcode from the App Store, then `npx expo run:ios`. Not blocked by anything in the
  code; blocked by the toolchain not being installed.
- **Android** — needs Android Studio, an SDK and an AVD, then `npx expo run:android`.
- **Expo Go** on a real phone works today over the LAN and needs neither.
- **Web** works today and is what the automated journey uses.

## Checks

```bash
cd apps/mobile && npx tsc --noEmit          # types, including the shared package
cd apps/mobile && npx expo export --platform web --output-dir /tmp/ovalball-mobile   # bundle sanity

# from the repository root — unit and source guards, no simulator needed
node --import ./scripts/email-test-loader.mjs --experimental-strip-types --test \
  supabase/tests/js/mobile_foundation.test.mts \
  supabase/tests/js/mobile_session_store.test.mts \
  supabase/tests/js/mobile_error_translation.test.mts \
  supabase/tests/js/shared_contracts.test.mts
```

## The acceptance journey

Sign in, identity, real contexts, switching, session restoration, sign-out — 27 assertions. It seeds
its own disposable identity with a password and removes it afterwards, so it touches no review
persona.

```bash
# terminal 1
cd apps/mobile && npx expo start --web --port 8081

# terminal 2, from the repository root
node scripts/browser-verification/91-mobile-foundation.mjs
```

It is declared in `scripts/browser-verification/suite-registry.json` rather than wired into the web
release gate, because the gate does not start a Metro bundler and should not have to.

## Before an App Store or Play submission (not needed yet)

Nothing in this build requires them, and none has been obtained:

- an Apple Developer Program membership, an App Store Connect record and a distribution certificate;
- a Google Play Console account and an upload key;
- an EAS project and build profiles (`eas.json`);
- app icons and splash artwork at store sizes — note the two protected logo files in `public/icons`
  are **not** to be touched, so store artwork is its own deliverable;
- push credentials (APNs key, FCM), once M7 adds notifications;
- a privacy manifest and data-collection disclosures for both stores.
