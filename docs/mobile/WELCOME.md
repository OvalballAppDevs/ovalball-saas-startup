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

# Visual correction pass — the collage is the idea

Checkpoint `77813f8` was rejected on the physical iPhone: the screenshot showed the mark, the
headline and dead white space — **no collage at all** — although the same commit rendered seven
objects on the web export. Two causes, both fixed here.

**Why the device showed nothing.** Every piece started at opacity 0 and depended on a
native-driver arrival animation to become visible. On the phone that animation never applied, so
the pieces were laid out and invisible. Presence no longer depends on any animation: pieces render
at full opacity, and the arrival is a 10-pt settle only — if no frame ever ran, a piece would sit
ten points low, not vanish. Reduce Motion is still honoured and still measured.

**Why it was timid even where it rendered.** The composition treated each object as needing its
own clear space, at 15–30% of the width, on a field that began below a headline sized for a poster.

## Three iterations, screenshot-driven (393 × 852, plus 375 × 667 and 430 × 932 each time)

1. Brand block tightened (mark 76, wordmark 21, gap 6), motto 68 → 52 pt, copy 15 pt; the field
   opened at 0.31 H; ball 0.84 W crossing the right edge over a 0.54 W jersey; cap 0.38 W entering
   from the right; boots 0.54 W leaving the left; whistle 0.21 W cropped top-left; cones 0.15 W;
   CTA inset by a further 8 pt. One restrained mark: a faint chalk touchline and a short arrow.
2. Field lifted to 0.31 / 0.29 / 0.36 H (normal / tall / short); ball 0.84 W at −18°; boots settled
   toward the CTA; touchline made solid and quieter (10% / 16%).
3. The collage laid out against the **span between the brand block and the CTA** rather than the
   window: the ball takes 22% of that span from the top, the boots hang from the CTA with 20% of
   their height under the pill's edge, the cones sit 8 pt above it. A tall phone gets a deeper
   composition; a short one tucks the boots under the button.

## The checklist, answered on iteration 3

| | |
|---|---|
| A. ≥ 5 rugby elements visible without hunting | **Yes** — ball, jersey, boots, scrum cap, whistle, cones |
| B. ≥ 2 deliberately edge-cropped | **Yes** — ball (right), jersey (left), boots (left), cap (right), whistle (top-left) |
| C. ≥ 2 overlapping | **Yes** — ball over jersey; cap behind the ball; boots over the jersey's foot and under the CTA pill; cones under the ball's end |
| D. Obvious large hero | **Yes** — the ball at 0.84 W (0.9 W on tall phones) |
| E. Collage occupies a meaningful part of the screen | **Yes** — from ≈ 0.31 H to the CTA, ≈ 45–50% of the canvas |
| F. Intentional negative space | **Yes** — chalk around the headline and between the ball's underside and the boots, with the touchline through it |
| G. CTA belongs to the composition | **Yes** — the boots run under its left edge, the cones sit at its right shoulder |
| H. Good with motion disabled | **Yes** — measured: all pieces at opacity 1.00 at first paint under Reduce Motion |

Scale hierarchy: ball LARGE (0.84 W) · boots and jersey LARGE/MEDIUM (0.54 W) · cap MEDIUM
(0.38 W) · whistle SMALL (0.21 W) · cones SMALL (0.15 W).

Compared with the rejected screenshot, the middle/lower visual field is now occupied by the rugby
collage rather than dead white space.

## Motion, after the static design

Unchanged in kind, reduced in weight: arrival is a 640 ms, 10-pt settle on a 70 ms stagger; the
ball breathes ±1.5° over 9 s; the cap drifts ±3 pt over 7 s; nothing else moves. No fade governs
visibility any more.

No Higgsfield call was made in this pass; the six approved objects were enough.

# Direction change — one action frame on forest

