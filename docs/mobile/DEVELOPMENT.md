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

## On a physical iPhone — the proven loop

This works and is how the app is now reviewed. A handset cannot resolve your Mac's `localhost` — that
is the simulator's privilege — so everything points at the Mac's address on your own network.

**1. Find the Mac's LAN address.** It changes between networks, and between reboots on some routers,
so read it rather than remember it:

```bash
ipconfig getifaddr en0          # Wi-Fi
ipconfig getifaddr en1          # if en0 is empty (wired, or a different interface order)
```

**2. Put it in `apps/mobile/.env.local`** — which is gitignored, and must stay that way. An address
from one developer's kitchen is not product configuration, and committing it breaks the app for
everybody else the moment they pull:

```
EXPO_PUBLIC_SUPABASE_URL=http://<that-address>:54321
EXPO_PUBLIC_OVALBALL_WEB_URL=http://<that-address>:3000
```

**3. Let Supabase answer on the network, not just on the loopback.** `supabase start` binds its API to
all interfaces by default; if the phone times out at sign-in, check with `curl http://<that-address>:54321/rest/v1/`
from the Mac before suspecting the app.

**4. Start Expo on the LAN and scan the QR code** with the Camera app (Expo Go) or with a development
build:

```bash
cd apps/mobile && npx expo start
```

Both devices must be on the same Wi-Fi, and a guest network or one with client isolation switched on
will silently fail — that looks exactly like a broken app and is not one.

**The app tells you when this is wrong.** If the build is pointed at `localhost` while running on a
device, the sign-in screen says so in a developer-only notice. That notice never appears in a
production build, and never appears when configuration is correct.

## Expo Go, and when a development build becomes necessary

Everything in this foundation runs in **Expo Go** — expo-router, expo-secure-store, expo-font,
expo-image, expo-linking, react-native-svg and the Supabase client are all in the Expo SDK.

**M3 to M6 can continue in Expo Go.** Home, Team, People, Fixtures, Calendar, Availability, Match
Centre and the family surfaces are screens and reads; none of them needs a native module Expo Go does
not already carry.

**The first thing that genuinely requires a development build is push notifications — M7.** Remote
push needs an APNs entitlement bound to Ovalball's own bundle identifier, and Expo Go's identifier is
Expo's. The same build unlocks the rest of M10: biometrics (`expo-local-authentication`), the device
calendar (`expo-calendar`), the camera roll and app-icon badges.

**Do not migrate early.** A development build is a real build with real signing, and every day spent
maintaining one before it is needed is a day not spent on the product. The trigger is M7, and the work
is: an Apple Developer membership, `eas.json` build profiles, `npx expo run:ios --device` for a local
build or EAS for a hosted one, and a push credential.

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

## Testing password recovery on your iPhone

**One-time setup.** Two values, both in gitignored files, both needing your Mac's current LAN address
(`ipconfig getifaddr en0`):

```bash
# repository root, in .env  -- read by the Supabase stack
EXPO_RECOVERY_REDIRECT=exp://<that-address>:8081/--/auth/recovery
MOBILE_RECOVERY_APP_URL=exp://<that-address>:8081/--/auth/recovery
```

```bash
# apps/mobile/.env.local  -- read by the app
EXPO_PUBLIC_SUPABASE_URL=http://<that-address>:54321
EXPO_PUBLIC_OVALBALL_WEB_URL=http://<that-address>:3000
```

Then `npx supabase stop && npx supabase start` so the auth server picks up the allow-list, and
`npm run dev` at the root so the handoff page is served.

**Then, on the phone:**

1. Open Ovalball. On **Sign in**, tap **Forgot your password?**
2. Type the email of a local account and tap **Send Reset Link**. You will see *"If an Ovalball
   account exists for that email, we've sent password reset instructions"* — that wording is the same
   whether or not the account exists, on purpose.
3. **The email does not go to a real inbox.** Local mail is caught by Mailpit. On your Mac open
   **http://127.0.0.1:54324** — every local email lands there. Open the newest *Reset Password*
   message.
4. **Get the link onto the phone.** Mailpit is on the Mac, so either open
   `http://<that-address>:54324` in the phone's browser and tap the link there, or copy the link out
   of Mailpit and send it to yourself.
5. Tapping it opens a short Ovalball page that says **Opening Ovalball** and hands straight back to
   the app. (That hop exists only in Expo Go — see below.)
6. Ovalball opens on **Set a new password**, with the requirements listed as you type.
7. Enter the new password twice and tap **Save New Password**. You should see **Password updated**.
8. Tap **Continue to Sign In** and sign in with the new password. If the account has an authenticator,
   you will be asked for a code — a reset never changes that.

**Why the extra hop, and when it goes away.** Supabase refuses to send a recovery link back to an
`exp://` address on a LAN host. Measured, not assumed: `exp://**`, `exp://**/**`, `exp://*/--/**` and
the exact URL were all tried and every one fell back to the website. Only a loopback `exp://127.0.0.1`
is accepted, which a phone cannot use. A custom scheme IS honoured — `ovalball-dev://auth/recovery`
works today — and Expo Go has no custom scheme. **So the hop disappears the moment you move to a
development build**, which is also when push notifications become possible (M7).

## Reviewing on the phone

What to actually look at, in order, when the app is in your hand:

1. **Cold open** — force-quit first. Forest green from the first frame, the mark centred, no white
   flash, no spinner, and it does not hold you there once it knows where you are going.
2. **Sign-in** — the mark stays on forest at the top while the form arrives as a chalk sheet. Tap the
   email field: the keyboard opens, the field stays visible, and Sign In is still reachable. The eye
   reveals the password. iOS should offer the Passwords entry.
3. **Home** — your own name, the context strip with the crest, Needs Attention only if something
   actually needs you, then Next Up.
4. **The bottom bar** — five labelled cells; the active one has a green rule above the glyph as well
   as green colour. Nothing sits under the home indicator. Tabs switch instantly.
5. **The context sheet** — tap the context strip. Your name at the top, then your rugby. Drag the sheet
   down to dismiss it.
6. **Switch club → team** — Home changes, the header changes, the identity stays yours, and nothing
   from the previous context flashes past.
7. **Fixtures, Calendar, Rugby Hub** — each is a real screen that says what it will hold.
8. **Rotate the phone** — it should stay portrait.
9. **Turn Wi-Fi off, pull to refresh** — a product state with a Try Again, never a raw error.
10. **VoiceOver** — the tabs announce their names and which is selected; the context rows announce the
    club, the role and which is current.
11. **Close and reopen** — you are still signed in, in the same context.
12. **Sign out, reopen** — you are not.

## The acceptance journey

Sign in, identity, real contexts, switching, session restoration, sign-out — 27 assertions. It seeds
its own disposable identity with a password and removes it afterwards, so it touches no review
persona.

```bash
# terminal 1
cd apps/mobile && npx expo start --web --port 8081

# terminal 2, from the repository root
node scripts/browser-verification/91-mobile-foundation.mjs   # the journey, 28 assertions
node scripts/browser-verification/92-mobile-shell.mjs        # the shell's UX, 31 assertions
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
