# Section 10 — Club Messaging

## PURPOSE

Reach `club_conversations` (CA-M9's canonical club-to-club message-request domain:
`start_or_get_club_conversation`, `respond_to_club_conversation`) from Clubhouse itself, on both
clients, and close a real defect found auditing it before building anything. No new table, no new RPC.

## AUDIT FINDINGS (BEFORE BUILDING, PER THE RED RISK RATING)

- **Web already has a complete "start a new club conversation" flow** at `/messages/new`
  (`club-search.ts` + `club-actions.ts` + `new-message-form.tsx`) and a complete request-decision control
  (`message-request-decision.tsx`), wired into `[kind]/[id]/page.tsx`. Both were fully built and
  fully unused from Clubhouse — `club-map-card.tsx`'s own comment said so explicitly: *"Message Requests
  isn't built yet... a partner club deliberately gets no 'Message' action here."* That comment named
  exactly this section.
- **Mobile's generic thread screen (`[kind]/[id].tsx`) already recognises `"club"` as a valid
  `ConversationKind`** and `apps/mobile/src/messages/conversation.ts` already has real, working
  read/send/mark-read/realtime handling for it — built once, shared with fixture and request threads.
  Nothing on mobile ever called `start_or_get_club_conversation` or `respond_to_club_conversation`,
  and the inbox list (`loadInbox` → `packages/contracts`'s `getMessengerRows`) already lists an
  existing club conversation correctly. The gap was narrower than "mobile has none of this": it was
  specifically *starting* one and *answering* one.
- **A real, live-reachable defect, found auditing before touching anything**: mobile's
  `conversationHeader` computed `canSend: data.status !== "closed"` for a club conversation — true for
  `pending`. But ordinary message inserts are RLS-gated on `club_conversations.status = 'accepted'`
  (`fixture_messages_insert_scoped`, `20260903600000_club_conversations.sql:125`); a pending
  conversation's own first message and the accepted system event are both written by the SECURITY
  DEFINER RPCs directly, bypassing that gate. So a recipient opening a pending club-message request on
  mobile saw an apparently-active composer that would fail against RLS the moment they tried to reply —
  and had no control anywhere to actually accept or decline the request, so it could never become
  answerable. Fixed to `canSend: data.status === "accepted"`, and a request-decision banner (mirroring
  the website's own) added so the state is answerable rather than just correctly blocked.

## WEB

- `app/(app)/clubhouse/message-club-dialog.tsx` (new): "Message This Club", pre-selected, calling the
  existing `startClubConversation` server action and routing straight into `/messages/club/<id>` — never
  a second search for a club already on screen.
  `packages/contracts/src/clubhouse/club-detail.ts`'s `ClubNetworkActions` gained `canMessage`
  (club-scope `club.partners.manage` or `fixture.request.create`/`.respond` — the same practical
  population `can_manage_club_fixtures` admits, and deliberately never partnership-gated, since the RPC
  itself works between any two clubs). `club-map-card.tsx` offers it beside Find a Fixture, for any real
  Ovalball club, whether or not a partner. `myClubId` threaded down from `page.tsx`'s own
  `activeClubId(ctx, activeContext)` through `PartnerClubsExplorer`/`ClubMap`.

## MOBILE

- `apps/mobile/src/messages/club-conversations.ts` (new): `startClubConversation`,
  `respondToClubConversation`, `searchClubsForMessaging` — plain client-callable wrappers reproducing
  the website's own `club-actions.ts`/`club-search.ts` exactly, no service role.
- `apps/mobile/src/messages/conversation.ts`: `conversationHeader` now also computes `clubRequestSide`
  (the viewer's own active `club_memberships` against `requesting_club_id` — an ordinary fact about
  themselves, not an authority decision; `respond_to_club_conversation` re-checks the real authority
  regardless) and `clubOtherClubName`; fixed the `canSend` defect above.
- `apps/mobile/app/(tabs)/messages/[kind]/[id].tsx`: new `MessageRequestBanner`, shown when
  `kind === "club" && clubConversationStatus === "pending"` — the requester sees a waiting notice, the
  recipient sees Accept/Decline, mirroring the website's `MessageRequestDecision` component and closing
  the "received, listed, read, never answerable" gap that component's own web-side comment described.
- `apps/mobile/app/(tabs)/clubhouse/map.tsx`: "Message This Club" in the club sheet, gated on the new
  `detail.actions.canMessage`, with an inline compose box (first message only, matching the Invite
  pattern already in this file) that calls `startClubConversation` and routes to
  `/messages/[kind]/[id]` with `kind: "club"`.

## SCOPE DELIBERATELY NOT TAKEN

No standalone "search for a club to message" screen was added to mobile Messages. `/messages/new`'s
club search remains web-only for "I don't yet know which club" — Clubhouse (map/list/sheet) is already
the club-browsing surface on both clients, and the natural entry point is "message the club I'm already
looking at," not a second search duplicating Clubhouse's own.

## TESTING (RISK-BASED)

`supabase/tests/js/clubhouse.test.mts`: 4 new/corrected assertions pin `canMessage`'s exact rule
(needs either capability signal, never for your own club, never partnership-gated). The `updated`
deep-equal assertion for a no-capability viewer now includes the new field.
`fixture_request_negotiation_projection.test.mts` (Section 9) unaffected, re-run together (43/43
passing). The `conversationHeader`/`respondToClubConversation` logic itself was not extracted into a
pure, DB-free unit — it is simple (three field reads plus one set lookup) and TypeScript-checked, but a
live-device/browser walkthrough of an actual two-club message request (send → pending → accept →
reply) was **not** performed this pass — recorded as an explicit gap for the final report, not silently
skipped. Both clients' `tsc --noEmit` are clean. ESLint on every touched file shows only pre-existing,
unrelated findings (confirmed via `git stash` diff on each).

## KNOWN DEBT

None new.
