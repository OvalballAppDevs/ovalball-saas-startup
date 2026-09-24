# Rugby Hub — visual asset manifest (CA-M6)

Higgsfield imagery is presentation only. Canonical Rugby Hub data (`hub_content_items`,
`hub_glossary_terms`, `regulatory_facts`, …) is the truth; every label, explanation, law and
relationship drawn over an image is read from the database at render time
(`apps/mobile/src/hub/visuals/manifest.ts` names only canonical entity references, and
`supabase/tests/js/hub_visual_manifest.test.mts` refuses any reference that is not a published entity).
The images are app-owned files under `apps/mobile/assets/hub/`, keyed once in
`apps/mobile/src/hub/visuals/assets.ts`, separate from canonical media (club crests, avatars, news
media) which keep their own resolvers. No protected Ovalball logo is touched.

Tool: the `higgsfield` CLI (workspace of the Ovalball account), model **Nano Banana Pro**
(`nano_banana_pro`, 3:2, 1k) chosen for realistic rugby anatomy, kit and grass; masters are kept in the
session scratchpad, sized derivatives (≤ 1200 px wide JPEG, 5.4 MB for all 24) ship in the app. The
owner's plan now carries unlimited Nano Banana, so regenerating until a candidate passes review costs
nothing; the CA-M6 batch ran before that change and spent roughly 78 credits. Every candidate is viewed
by eye before import and rejected for: fake lettering, a fake brand or crest, a malformed or wrong-sport
ball, wrong posts, broken binds or lifts, impossible body positions, a face turned to camera, or a scene
that implies something the canonical concept does not say.

Standing rules: no text or labels inside images; no fake crest; no generated portrait presented as a
named real person; generated players are never presented as Ovalball members; children only in wide,
non-identifying scenes; every explainer has a textual equivalent; Reduce Motion respected.

## Assets

### `hero-landing`

| | |
|---|---|
| Hub domain | Landing |
| Entity / section | Rugby Hub landing |
| Purpose | EDITORIAL HERO |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | landing hero, top of the Rugby Hub |
| Light/dark | light canvas; heading laid over the sky |
| Safe crop area | top third |
| Alt-text intention | A community rugby pitch under floodlights at dusk, chalk lines bright on the grass |
| Generated file | `apps/mobile/assets/hub/hero-landing.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial atmospheric photograph of a community rugby union pitch under floodlights at dusk, mist over the grass, goal posts silhouetted, chalk lines glowing, a few players training small in the distance seen from behind. Cinematic depth, forest-green and warm chalk tones, no text, no logos, no watermark, wide negative space at the top for a heading.

### `hero-learn`

| | |
|---|---|
| Hub domain | Learn the Game |
| Entity / section | group hero |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | group header |
| Light/dark | light |
| Safe crop area | left half |
| Alt-text intention | A muddy rugby ball resting on a chalk line, the posts soft in the distance |
| Generated file | `apps/mobile/assets/hub/hero-learn.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial close-up photograph of a rugby union ball resting on a white chalk line on wet grass at a community pitch, shallow depth of field with the posts blurred in the distance, overcast British daylight, plain unbranded ball with no text or logos, subtle forest-green tone, no watermark, negative space to one side.

### `hero-play`

| | |
|---|---|
| Hub domain | Play & Develop |
| Entity / section | group hero |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | group header |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A line of players in training tops stepping through a row of cones on a grey afternoon |
| Generated file | `apps/mobile/assets/hub/hero-play.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — one indistinct mark on a sock judged not a legible brand |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial photograph of young adult players in a passing drill on a training ground, one player releasing a pass along a line, cones on the grass, seen from behind and in profile so no face is towards the camera, overcast British daylight, authentic grass, plain unbranded kit, subtle forest-green tone, no text, no logos, no watermark, negative space above.

### `hero-coach`

| | |
|---|---|
| Hub domain | Coach Rugby |
| Entity / section | group hero |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | group header |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | Coaching kit on the grass: tackle pads, a stack of cones, a whistle and clipboard, and a bag of balls |
| Generated file | `apps/mobile/assets/hub/hero-coach.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — clipboard is blank |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial photograph of a training ground before a session: a set of cones, tackle shields and a bag of rugby balls laid out on the grass, a coach's whistle and clipboard resting on a shield, no people, overcast British daylight, authentic grass, plain unbranded equipment with no text or logos, subtle forest-green tone, no watermark, negative space above.

