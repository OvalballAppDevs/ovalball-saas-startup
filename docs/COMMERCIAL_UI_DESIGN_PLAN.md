# Commercial surfaces — design plan

Four new screens: Release & Platform Mode, Commercial overview, Ovalball
Plan (club side), and Refer a Club. Written before any of them was built.

This is a **refinement of the live Operate-mode system**, not a new visual
world. Token deltas are listed first, and there are none.

---

## 1. Token deltas: zero

| Axis | Decision |
|---|---|
| Colour | No new values. `forest-950 #071c14`, `forest-800 #123d2c`, `pitch-600 #32a665`, `pitch-400 #5acb83`, `mint-100 #dcf7e5`, `chalk #f8faf7`, `ink #101512`, plus Tailwind's `amber-*` exactly as `diagnostic-banner.tsx` and `dispensation-panel.tsx` already use it. |
| Type | No new families. Bebas Neue via `font-display` for page titles at `text-display-l`; the default sans for everything else; `font-mono` for figures, as the System Health card already does. |
| Layout | `mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12` for the two narrow pages, `max-w-5xl` for the two that carry tables. |
| Components | The existing eyebrow + title + lede header, the existing `divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white` data card, the existing Club Settings tab strip, and shadcn Dialog / Button / Badge. |

One correction to the brief's own description: the display face is **Bebas
Neue**, per the `--text-display-*` scale comment in `globals.css`, not a
Fraunces-style serif. The plan is written for Bebas — condensed, all-caps by
nature, and therefore used only at title size and never for a label.

---

## 2. The one bold move, and where it is spent

Everywhere in this product, **forest-950 is Ovalball's own chrome** — the
app sidebar, the marketing header. Inside a club's own workspace the ground
is chalk, because that space belongs to the club.

So the commercial pages use forest-950 for exactly one element: **the block
that states the current state of the club's relationship with Ovalball**,
or on the Site Admin side, the state of Ovalball itself. It is the one
moment where Ovalball is speaking to the club rather than the club managing
its own affairs, and the existing colour language already carries that
meaning. Nothing else on these pages is dark.

That block is the memorable element. Everything around it is the ordinary
white data card the rest of the admin already uses. No gradients, no
shadows beyond what the card already has, no second accent.

---

## 3. The naming problem, solved by naming

A Club Admin will have two tabs a few pixels apart:

| Tab | Meaning |
|---|---|
| **Subscriptions & Payments** (existing) | Members pay this club. The club's own connected merchant. |
| **Ovalball Plan** (new) | This club pays Ovalball. Pipaxon's merchant. |

Three things keep them apart, none of which is a warning banner:

1. **The new tab names the other party.** It is the only tab in the strip
   that contains the word "Ovalball", because it is the only one about a
   relationship with an outside company.
2. **Each page states the direction of money in its lede, as a sentence,**
   not a label: "Burnley RUFC pays Ovalball to use the platform." The
   existing page's lede is amended to the mirror image: "Members pay
   Burnley RUFC." A reader who lands on the wrong one knows within one
   line.
3. **Only the Ovalball Plan page has the dark state block.** Visual
   difference at a glance, before any word is read.

Deliberately *not* chosen: renaming the existing tab (it is live, and
churning a familiar label to solve a new page's problem is a cost paid by
existing users), and a "this is not your member payments" warning (a
warning that has to explain a naming problem is a naming problem).

---

## 4. Release & Platform Mode — `/admin/releases`

The Beta↔Live switch decides whether Ovalball charges anyone. It is made
consequential by **saying what it does in plain words**, not by red.

The page's subject *is* the current state, so the state is the headline.
The button is labelled with its outcome — "Start charging clubs" — rather
than its mechanism ("Set mode to live"), because the outcome is what the
person needs to weigh. A reason is required; the dialog will not submit
without one, since the reason is the only thing the append-only history
will have to explain the decision later.

```
┌─────────────────────────────────────────────────────────────┐
│ ⬢ SITE ADMIN                                                 │
│ Release & platform mode                                      │
│ What Ovalball is running, and whether it is charging clubs.  │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▓▓▓▓▓ forest-950 ▓▓▓▓▓                                   │ │
│ │                                                          │ │
│ │  OVALBALL IS IN BETA                     [display-l]     │ │
│ │  No club is being charged. Trial time is paused for      │ │
│ │  every club and does not resume until Beta ends.         │ │
│ │                                                          │ │
│ │  Since 6 September 2026 · set by the system              │ │
│ │                                                          │ │
│ │                       ┌──────────────────────────────┐   │ │
│ │                       │  Start charging clubs        │   │ │
│ │                       └──────────────────────────────┘   │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Releases                              [ Record a release ]   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 0.0.2   Fixture calendar        Published   14 Sep 2026  │ │
│ │         a1b3c9f                             [ Unpublish ]│ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 0.0.1   First Beta release      Draft       6 Sep 2026   │ │
│ │         (no build recorded)                 [ Publish ]  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Mode history                                                 │
│ │                                                            │
│ ├─● Beta → Live          14 Sep 2026 · C. Kerr               │
│ │  "Sandbox UAT complete, first cohort billing starts."      │
│ │                                                            │
│ ├─● Live → Beta          10 Sep 2026 · C. Kerr               │
│ │  "Pausing billing while the pitch allocation bug is fixed."│
│ │                                                            │
│ └─● Beta                 6 Sep 2026 · system                 │
│    "Initial platform mode recorded…"                         │
└─────────────────────────────────────────────────────────────┘
```