The owner rejected the collage direction on the phone and supplied a reference: a player mid-pass
on a floodlit pitch, the ball toward the camera, the Ovalball mark on the jersey and the ball,
then the mark, RUGBY. / CONNECTED., a line of copy, a green arrow pill and an outlined Log In. The
instruction: exactly that, with the chest mark **embroidered** like a badge. Storyboard and brief:
https://claude.ai/artifact/5SrmzWk9QowXWehKwfKLsP

## The still

Made on Higgsfield with `nano_banana_pro` (2k, 9:16) from two reference images: the owner's frame
and the **canonical mark rendered on forest** (`ovalball-mark-master.png`), so the badge is derived
from the real artwork rather than a generator's memory of it. Five edits:

| | Result | Verdict |
|---|---|---|
| hero-a | embroidered badge, but the reference's baked-in text and centre logo copied into the picture | rejected |
| hero-b | embroidered badge, baked-in text and a fake status bar | rejected |
| hero-c | clean lower half, no text; badge reads printed, not embroidered | held as the clean plate |
| **hero-d** | **embroidered patch with stitched border, ball mark kept, lower half clean pitch, no text** | **approved → `welcome-still.jpg`** |
| hero-e | embroidered but flatter; clean | approved spare |

Derivative: 1290 × 2311 JPEG q86 (250 KB), `contentFit="cover"` from the top so the player and ball
hold their place on every height. One honest note: the marks *in the picture* (chest and ball) are
the generator's rendering guided by the canonical file — close, not the measured geometry. Every
mark that matters is native: the vector `OvalballMark` and the lifted wordmark sit over the still.

## The screen

Forest ground; the still full-bleed with a forest gradient rising from the foot (5% → 22% → 72% →
96%); the column bottom-aligned inside the safe area: mark (chalk) → wordmark → **RUGBY. /
CONNECTED.** at up to 70 pt with **line-height 1.0×** (0.9× is what clipped the tops on the device)
→ copy → Get Started (56-pt `#03ac63` pill, chalk text, arrow) → Log In (outlined pill). Status bar
light. Motion: one 6% push-in over 12 s, once; Reduce Motion holds at 1.000 (measured on the web
export: 1.0032 → 1.0355 with motion, 1.0000 → 1.0000 without).

The collage manifest and its six cut-outs are retired from the app (the files stay in the session
scratchpad); the mark masters and wordmarks remain. Gate, destinations and authority unchanged.

**Not done:** the throw → zoom-to-logo *video* sequence from the storyboard. This is the frame it
would rest on; the clip is a separate image-to-video pass to approve on the phone before wiring.

## Second reference — the ball closer, the whole logo in frame

The owner supplied a tighter frame ("this is perfect"): the ball muddy and close in sharp focus,
the player falling out of focus behind, grass flying — with one instruction: the entire logo on
the ball must be inside the picture (in the reference, BALL runs off the right edge).

Edited on Higgsfield (`nano_banana_pro`, 2k, 9:16) from that frame plus the canonical mark:

| | Result | Verdict |
|---|---|---|
| ball-a | whole logo in frame, embroidered patch, lower half cleared; ring and OVAL rendered white | good, held |
| **ball-b** | whole logo in frame with margin, ball treatment as the reference (dark ring, green BALL), lower half cleared; chest badge printed | **plate** |
| ball-c | ring rendered green | rejected |
| badge-a (edit of ball-b) | embroidered the *ball's* logo as a patch | rejected |
| **badge-b (edit of ball-b)** | **chest badge as an embroidered patch with a stitched border; ball, framing and background unchanged** | **approved → `welcome-still.jpg`** |

Derivative 1290 × 2311 JPEG q86. Screen unchanged from the previous pass; measured again at
375 × 667, 393 × 852 and 430 × 932, push-in 1.000 → 1.036 with motion and held at 1.000 under
Reduce Motion.

## Correction — no embroidered badge

The owner reviewed the embroidered patch on the phone and rejected it ("looks silly"): the still
is to be the reference frame as it is. `welcome-still.jpg` is now **ball-b** — the reference's own
small printed chest badge, the whole ball logo inside the frame, the lower half cleared for the
native layers. badge-b is withdrawn. Nothing else on the screen changed.