### `hero-explore`

| | |
|---|---|
| Hub domain | Explore Rugby |
| Entity / section | group hero |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | group header |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A floodlit stadium at dusk seen from the terraces, the pitch marked and lit below |
| Generated file | `apps/mobile/assets/hub/hero-explore.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — no signage or advertising visible |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial atmospheric photograph of a large rugby stadium from the empty stands looking down at the pitch and posts under evening floodlights, a crowd out of focus far away, no visible signage or advertising, no text, no logos, no watermark, forest-green and warm tones, cinematic depth, negative space at the top.

### `hero-welfare`

| | |
|---|---|
| Hub domain | Welfare & Support |
| Entity / section | group hero |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | group header |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A family walking past a wooden clubhouse towards the pitch on a Sunday morning |
| Generated file | `apps/mobile/assets/hub/hero-welfare.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — family seen from behind only |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial photograph of a welcoming community rugby clubhouse doorway on a bright overcast morning, a bench with kit bags outside, families seen small and from behind walking towards the pitches, warm and calm, no identifiable faces, no text, no signage, no logos, no watermark, subtle forest-green tone, negative space above.

### `scene-ruck`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT the-breakdown-and-ruck; GLOSSARY ruck, breakdown |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me / See It explainer |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A breakdown: a tackled player on the ground, a team-mate reaching for the ball, two more bound over him, four defenders standing back with their backs to us |
| Generated file | `apps/mobile/assets/hub/scene-ruck.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — third generation; v1 and v2 REJECTED (faces turned to camera) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a ruck: a tackled ball-carrier on the ground with the ball just behind him, two attacking support players on their feet bound over the ball, and the opposing defensive line standing in a spaced line a few metres back. Camera slightly elevated three-quarter view from behind the defending team so the ball, the players over it and the defensive line are clearly separated in depth. Every player seen from behind or in profile, no face towards the camera. Natural community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy, realistic plain rugby kit with no team branding, no text, no logos, no watermark. Composition for a mobile educational overlay with clear negative space above the scene.

### `scene-maul`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GLOSSARY maul |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | See It explainer |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A maul from behind: the ball carrier held up with three team-mates bound on, a defender bound in from the other side |
| Generated file | `apps/mobile/assets/hub/scene-maul.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a maul: the ball-carrier held upright off the ground by a defender, with three teammates bound onto him driving forward as a tight group, and the defending forwards bound against them. Camera at pitch level from the side so the upright ball-carrier and the two bound groups are clear. Players seen from behind or in profile, no face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy and binding, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-scrum`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT the-scrum-and-lineout-in-play; GLOSSARY scrum-union |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me / See It |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A scrum from behind the scrum-half, two packs bound and pushing, the ball at the scrum-half's feet |
| Generated file | `apps/mobile/assets/hub/scene-scrum.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — third generation; v1 and v2 REJECTED (faces to camera; a branded coach jacket) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a scrum: two sets of eight forwards fully bound in three rows and engaged against each other, the scrum-half crouched at the side ready to feed the ball into the tunnel, the referee standing beside the scrum. Camera slightly elevated from the side-on angle so both packs and the tunnel are readable. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy and binding, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-lineout`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GLOSSARY lineout |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | See It |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A lineout in profile: the thrower with the ball in the air, two lines of forwards, a jumper lifted by two team-mates |
| Generated file | `apps/mobile/assets/hub/scene-lineout.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — fifth generation; v1–v4 REJECTED (faces turned to camera; one kit colour; a small crest on the jumper's shirt) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a lineout: two lines of forwards standing one metre apart perpendicular to the touchline, a hooker throwing the ball straight down the middle from the touchline, and one jumper lifted high by two teammates gripping his thighs to catch it. Camera from behind the thrower looking down the line. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy and lifting technique, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-play-the-ball`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT the-play-the-ball |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A rugby league play-the-ball from behind: the tackled player rolling the ball back with his foot, the dummy-half crouched, the defensive line ten metres away |
| Generated file | `apps/mobile/assets/hub/scene-play-the-ball.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — fourth generation; v1–v3 REJECTED (brand swooshes and faces; a shirt badge and faces; not a play-the-ball at all) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby league educational scene showing the play-the-ball: a tackled player standing back on his feet facing the opposition, rolling the ball backwards with his foot to a teammate crouched behind him acting as dummy-half, while the defending team stands back ten metres in a line. Camera slightly elevated from behind the acting half. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-penalty-advantage`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT penalties-and-advantage |
| Purpose | INTERACTIVE EXPLAINER BACKDROP |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A referee side-on with an arm stretched out signalling advantage while play goes on |
| Generated file | `apps/mobile/assets/hub/scene-penalty-advantage.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a referee playing advantage: the referee, in a plain dark kit with a whistle, running alongside open play with one arm held out horizontally signalling advantage while the attacking team continues to move the ball through hands. Camera at pitch level three-quarter angle with the referee's arm signal clearly readable. No face towards the camera. Community rugby ground, authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-scoring`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT how-scoring-works |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A player in green diving to ground the ball over the goal line, the posts behind |
| Generated file | `apps/mobile/assets/hub/scene-scoring.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a try being scored: a player diving to ground the ball with downward pressure in the in-goal area just past the goal line, the goal posts and the try line clearly visible, defenders arriving a moment too late. Camera low from the side along the try line so the line, the grounded ball and the posts are all clear. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-pitch`

| | |
|---|---|
| Hub domain | Game Knowledge |
| Entity / section | GAME_CONCEPT the-pitch-and-direction-of-play |
| Purpose | ATMOSPHERIC SECTION ART |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | backdrop behind the native vector pitch explainer |
| Light/dark | light |
| Safe crop area | sky |
| Alt-text intention | A community pitch from one corner: the in-goal and posts on the right, the 22 and halfway lines across the grass |
| Generated file | `apps/mobile/assets/hub/scene-pitch.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial atmospheric photograph of an empty community rugby union pitch from a slightly elevated position near one corner, showing the white chalk lines, the 22-metre line, the halfway line, the goal posts at the far end and the in-goal area, with a treeline and soft overcast British light. Authentic grass, subtle forest-green tone, no people, no text, no logos, no watermark, strong depth and clear negative space in the sky.

### `scene-offside`

| | |
|---|---|
| Hub domain | Officiating |
| Entity / section | OFFICIATING_CONCEPT offside-decisions-union |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | What Would You Call? scenario |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A ruck on the left and a green defensive line across the pitch, one defender a stride ahead of the others |
| Generated file | `apps/mobile/assets/hub/scene-offside.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing offside at a ruck: a ruck formed over the ball in the middle distance, the defending team's line standing level with and behind the hindmost foot of the ruck, and one defender clearly standing a step in front of that line. Camera elevated behind the defending line so the ruck and the spacing of the defensive line are readable. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-knock-on`

| | |
|---|---|
| Hub domain | Officiating |
| Entity / section | OFFICIATING_CONCEPT knock-on-and-forward-pass |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | What Would You Call? scenario |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A player fumbling the ball forward, team-mates with arms raised, a referee on the right |
| Generated file | `apps/mobile/assets/hub/scene-knock-on.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a knock-on: a player attempting to catch a pass, the oval ball bouncing forward off his hands and arms towards the opposition goal line, teammates reacting, the referee's whistle raised. Camera at pitch level from the side with the ball clearly in the air ahead of the player. No face towards the camera. Community rugby ground, authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-cards`

| | |
|---|---|
| Hub domain | Officiating |
| Entity / section | OFFICIATING_CONCEPT cards-and-sin-bin |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | What Would You Call? scenario |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A referee holding up a yellow card, the player walking away towards the touchline |
| Generated file | `apps/mobile/assets/hub/scene-cards.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — plain yellow card, referee in profile, not a named person |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a referee showing a yellow card: the referee in plain dark kit holding a plain yellow card raised at arm's length towards a player walking away towards the touchline, teammates standing back. Camera at pitch level three-quarter angle behind the player so the card is clear and no face is towards the camera. Community rugby ground, authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, plain card with no writing, no text, no logos, no watermark, negative space above.

### `scene-referee`

| | |
|---|---|
| Hub domain | Officiating |
| Entity / section | OFFICIATING_CONCEPT what-the-referee-does |
| Purpose | CONCEPT ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | Show Me |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A referee mid-play with whistle and arm out, an assistant referee with a flag on the far touchline |
| Generated file | `apps/mobile/assets/hub/scene-referee.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union educational scene showing a match referee at work: the referee in plain dark kit with a whistle positioned close to a breakdown, one arm out managing the players, an assistant referee with a flag on the far touchline. Camera slightly elevated from behind the referee. No face towards the camera. Community rugby ground, authentic grass and mud, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-coach-breakdown`

| | |
|---|---|
| Hub domain | Coaching Knowledge |
| Entity / section | COACHING_CONCEPT coaching-breakdown-decisions |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | coaching-point hotspots |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A coach with his back to us watching three players work a breakdown drill over a tackle pad |
| Generated file | `apps/mobile/assets/hub/scene-coach-breakdown.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — fourth generation; v1–v3 REJECTED (faces and tiny shirt badges; three-stripe boots twice) — final framing keeps footwear out of shot |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union coaching scene on a training ground: a coach in a plain tracksuit watching a small-sided practice where a ball-carrier has gone to ground on a tackle shield, one supporting player arriving low over the ball and a second in support, cones marking the practice area. Camera slightly elevated from behind the coach. No face towards the camera. Authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy and body positions, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-coach-space`

| | |
|---|---|
| Hub domain | Coaching Knowledge |
| Entity / section | COACHING_CONCEPT using-space-time-and-numbers |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | coaching-point hotspots |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A small-sided game on a coned grid: a ball carrier attacking two defenders with support either side |
| Generated file | `apps/mobile/assets/hub/scene-coach-space.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — wide shot, faces small and indistinct |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union coaching scene on a training ground: a small-sided attack-versus-defence game inside a coned grid, three attackers spread wide with the ball-carrier drawing a defender to create space outside, two defenders spaced across the grid, a coach observing from the edge. Camera elevated from one end so the space between players is readable. No face towards the camera. Authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-coach-contact`

| | |
|---|---|
| Hub domain | Coaching Knowledge |
| Entity / section | COACHING_CONCEPT coaching-contact-safely |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | coaching-point hotspots |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A coach kneeling beside a player driving into a tackle pad, guiding the height of the tackle |
| Generated file | `apps/mobile/assets/hub/scene-coach-contact.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — second generation; v1 REJECTED (three-stripe boot) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby union coaching scene on a training ground: a coach kneeling beside a player practising a safe low tackle technique on a padded tackle bag held by a teammate, head to the side, shoulder making contact, back straight. Camera at pitch level from the side. No face towards the camera. Authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy and technique, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-coach-tackle-count`

| | |
|---|---|
| Hub domain | Coaching Knowledge |
| Entity / section | COACHING_CONCEPT coaching-tackle-count-decisions |
| Purpose | TACTICAL / SPATIAL ILLUSTRATION |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | coaching-point hotspots |
| Light/dark | light |
| Safe crop area | top |
| Alt-text intention | A coach pointing down the pitch as four players run a set with the ball |
| Generated file | `apps/mobile/assets/hub/scene-coach-tackle-count.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED — second generation; v1 REJECTED (faces turned to camera) |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial rugby league coaching scene on a training ground: a coach with a whistle counting tackles while a small group practises a set of six, one player playing the ball with a foot roll and a marker standing in front, the rest of the line retreating, cones marking the area. Camera slightly elevated from the side. No face towards the camera. Authentic grass, overcast British daylight, subtle forest-green tone, realistic anatomy, plain unbranded kit, no text, no logos, no watermark, negative space above.

### `scene-match-day`

| | |
|---|---|
| Hub domain | Parents & Guardians |
| Entity / section | PARENT_GUIDE first-rugby-match-day |
| Purpose | INTERACTIVE EXPLAINER BACKDROP |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | step-through match-day guide |
| Light/dark | light |
| Safe crop area | sky |
| Alt-text intention | A family walking past a wooden clubhouse towards a community pitch, a coach setting out cones on the far side |
| Generated file | `apps/mobile/assets/hub/scene-match-day.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — family seen from behind only, children non-identifying |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial wide atmospheric scene of a community rugby club on a match morning: families walking from a car park towards a clubhouse and pitches, kit bags over shoulders, a coach setting out cones in the distance, all figures small and seen from behind so nobody is identifiable. Overcast British daylight, authentic grass and mud, subtle forest-green tone, welcoming and calm, no text, no signage, no logos, no watermark, negative space in the sky.

### `scene-kit`

| | |
|---|---|
| Hub domain | Parents & Guardians |
| Entity / section | PARENT_GUIDE what-a-new-player-needs |
| Purpose | EQUIPMENT / OBJECT VISUAL |
| Aspect ratio | 3:2 (Nano Banana Pro, 1k) |
| Mobile placement | hotspots on each item |
| Light/dark | light |
| Safe crop area | around items |
| Alt-text intention | Kit on a wooden bench under a window: muddy boots, a mouthguard in its case, a plain shirt, shorts, socks, a water bottle and a bag |
| Generated file | `apps/mobile/assets/hub/scene-kit.jpg` (1200 px wide JPEG from the approved 1k master) |
| Approval | APPROVED (first generation) — a faint stitched motif on the shirt chest is not a legible brand |
| Fallback | if withdrawn, point the key in `assets.ts` at an `assets/editorial/*` photograph; the key never disappears |
| Animation | none (static; hotspots and steps are native) |

Prompt:

> Premium editorial still-life photograph of what a new rugby player needs, laid out on a wooden bench in a clubhouse changing room: a pair of rugby boots with studs, a mouthguard in its case, a plain rugby shirt, plain shorts, long rugby socks, a water bottle and a small kit bag. Camera from above at a slight angle, soft natural window light, subtle forest-green tone, realistic objects, plain unbranded items, no text, no logos, no watermark, clear negative space around each item.


## Review log (CA-M6, 2026-09-24)

| | |
|---|---|
| Higgsfield availability | AVAILABLE — `higgsfield account status` signed in as the Ovalball workspace |
| Model | `nano_banana_pro`, 3:2, 1k, one image per job, jobs run sequentially |
| Generations requested | 40 |
| Approved | 24 (one per asset key) |
| Rejected | 16 — kept in the session scratchpad as `rejected-<key>-v<n>.png`, never imported |
| Rejection reasons | faces turned to camera (9), a fake brand mark or crest on kit, boots or a jacket (6), wrong subject (1 — a "play-the-ball" that was not one) |
| Hotspot placement | every approved scene was rendered with its hotspot markers overlaid (Playwright, 900 px) and the coordinates in `manifest.ts` corrected by eye; two pins that pointed at things not in frame (a lineout in the scrum scene, a red card in the cards scene) were replaced with pins on what the picture shows |
| Alt text | rewritten to describe the approved image, not the prompt |

What was checked on every candidate: no lettering; no crest, badge, stripe or brand mark; a rugby ball
of the right shape; rugby posts; binds, lifts and body positions that are physically possible; no face
turned to camera; nothing that contradicts the canonical concept the scene illustrates. Children appear
only in the two family scenes, wide and from behind.