The history is drawn as a **time rail**, not numbered markers: the content
genuinely is a chronology, and the rail says "this continues downward and
nothing can be removed from it", which is exactly what an append-only table
is. Numbered markers would imply a fixed sequence of steps, which it is
not.

Width `max-w-3xl`. Mobile: the dark block's button moves below the text and
goes full width; the rail keeps its line, the meta wraps under the title.

---

## 5. Commercial — `/admin/commercial`

The temptation is to open with counts. Counts are the least useful thing on
this page: nobody visits it to learn that eleven clubs are on Standard.
People visit it because something needs doing.

So **attention comes first**, and the counts are a quiet strip below it. If
nothing needs attention, that section says so in one line rather than
disappearing — an empty state here is good news and should read as good
news.

```
┌───────────────────────────────────────────────────────────────────┐
│ ⬢ SITE ADMIN                                                       │
│ Commercial                                                         │
│ Trials, subscriptions, credits and referrals across every club.    │
│                                                                    │
│ Needs attention                                                    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Cleckheaton RUFC     Payment failed 3 days ago      £15.00     │ │  amber-50
│ │                      Standard · past due            [ Open ]   │ │
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ Otley RUFC           Trial ends in 2 days                      │ │
│ │                      No plan chosen yet             [ Open ]   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ ─────────────────────────────────────────────────────────────────  │
│  11 on Standard   0 on Pro   6 on trial   1 past due               │
│  £45.00 credit outstanding   3 referrals pending   2 rewards earned│
│ ─────────────────────────────────────────────────────────────────  │
│                                                                    │
│ All clubs                                    [ search ]  [ filter ]│
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Club              Plan       Status     Next      Credit   ⋯   │ │
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ Burnley RUFC      Standard   Active     1 Oct     £0.00    ⋯   │ │
│ │ Otley RUFC        —          Trial 2d   —         £0.00    ⋯   │ │
│ │ Ilkley RUFC       Standard   Cancelled  —         £15.00   ⋯   │ │
│ └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

The counts strip is deliberately **not** six tiles. Big-number tiles are
for figures that are the point of the page; here they are context, and a
single line of running text with tabular figures says the same thing
without pretending to be a dashboard.

"Extend trial" lives in the row's `⋯` menu, not as a visible button — it is
rare, it is Full Site Admin only, and a visible button invites use. The
dialog asks for days and a reason.

Width `max-w-5xl`. Mobile: the table becomes one card per club; the counts
strip wraps to two lines; attention rows stack their meta.

---

## 6. Ovalball Plan — `/club/settings/ovalball-billing`

The state block answers the only three questions a Club Admin actually
has — what am I on, what happens next, and how much — before any table.

**The Beta case is not a banner.** It appears where the answer belongs: in
the "next collection" line itself. A banner at the top of the page is
something to scroll past; a sentence in the place you were already looking
is something you read.

```
┌─────────────────────────────────────────────────────────────┐
│ ⬢ CLUB SETTINGS                                              │
│ [ Overview | Club Profile | … | Subscriptions & Payments |   │
│                                        **Ovalball Plan** ]   │
│                                                              │
│ Ovalball Plan                                                │
│ Burnley RUFC pays Ovalball to use the platform. Payments      │
│ your own members make to the club are under Subscriptions &  │
│ Payments.                                                    │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▓▓▓▓▓ forest-950 ▓▓▓▓▓                                   │ │
│ │  FREE TRIAL · 18 DAYS LEFT               [display-l]     │ │
│ │  Your trial is paused while Ovalball is in Beta. The     │ │
│ │  18 days are held and start again when Beta ends.        │ │
│ │                                                          │ │
│ │  Next collection   Nothing while Ovalball is in Beta     │ │
│ │  Credit            £15.00                                │ │
│ │                                    [ Choose a plan ]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Plans                                                        │
│ ┌───────────────────────────┐ ┌────────────────────────────┐ │
│ │ Standard    £15 a month   │ │ Pro          £25 a month   │ │
│ │ Everything Ovalball does: │ │ Coming soon                │ │
│ │ teams, fixtures, calendar,│ │                            │ │
│ │ game management, …        │ │ Pro doesn't include        │ │
│ │                           │ │ anything Standard doesn't  │ │
│ │ [ Choose Standard ]       │ │ yet. When it does, you'll  │ │
│ │                           │ │ be able to switch.         │ │
│ └───────────────────────────┘ └────────────────────────────┘ │
│                                                              │
│ Billing history                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 1 Sep 2026   £15.00   Collected                          │ │
│ │ 1 Aug 2026   £0.00    Skipped — covered by your credit   │ │
│ │ 1 Jul 2026   £15.00   Failed — insufficient funds        │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Credit                                                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ +£15.00  Referral reward — Otley RUFC       12 Aug 2026  │ │
│ │ −£15.00  Applied to your 1 Aug collection   1 Aug 2026   │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Refer a club                                     ↓ section 7 │
└─────────────────────────────────────────────────────────────┘
```

### Pro, without the dark pattern

**No disabled button.** A greyed-out "Choose Pro" says "you are being
withheld from something", which is both unpleasant and untrue. The card
carries the price, the words "Coming soon", and one honest sentence:
*"Pro doesn't include anything Standard doesn't yet. When it does, you'll
be able to switch."*

That sentence is true, and the database proves it — the Phase E test suite
fails the moment Pro gains an entitlement Standard lacks, which is exactly
when this copy would become a lie.

The Pro card is visually quieter than Standard: same border, no fill,
`text-ink/55` body. It looks like information, not a blocked purchase.

### Every state the block has to handle

| State | Headline | Next collection line |
|---|---|---|
| Trial running | `FREE TRIAL · 18 DAYS LEFT` | "Nothing yet — your trial runs to 24 Sep" |
| Trial paused by Beta | `FREE TRIAL · 18 DAYS LEFT` | "Nothing while Ovalball is in Beta" |
| Trial paused by the club | `FREE TRIAL · PAUSED` | "Nothing while your trial is paused" |
| Trial ended, no plan | `TRIAL ENDED` | "Choose a plan to carry on" |
| Plan chosen, no mandate | `STANDARD · SETUP NEEDED` | "Set up your Direct Debit to start" |
| Active | `STANDARD` | "£15.00 on 1 October" |
| Active, credit covers it | `STANDARD` | "Nothing on 1 October — covered by your £15.00 credit" |
| Past due | `STANDARD · PAYMENT FAILED` | "We'll try again on 8 October" (amber accent line) |
| Cancelled | `STANDARD · ENDING` | "Runs until 30 September, then stops" |

Nine states, written out here because the failure mode of a billing page is
a state nobody wrote copy for.

Width `max-w-3xl`. Mobile: plan cards stack; the dark block's rows become
label-over-value; history and credit become two-line rows.

---

## 7. Refer a club

A section on the same page, not a separate one: a club thinks about
referring when it is looking at what Ovalball costs it.

The offer is quoted exactly as the engine actually behaves. "Successfully
collected" is doing real work in that sentence and must survive editing —
a reward is not earned on sign-up, on a trial, or on a submitted payment.

```
│ Refer a club                                                 │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Refer another rugby club to Ovalball. If they start a    │ │  mint-100
│ │ paid subscription and their first payment is             │ │
│ │ successfully collected, your club gets one month of its  │ │
│ │ current plan free.                                       │ │
│ │                                                          │ │
│ │ [ Refer a club ]              Referral terms             │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Otley RUFC      Reward earned  +£15.00      12 Aug 2026  │ │  mint-100/70
│ │ Ilkley RUFC     On Ovalball, not yet paid    3 Sep 2026  │ │  ink/5
│ │ Skipton RUFC    Invitation sent              5 Sep 2026  │ │  ink/5
│ │ Keighley RUFC   Already an Ovalball club    1 Aug 2026   │ │  ink/5
│ └──────────────────────────────────────────────────────────┘ │
```

Statuses are written as **what happened**, never as the database's word:

| Stored | Shown |
|---|---|
| `pending` | Invitation sent |
| `registered` | On Ovalball, not yet paid |
| `qualified` | Reward earned |
| `rejected` | (the actual reason, e.g. "Already an Ovalball club") |
| `reversed` | Reward withdrawn — their payment didn't complete |

`reversed` gets amber. Nothing else in this list is coloured, because
colour here would imply competition between rows.

---

## 8. Nav placement

- Site Admin: `Release & Platform Mode` and `Commercial` join the existing
  `/admin/*` list in `lib/app-context/build-nav-items.ts`, gated on the
  Phase C/D capabilities rather than on `siteAdminRole === "full"`, so a
  delegated admin sees exactly what they hold.
- Club Admin: `Ovalball Plan` joins the Club Settings tab strip, gated on
  `club.platform_billing.view`.

---

## 9. What was considered and rejected

| Idea | Why not |
|---|---|
| Red danger zone around the Beta switch | The action is not dangerous, it is consequential. Red is for mistakes; this is a decision. |
| Six big-number tiles on the Commercial page | The numbers are context, not the point. Leading with them buries the two clubs that need help. |
| A "this is not your member payments" banner | A warning that exists to explain a naming problem means the naming is wrong. Fixed the naming instead. |
| Disabled "Choose Pro" button | Reads as withholding. There is nothing to withhold — Pro has no extra features yet, and saying so is both truer and kinder. |
| A Beta banner across the club billing page | Banners get scrolled past. The answer belongs in the "next collection" line, where the question is asked. |
| Numbered markers on the mode history | It is a chronology, not a sequence of steps. A time rail carries "append-only" correctly; numbers do not. |
