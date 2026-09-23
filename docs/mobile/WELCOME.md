# Public Welcome — the mobile entrance

The unauthenticated entrance was a forest wall with the mark floating in it. It is now a light
brand entrance: chalk canvas, the canonical mark, **RUGBY. CONNECTED.** in the display face, one
line of copy, a rugby collage of app-owned cut-outs cropped by the edges, and two actions. A
signed-in session never sees it.

## Files

| | |
|---|---|
| `apps/mobile/app/welcome.tsx` | the route: `WelcomeScreen`, Log In → `/sign-in` |
| `apps/mobile/src/components/welcome/welcome-screen.tsx` | the screen: column, collage, motion, CTA |
| `apps/mobile/src/components/welcome/objects.ts` | the one manifest of collage objects (`require()`d, with pixel sizes) |
| `apps/mobile/src/components/brand.tsx` | **reproduced** mark: measured ring path + the file's own wordmark letterforms |
| `apps/mobile/assets/welcome/*` | app-owned masters and derivatives (below) |
| `apps/mobile/app/_layout.tsx` | gate: `signed-out` → `/welcome`; `welcome` counts as "on the entrance" |
| `apps/mobile/app/sign-in.tsx` | a Back chevron to Welcome (the root is a Slot, so there is no swipe back) |
| `supabase/tests/js/mobile_welcome.test.mts` | 9 assertions incl. a permanent SHA-256 guard on the two protected logos |

## The logo — reproduction, not redesign

