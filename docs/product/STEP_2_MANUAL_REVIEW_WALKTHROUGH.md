# Step 2 — manual Chrome review walkthrough

> ## This file is the canonical local UAT persona directory
>
> The identities and club below were established for the Step 2 review and are
> now **permanent review personas for the rest of the convergence programme**.
> They are not per-step scaffolding.
>
> **Future manual-review documents must link here rather than copy this.** They
> say *"Review persona: Club Admin — use the canonical local UAT Club Admin
> documented in STEP_2_MANUAL_REVIEW_WALKTHROUGH.md"* and then give only their
> own START URL, NEW DATA FOR THIS STEP, WALKTHROUGH and WHAT TO JUDGE. Login
> instructions are written down once, here.
>
> **Reuse and enrich; do not recreate.** A later step needing fixtures, training,
> availability, another child, messages or competitions adds them to *this* world
> through canonical product writes. A new persistent identity is justified only
> when no existing persona can legitimately represent the context — a second Club
> Admin for two-admin security flows, a Player, a Governing Body administrator —
> and is then added to the table below.
>
> **Do not tear this down as ordinary cleanup.** Automated suites create and
> clean their own isolated fixtures and must never read ambient review data;
> `recipient_audience_engine.sql` did, and was corrected rather than
> accommodated. The teardown command refuses without an explicit destroy flag.

Everything below is **local**. No production data is involved and no production
identity was created. The club and every person in it exists only in the local
Supabase instance.

---

## Getting in

| | |
|---|---|
| **Local app** | <http://localhost:3000> |
| **Local mail inbox** | <http://localhost:54324> |

There is **no password** for these accounts, and none was created. Local Ovalball
signs in by emailed link:

1. <http://localhost:3000/login>
2. **Sign in with email**
3. type the address
4. **Email me a link instead** — password is the primary method, so this switch is
   required
5. **Send** (or equivalent), then open <http://localhost:54324> and click the link
   in the newest message

To swap persona, sign out and repeat with a different address.

> One caution from earlier work: type into the email field, don't paste over an
> autofilled value without checking what the field actually holds. It is a
> React-controlled input and the form submits what the component holds.

---

## Review club

**Step 2 Review RFC** — Harrogate, North Yorkshire. Three teams:
**Under 12 Boys**, **Under 14 Girls**, **Men's 1st Team**.

Every address below is `@ovalball.test` and begins `review.step2.`

| Sign in as | Person | Club role | Team roles | Why they exist |
|---|---|---|---|---|
| `review.step2.admin` | **Hannah Whitmore** | Club Admin | — | **Your main review login.** |
| `review.step2.secretary` | **Gordon Pike** | Fixture Secretary | — | The third club-wide role. |
| `review.step2.coach` | **Dev Raman** | Member | Coach (U12) · Manager (U14 Girls) | One person, two teams, two different roles. |
| `review.step2.manager` | **Sian Lowry** | Member | Manager (Men's 1st) | **The team-scope review login.** |
| `review.step2.member` | **Tomas Beck** | Member | — | **The safe one.** All role changes happen here. |
| `review.step2.volunteer` | **Nadia Oyelaran** | Member + Volunteer | — | Section E. |
| `review.step2.guardian` | **Marta Ferreira** | Member | — | Guardian of **Leo Ferreira** (U12). |
| `review.step2.officer` | **Priya Devlin** | Member + Safeguarding Officer (**PENDING_CONFIRMATION**) | — | Section H. |
| `review.step2.overridden` | **Karl Ndlovu** | Member | — | Has **one capability granted directly**. Section B. |

**Waiting, requested and pending**

| | |
|---|---|
| Pending invitation | `review.step2.invitee@ovalball.test` — Coach at Men's 1st, Team Manager at U12 |
| Club join request | **Rowan Ashby** (`review.step2.applicant`) — membership sits at `pending`, so he is in the queue and not in the People list |
| Player join request | **Mina Kovac**, 13 — on `/club/join-requests` |
| Capability override | Karl Ndlovu, `fixture.fixture.create`, **grant** |
| Safeguarding nomination | Priya Devlin, **PENDING_CONFIRMATION**, zero authority granted |
| Guardian link | Marta Ferreira → Leo Ferreira, active, Leo in the U12 squad |

**Managing the review world**

```
node scripts/review-fixtures/step2-review-club.mjs report   # what is installed
node scripts/review-fixtures/step2-review-club.mjs verify   # how it differs from the state `up` built
node scripts/review-fixtures/step2-review-club.mjs up       # build it (ids change — see the warning below)
node scripts/review-fixtures/step2-review-club.mjs down --destroy-the-canonical-review-world
```

`verify` **reports, it never fixes**. A difference is not automatically a
problem: approving a join request or revoking an invitation is what reviewing the
product looks like, and those changes belong to whoever made them.

> ### Which actions here change the review world permanently
>
> Rebuilding with `up` is **not** a way to undo something. Every id is
> regenerated, so every URL written down in this document stops working.
>
> | Section | Effect |
> |---|---|
> | **C** club role change | Reversible in the same control. The walkthrough tells you to put it back, and you should. |
> | **D** team role add/remove | Reversible in the same control. |
> | **F** revoking the invitation | **Permanent.** The invitation is gone for good. Ask me to issue a fresh one — that is one `issue_invitation` call, not a rebuild. |
> | **G** approving or declining either join request | **Permanent.** The request is decided and cannot be un-decided; approving the club request also makes Rowan Ashby an active member. Ask me to seed a fresh request. |
> | **K2** removing club access | **Permanent** if you confirm. The walkthrough tells you to open the dialog and cancel. |
>
> None of these is a reason to hold back — it is your review world. Just tell me
> what you used up and I will replenish it through the canonical path.

---

## A. Users & Permissions overview

**Start:** sign in as **Hannah Whitmore** → <http://localhost:3000/people>
(sidebar: **Users & Permissions → Overview**)

**What to look at, without clicking anything**

The page is one column, top to bottom: **Waiting On You**, **People**, **Invite
Someone**, **Roles & Access**.

- **Waiting On You** holds four things that used to live in four unrelated
  places: Rowan Ashby's join request with Approve/Decline; the invitation to
  `review.step2.invitee` showing *Men's 1st Team: Coach · Under 12 Boys: Team
  Manager* and when it expires; and a counted link to **Players Asking to Join
  (1)**. Guardian requests would appear here too if any were waiting.
- **People** lists nine active members. Dev Raman carries two team chips, Sian
  Lowry one. Hannah has no **Remove** button — you cannot remove yourself.
- **Roles & Access** names Permissions, Guardians & Players, Guardian Requests and
  Safeguarding Officer. These are **doors, not merges** — each remains its own
  authority.

**Expected**
Nine members, one join request, one invitation, one player request. Rowan Ashby
appears *only* in the queue, never in the People list.

**Judge**
Does this answer "who has access to my club?" on arrival? Is the order right —
what is waiting, then who is here, then how to add someone, then the specialist
screens? **There is no search box**; nine people fit on a screen and a real club
of two hundred would not. Is that a Step 2 gap or a later one?

> **Corrected since the first pass (L3):** Gordon Pike used to read **Fixture
> Secretary** here and **Fixtures Secretary** on Permissions and in the Invite
> Someone menu. One role, two spellings. The established product term is now
> mapped in presentation at both places — no migration, no second role identity,
> the catalogue key untouched. The remaining inconsistency is underneath: the key
> is `FIXTURES_SECRETARY` in one table and `FIXTURE_SECRETARY` in two others,
> which is recorded in the ledger for its schema owner.

---

## B. One person's access, and why

**Start:** from **/people**, click **Access & Teams** under **Karl Ndlovu**

**What to look at**

- **Club Access** — Member, with a plain sentence saying where the club-wide role
  is changed.
- **Team Access** — "No team roles."
- **What They Can Do** — **3 of 10 allowed**, then every one of the ten
  capabilities this club decides, each with a verdict and a sentence.

**The comparison you asked for, on one screen**

| | verdict | sentence |
|---|---|---|
| **View Fixtures** | Allowed | "…because a role they hold at this club includes it." |
| **Create Fixtures** | Allowed | "…because **someone granted it to them directly, on top of their role**." |
| **Edit Fixtures** | Not allowed | "…because nothing they hold grants it, and nothing needs to be removed." |

Underneath each, where the club can act, a line saying what to do about it —
"Clear the extra permission to fall back to their role", "Grant it directly, or
give them a role that includes it."

**Now open Tomas Beck** (an ordinary member, no override). He reads **2 of 10**.
The difference between 2 and 3 is exactly Karl's one granted capability.

**Expected**
Every sentence names a mechanism in English. No reason codes, no `ROLE_BUNDLE`,
no capability keys, no table names anywhere on the page.

**Judge**
Does "WHY does this person have access?" get answered? Is a decisive rule the
right thing to show, or do you want the whole chain? Is ten the right number of
permissions to explain here, given Permissions itself decides exactly these ten?

> These answers are not computed by the page. `public.explain_access` re-runs the
> same resolver the enforcement path runs, so what you read is what the person
> actually meets.

---

## C. Change a club role, and watch it propagate

**Start:** <http://localhost:3000/people>

| | |
|---|---|
| **Person** | **Tomas Beck** (`review.step2.member`) |
| **BEFORE ROLE** | **Member** |
| **ACTION** | On his row, change the role select to **Fixture Secretary** |
| **EXPECTED AFTER ROLE** | **Fixture Secretary**, saved immediately, no Save button |

**Verify propagation — change once, see it in three places**

1. **/people** — his row now reads Fixture Secretary.
2. **Access & Teams** for Tomas → **Club Access** reads Fixture Secretary, and
   **What They Can Do** jumps from **2 of 10** to **9 of 10**, with each newly
   allowed line now explaining "because a role they hold at this club includes
   it."
3. **/club/permissions** → his row reads **Fixtures Secretary · 9 of 10 allowed**,
   matching Gordon Pike exactly.

**Put it back** by setting the select to **Member**. All three surfaces return to
2 of 10.

**Why Tomas.** He is the only member with nothing else attached, so nothing else
in the review is disturbed. The last-Club-Admin guard is never approached: Hannah
is the only Club Admin and her own select is disabled.

**Judge**
Is one canonical change reaching every consumer? Does the *explanation* change
with the role, or does it go stale?

---

## D. Give an existing member a team role, and take it away

**Start:** **/people** → **Access & Teams** for **Tomas Beck**

1. Under **Team Access** → **Give Tomas Beck a Team Role**
2. Team: **Under 14 Girls** · Role: **Coach** · Reason: anything, e.g.
   *Helping out with the U14s this season*
3. **Give Team Role**

**Expected** — the empty state is replaced by a row: *Under 14 Girls · Coach*,
with **Remove** beside it.

**Verify it is the same canonical relationship, not a screen state**

4. Go to **Teams → Under 14 Girls**
   (<http://localhost:3000/teams/35da26fa-f1a9-44ef-aeb3-32447fc5664e>)
5. **Team People → Coaches** now shows **Tomas Beck — Coach — Active**, beside
   Dev Raman.
6. Back to **/people** — his row carries an *Under 14 Girls — Coach* chip.

**Now remove it**

7. On his access page, **Remove** next to Under 14 Girls.
8. It disappears from the team page and from his row on /people.

**Notes worth knowing before you judge**

- Only **Team Admin, Coach, Manager** are offered. `view_only` is what a parent or
  player holds, and it arrives through guardianship and squad membership — it is
  deliberately not something a club picks from a menu.
- If you try to give a **Coach** or **Manager** role to somebody whose record does
  not show they are an adult, the database refuses and the page shows its words:
  *"The Coach role needs a date of birth on file showing this person is an adult
  before it can be given."* Every review persona has a date of birth, so this
  will not fire unless you go looking for it.
- **You may give yourself a team role.** Try it on Hannah's own page if you like.
  This is the rule, not an oversight: a Club Admin already holds authority over
  every team, so this records who is doing the job rather than widening what they
  may do. A Team Admin or a Site Admin doing the same thing is refused.

**Corrected since the first pass (L4) — check this while you are on the team page**

Sign in as **Sian Lowry** and open **Men's 1st Team**. The page used to end with
*"Only this club's Club Admin can edit team details or assign people"* —
immediately beneath an assign control she is genuinely entitled to use, because
the sentence was gated on a session-wide role flag while the control was gated on
`team.roster.manage`.

It now reads: *"You can manage who is in this team. Changing the team's own
details is done by the club."* The explanation asks the same flags the controls
ask, and **names no role at all** — naming "Club Admin" is what let the copy drift
from the capability engine, and a club that moved that capability elsewhere would
have been told the same untruth again.

**Judge**
Is the person the right place to add a team role from, or should it stay on the
team? Is "Reason" in the right place, and should it be required? Does the new
sentence tell a Team Manager something true and useful?

---

## E. Volunteer

**Start:** **/people** → **Access & Teams** for **Nadia Oyelaran**, then
**/club/permissions**

**What you will see**

- On **/club/permissions**, Nadia is captioned **Volunteer** — the role is real,
  recorded and displayed.
- She resolves at **2 of 10 allowed** — **identical** to every ordinary member in
  the club.
- Her access page explains each capability as "because nothing they hold grants
  it" — never "because their Volunteer role includes it", because it does not.

**The honest position.** `VOLUNTEER` is a visible role in `role_definitions` and
is offered in the Invite Someone menu. It has **zero rows** in
`role_capability_defaults`. A Volunteer therefore receives exactly what an
ordinary member receives, and the word is a label the club can record, not a
grant.

**What you can legitimately tune today:** nothing about the Volunteer role
itself. You can grant or withhold individual capabilities for Nadia on
**/club/permissions**, exactly as for any member — that is a per-person override,
not a Volunteer capability bundle.

**Owned by Identity/Auth Slice 8**, and not pretended to exist here: a capability
bundle behind Volunteer, club-defined volunteer variants, and any custom-role
machinery. Nothing was built to make the word look like it does something.

**Judge**
Is a role that records a fact and grants nothing acceptable as an interim, or
should it be hidden until Slice 8 gives it meaning?

---

## F. Pending invitation, and revoking it

**Start:** <http://localhost:3000/people> → **Waiting On You**

**The invitation to prove the canonical source**

> `review.step2.invitee@ovalball.test`
> Men's 1st Team: Coach · Under 12 Boys: Team Manager
> Expires 25 September 2026 — **Waiting**

This is the proof you asked for. Before Step 2 this section read
`public.invitations`, which has held zero rows since `issue_invitation` began
writing `public.access_invitations` — so **no invitation could ever appear here,
and the Revoke button could never be drawn**. It now reads
`invitations_admin_view`, the secret-free projection of `access_invitations`
(no token hash, no code). The per-team roles you can see are the invitation's own
`intended_outcome` — what redemption will actually apply.

**To verify revocation** — revoking is **permanent**: rebuilding the world with
`up` would regenerate every id and break every URL in this document, so it is not
an undo. Revoke it if you want to see the journey, and tell me — reissuing one
invitation is a single `issue_invitation` call.

1. **Revoke** → **Confirm**
2. The row leaves the queue.
3. Confirm it genuinely changed state, not just the screen:
   ```
   node scripts/review-fixtures/step2-review-club.mjs report
   ```
   The invitation line reads **REVOKED**. Who revoked it and the reason are both
   recorded against the row.

**Still missing, and not Step 2 failures** — the human code presentation, copy and
share improvements, QR, resend, and anything about how a joining link is
distributed. Those are Step 3.

**Judge**
Does the queue tell you enough to decide? Should revoking ask for a reason in the
UI rather than recording a default one?

---

## G. Join requests — two queues, two kinds

**Start:** <http://localhost:3000/people>

**A person asking for club access** — **Rowan Ashby**, in **Waiting On You**,
reading *"Asked to join as: Member"*. Before Step 2 that line read **"Says they
are: BASIC_USER"**. **Approve** makes him a member and gives no other role;
**Decline** requires a reason.

**A player asking to join** — click **Players Asking to Join (1)**
(<http://localhost:3000/club/join-requests>). **Mina Kovac**, 13, with a **Which
team?** choice listing all three sides. Ovalball has worked out the category she
is eligible for, not which of your teams she belongs in.

These are genuinely two different decisions on two tables, and Step 2 deliberately
kept them apart while making both reachable from one place.

**Judge**
Is one counted link the right treatment for the player queue, or should those
rows sit inline with the club join requests?

---

## H. Safeguarding Officer — corrected

**Start:** <http://localhost:3000/club/settings/safeguarding>

**What the fixture contains.** **Priya Devlin** was nominated as primary
Safeguarding Officer through the real RPC
(`nominate_club_safeguarding_officer`), which returned `PENDING_CONFIRMATION` —
*"Nominated. Ovalball must confirm the appointment before it grants anything."*
Nothing was mutated to stage it and the state machine is untouched.

**What was wrong, and is now fixed (L2).** The appointment lives in
`role_assignments` — the 4G state machine, which is why
`confirm_safeguarding_officer` takes an **assignment** id.
`club_safeguarding_officers` is a separate **contact register**, written only by
the invite-an-outsider path. This page read only the register, so it announced
*"No primary Safeguarding Officer"*; `/club/permissions` read the assignment
without its confirmation state and captioned Priya **"Safeguarding Officer"**
outright. Two screens, one state, two contradictory claims, and neither said
*waiting*.

**What you should see now**

- Here: an **Awaiting Confirmation** section naming Priya as **Safeguarding
  Officer — Pending confirmation**, with one sentence: *"Nominated by the club and
  waiting for Ovalball to confirm the appointment. Until it is confirmed they hold
  no Safeguarding Officer authority."* The page no longer offers to nominate a
  primary officer it is already showing as nominated.
- On **/club/permissions**: Priya captioned **"Safeguarding Officer — Pending
  confirmation"**, and still **2 of 10 allowed** — the ordinary member figure,
  identical to Marta, Sian and Tomas.

There is one reader of the appointment and one wording for its state, so the two
screens cannot disagree again.

**Judge**
Does *"Safeguarding Officer — Pending confirmation"* read correctly to you, or do
you want different words? Is the explanation in the right place and the right
length? Is there anywhere else an appointment ought to be visible?

## I. Team scope — the same concept, none of the club's authority

**Start:** sign out, sign in as **Sian Lowry** (`review.step2.manager`)

**What she has**

- Sidebar: **Dashboard · Team · Fixtures & Calendar · Communications**. No Users &
  Permissions group. No Club Management.
- **Her own team is reachable without a URL**, from **Team** in the sidebar
  (<http://localhost:3000/teams/a76af921-018e-45cb-812e-a2e2d1356ccb>). It shows
  **Team People** — Coaches / Parents & Guardians / Players / Requests — her own
  row, an **Assign an existing club member** control offering **Coach** and
  **Manager** only (never Team Admin, which only the club gives), and the **Team
  Join Code** section.
- **Another team is not administrable.** Open **Under 12 Boys**
  (<http://localhost:3000/teams/e9b0f1cf-7ac6-4c14-ace9-3dec06d0a0c1>): she can
  see it, and there is no assign control and nothing to change.

**No Club Admin authority is gained.** Type these into her session and each is
refused **by the server**, not merely unlinked:

| URL | Result |
|---|---|
| `/people` | → `/dashboard` |
| `/people/8a68e003-fac2-41d6-8fa3-2b90d4884d78` (Tomas) | → `/dashboard` |
| `/club/permissions` | → `/dashboard` |

> **Corrected since the first pass (L4).** The page used to end with *"Only this
> club's Club Admin can edit team details or assign people"* — directly beneath
> an assign control she is genuinely entitled to use. It now reads *"You can
> manage who is in this team. Changing the team's own details is done by the
> club."*, gated on the same flags as the controls and naming no role.

**Judge**
Is "Team" the right sidebar label for a person with one team? Should a Team
Manager see a people-and-access page of her own, or is the team page enough?

---

## J. Site Admin scope

**Start:** sign out, sign in as `uat.fullsiteadmin@ovalball.test` →
<http://localhost:3000/admin/users>

**What you will see.** The sidebar's first group is **Users & Permissions** — the
same vocabulary Step 1 settled and Step 2 now uses at club scope. **User
Management** lists Ovalball accounts, and opening one gives a per-person page with
**Account**, **Club Memberships**, **Family Relationships**, **Pending Requests**
and **Audit**.

**What Step 2 did here: nothing structural, on purpose.** The site-scope variant
of this concept already existed and is in some respects ahead of the club one.
Rebuilding it would have been a second answer, not a convergence.

**One deliberate gap, stated rather than filled.** The site person page has **no
"why can they do this" section**. `public.explain_access` accepts a Site Admin
caller perfectly well, but there is no site-scope capability catalogue equivalent
to the club's ten, and inventing one to have something to explain would be exactly
the parallel permissions table this programme forbids. That catalogue is a product
decision.

**Do NOT expect these yet** — none is implemented and none is pretended:

- Slice 7e master-control surfaces
- AAL2 / step-up enforcement on privileged actions (**T0**: no MFA enforcement
  groups exist, so `session_aal_ok()` is true for everyone)
- impersonation / "act in club" support sessions with their view-only and blocked
  behaviours
- site-scope capability explanation, per the gap above

**Judge**
Does the Site Admin surface now read as the same product concept at a bigger
scope? Where does its vocabulary still diverge from the club's?

---

## K. Existing functionality parity — the checklist

Every one of these worked before Step 2 and works now. Walk them in any order;
each says exactly where it lives **today**.

| # | Function | Where it lives now | How to see it |
|---|---|---|---|
| 1 | **Change club role** | `/people` — the select on the person's row | Section C |
| 2 | **Remove club access** | `/people` — **Remove** on the row, reason required | Open it on Tomas Beck and **cancel** — do not confirm, it is not needed for review |
| 3 | **Remove team role** | `/people/[person]` — **Remove** beside the team | Section D, step 7 — **new**, it had no reachable control before |
| 4 | **Invite someone** | `/people` — **Invite someone** | Section F |
| 5 | **Per-team invitation roles** | Invite Someone form — one role select per team | Open the form: four controls — one club role, then one per team (U12, U14 Girls, Men's 1st), each offering **Not assigned / Coach / Team Manager** |
| 6 | **Pending invitations** | `/people` → Waiting On You | Section F — **was never visible before** |
| 7 | **Revoke invitation** | `/people` → the invitation's **Revoke** | Section F — **was unreachable before** |
| 8 | **Join request approve/decline** | `/people` → Waiting On You | Section G |
| 9 | **Player join requests** | `/club/join-requests` | Section G |
| 10 | **Guardians & Players** | `/club/settings/guardians`, linked from Roles & Access | Marta Ferreira → Leo Ferreira appears there |
| 11 | **Guardian requests** | `/guardian-requests`, linked from Roles & Access | Empty in this fixture; the door is permanent |
| 12 | **Fixture Secretary** | `/people` role select; `/club/permissions` shows the effect | Gordon Pike, 9 of 10 |
| 13 | **Safeguarding Officer** | `/club/settings/safeguarding` | Section H |
| 14 | **Permissions** | `/club/permissions`, linked from Roles & Access | Section B/E |
| 15 | **Team join-code administration** | `/teams/[team]` → Team Join Code | Section I — untouched by Step 2 |

**FUNCTIONS LOST: 0**

Two changes of location, both deliberate and both still reachable:

- **Join requests** moved from a section of their own on `/people` into **Waiting
  On You** on the same page. Same controls, same place, grouped.
- **Guardian requests** was a bare link at the top of `/people`. It is now a
  permanent entry in **Roles & Access**, *plus* a counted queue in Waiting On You
  when something is waiting. An earlier draft put it only in the queue, which made
  the door vanish whenever the queue emptied; that was caught and corrected before
  banking, and a test now pins it.

**Functions gained: 4** — see a waiting invitation and what it will grant; revoke
one; give an existing member a team role from the page about that person; and be
told *why* somebody can or cannot do each thing.

---

## The governing body in this world (Convergence Steps 14–15)

The canonical review world also carries **one synthetic rugby organisation**, so the Governing Body
workspace can be reviewed with the same people, in the same club, as everything else.

It is rebuilt by:

```
node scripts/review-fixtures/step2-review-club.mjs enrich-governing
```

Idempotent, and it never touches the owner's own review material.

| | |
|---|---|
| Organisation | **Ovalball Review County RFU** — `source = 'local_review'`, clearly synthetic |
| Workspace | `/governing/7d01b631-86fb-4c44-9708-e22b83daf744` |
| Administrator | `uat.preston.admin@ovalball.test` — **also a Club Admin**, which is the point |
| Competitions Officer | `uat.coach@ovalball.test` — also a club coach |
| Viewer | `uat.adult.player@ovalball.test` |
| Affiliated clubs | 5, **all synthetic** (Step 2 Review RFC, Ovalball UAT RUFC, Step 6 A11y RFC, UX3 Busy RUFC, UX3 Other RUFC) |
| Competition | **Review County Junior Cup**, created through the product, in the canonical current season |

**Preston Grasshoppers RFC is deliberately not affiliated.** It names a real club, and recording a
real club as belonging to an invented union — even locally — is the kind of plausible-but-wrong data
that gets believed later.

### Its competition (Convergence Step 16)

```
node scripts/review-fixtures/step2-review-club.mjs enrich-governing-competition
```

**Review County Junior Cup** — four **Under 12 Boys** sides from four affiliated clubs (all four
genuinely field one), six matches issued, three with results, and twelve club answers outstanding. Every
record was written through the product's own competition RPCs, so the draw and the verification rows are
exactly what the Competition Creator would have made.

That makes both halves reviewable at once:

| side | where |
|---|---|
| the organiser | `/governing/<body>/competitions` → **Results & Table** |
| the club | sign in as a Club Admin of an entered club → **Fixtures & Calendar → Competitions** → *Competitions You're In* |

`uat.coach@ovalball.test` is deliberately **both** — a Club Admin at Ovalball UAT RUFC and the county's
Competitions Officer — so the two jobs can be compared on one account.

**The review to do here is the cross-context one.** Sign in as `uat.preston.admin`, note that the
default context is still their **club**, then switch to *Ovalball Review County RFU* in the context
switcher. The navigation should become Overview · Clubs · Competitions · People & Access, their
club's Fixtures, Teams and People should be **gone**, and the sidebar should still say their own
name with the organisation beside the role. Switching back should restore the club exactly.

## What is still open

`docs/product/CONVERGENCE_LEDGER.md` holds the programme ledger.

| | | |
|---|---|---|
| **L1** | The dead `club_invitation` email branch in `lib/email/recipients.ts` — zero callers, reads the empty `public.invitations` | **Step 3 — Invitations & Joining Product Closure** |
| **L3** | The *presentation* is fixed; underneath, one role still has two keys — `FIXTURES_SECRETARY` in `role_definitions`, `FIXTURE_SECRETARY` in `club_memberships` and `role_capability_defaults` | schema/auth cleanup owner |

**L2, L4, L5 and L6 are closed.**