`public/icons/Ovalball Square Logo.png` (the owner's reference) is the canonical mark. It was only
ever **read**: SHA-256 before and after are identical and now pinned in the test.

- **Ring geometry, measured** (`scratchpad/welcome/fit-ring.mjs`, PCA over the white pixels, hole
  flood-filled and fitted separately): outer ellipse centre (649.2, 487.9), 356.5 × 180.2, −20.48°;
  inner ellipse centre (646.8, 492.4), 287.4 × 120.2, −17.74°. The band is broad at the lower left
  and fine at the upper right because the hole is offset and turned — not a uniform stroke. As one
  even-odd path the reproduction overlaps the original's ring pixels at **IoU 0.954**; the remainder
  is anti-aliasing. No glow, gradient, bevel or shadow — the master has the green rim glow only as a
  rendering effect and it is deliberately not carried.
- **Wordmark, lifted**: OVAL (x 187–641) and BALL (x 667–1068, `#03ac63` median) at cap height 110,
  alpha recovered from luminance/green — **IoU 0.953** against the original letters. Never re-typeset.
  Two ground variants: chalk OVAL for dark grounds, deep-forest OVAL for light; BALL green in both.
- **Masters**: `ovalball-mark-master.png` 1840 × 1300 (2×, transparent, ring + wordmark in canonical
  relative position, 95 KB), `ovalball-wordmark-on-dark.png` / `-on-light.png` 1778 × 236.
- **Consequence**: `OvalballMark` / `OvalballWordmark` now draw the canonical geometry everywhere they
  are used — the launch canvas, sign-in, forgot-password and Welcome — so the splash and the entrance
  share one mark. The previous vector was an approximation (`rx44 ry25 stroke 9, −18°`, Bebas Neue
  wordmark); this is a correction to canonical, not a redesign, and it is called out here so the
  owner sees it on the splash too.

## Higgsfield — what was run, what was kept

Higgsfield CLI, workspace `7e45…0755`. Every candidate was viewed by eye before any import; rejected
files never left the session scratchpad.

| Model (via Higgsfield) | Generated | Kept | Notes |
|---|---|---|---|
| Soul 2.0 (`text2image_soul_v2`) | 33 | **2** (ball-f, boots-a) | writes fake lettering, badges, embossing and labels on nearly every object, and *more* of it the harder the prompt forbids it |
| GPT Image 2.5 | 2 (stopped on owner's instruction) | 0 | not used |
| `flux_2` | 7 | **6** (scrum cap, whistle, cones, jersey, tape, turf) | clean blank objects first time; 2:3 not offered (posts re-run failed) |
| `nano_banana_pro` | 7 | **1** (posts) | scrum cap/whistle/cones also clean; jersey/tape/turf calls failed (API) |
| `flux_kontext` (erase) | 3 | 2 | whistle-a engraving and boots-a tongue marks erased cleanly |
| `image_background_remover` | 10 | 7 | full-size `result_url` is the cut; `min_result_url` is a thumbnail |

Rejections, by reason: fake lettering/brand (ball a/c/d/e/g, boots-d, cap c/d, whistle a/b/c,
cones a/b/c/d, posts b/c/d, jersey a/b, tape-a, bottle-a, grass-a/b); fake crest or emblem (ball-h,
cap-a, boots-a before erase, posts-a); wrong sport (posts-a gooseneck; boots-a high cut queried,
kept); mediocre (grass-a); photographed as a book page (cap-b); American-football-style spikes
(boots-d). No people were generated for the entrance.

**Pipeline notes.** Uploading WebP or >~1 MB PNG hangs the CLI's create; JPEG ≤ 300 KB via
`upload create` → media id → `generate create` → poll `generate get` is reliable, though creates
still stall intermittently and need retries. The remover returns the input size, so sources were
1200 px (1024 px for the ball and boots) — ample: the largest on-screen piece needs ≈ 730 px at 3×.
Tape, turf and posts cuts had not returned by banking (their remover creates stalled through ten
retries each); their slots are wired `null` and simply do not draw. The generated files are in the
session scratchpad and can be cut in a follow-up without regenerating.

## Final assets (derivatives, palette PNG, transparent)

| File | px | KB | Slot |
|---|---|---|---|
| rugby-ball.png | 891 × 509 | 256 | ball — large, right, crossing the edge, turns ±1.5° / 9 s |
| rugby-boots.png | 684 × 459 | 123 | boots — lower right, cropped |
| scrum-cap.png | 855 × 983 | 387 | scrum cap — top right, cropped, floats ±3 pt / 7 s |
| whistle.png | 900 × 389 | 135 | whistle — top left, cropped |
| training-cones.png | 705 × 800 | 169 | cones — lower left, over the jersey |
| jersey.png | 755 × 1000 | 474 | jersey — left edge, behind the cones |

Seven of nine slots; total 1.7 MB including the mark masters; every `require()`d file verified in
the iOS export by byte size.

## Composition

Column (ordinary flex, inside the safe area): mark → wordmark → motto → copy → flexible space → Get
Started (56-pt forest pill, chalk text, spring-settles to 0.975 under the thumb) → Log In (text,
forest). Collage (absolute, `overflow: hidden`, `pointerEvents="none"`, hidden from assistive
technology): every piece is placed in fractions of the window and cropped by an edge; painted back
to front with the ball last. Motto size scales with width and caps by height class (56 / 68 / 76).

Measured on the web export of the same code at 375 × 667 (SE), 393 × 852 (owner's phone) and
430 × 932 (Pro Max): Welcome lands on `/welcome` with exactly two buttons, "Get Started" and
"Log In"; the CTA never nears the bottom edge; nothing overlaps the column's words.

## Motion

Arrival: opacity 0 → 1 and 14 pt rise, 640 ms, ease-out cubic, staggered 70 ms by paint order after
a 120 ms lead so it resolves as the launch canvas fades. Ambient: ball turns ±1.5° over 9 s, scrum
cap drifts ±3 pt over 7 s, both sine-eased loops; everything else is still. Nothing spins, bounces,
pulses or flashes; no particles, no sound, no intro sequence. Device-motion parallax is **not**
implemented: `expo-sensors` is not a dependency and adding one for decoration was not warranted.

**Reduce Motion, measured** (`scratchpad/welcome/motion.mjs`): with motion, pieces are at opacity
0.00 at first paint and 1.00 after 2.2 s; with Reduce Motion, all pieces are at 1.00 at first paint.
The setting is read live (`reduceMotionChanged`).

## Splash → Welcome

Unchanged mechanism: the launch canvas (forest, mark) holds for exactly as long as session
resolution takes, then fades over 220 ms; Welcome is already laid out beneath it, so the fade
reveals the light canvas and the collage settles around the same mark. No artificial delay.

## Destinations and authority

- **Get Started** → `Linking.openURL(`${webUrl}/signup`)` — the website's canonical signup / join /
  claim architecture, in the system browser. No signup path exists in the app.
- **Log In** → `/sign-in` — the app's one email + password sign-in, then MFA where the account holds
  a factor, recovery via the existing link flow.
- **Authenticated bypass** — the gate's `signed-in && !inApp → /(tabs)` branch runs before the
  signed-out branch, so a signed-in session on `/welcome` is moved into the product; measured
  earlier in this session with a real session on the web export (landed on `/`).
- The screen imports nothing from auth, storage or the domain (tested), infers no role, club or
  family, and collects no input.
