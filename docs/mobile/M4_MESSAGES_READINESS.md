# M4 — Messages readiness

What the platform already decides, and what M4 builds on top. Classified for implementation.

## The model, as it actually is

**Seven containers, one message table.** `fixture_messages` with exactly one of `fixture_id`,
`fixture_request_id`, `club_conversation_id`, `team_conversation_id`, `safeguarding_conversation_id`,
`announcement_id`, `direct_conversation_id` — enforced by CHECK. *(The M3 note said five; it was
written before `team_conversations` and `safeguarding_*` were looked at. Corrected there.)*

**Announcements are not conversations.** `announcement_id` is its own container, with a `reply_mode`
and a withdrawal state; `my_announcements` scopes delivery to the caller. One-to-many, not a thread.
They are kept distinct.

**No canonical message length.** `fixture_messages.body` has no length constraint — only
"not blank unless it is an image". So mobile imposes none either. The only `maxLength` in the product
is an announcement's 120-character title.

| concern | status | detail |
|---|---|---|
| inbox rows | **READY** | `getMessengerRows`, shared since M3 |
| conversation read | **READY** | `getDirectThread`, `loadThreadMessages`, shared |
| send | **READY** | insert into `fixture_messages`; RLS decides |
| read state | **READY** | `mark_direct_conversation_read` |
| unread counts | **READY** | summed from the same rows; `my_unread_message_counts` also exists |
| **recipient discovery** | **READY** | `my_direct_message_candidates()` — a per-caller FUNCTION |
| **starting a conversation** | **READY** | `open_direct_conversation(other_user_id)` |
| **safeguarding** | **READY, server-side** | `internal.may_direct_message` — see below |
| **realtime** | **READY, reusable** | private channel on `presence:<kind>:<id>`, broadcast carries no content |
| inbox pagination | **NEEDS SMALL SHARED CONTRACT** | `my_direct_conversations(p_limit)` takes a limit; the assembler does not expose one |
| conversation pagination | **NEEDS SMALL SHARED CONTRACT** | `loadThreadMessages` reads a whole thread |
| attachments | **DEFERRED** | reader returns them with signed URLs; no native renderer |
| reporting / deletion / moderation | **DEFERRED** | `report_message`, `moderator_delete_message` exist |
| announcements as a screen | **DEFERRED** | listed with unread state, not openable |
| Support threads | **DEFERRED** | own reply rules |
| push, notification inbox, badges from push | **M7 NOTIFICATIONS** | the typed intent is ready |
| Site Admin message tooling | **WEB-ONLY** | `admin_get_message_thread_content`, `admin_message_analytics` |

## The safeguarding boundary, recovered verbatim

`internal.may_direct_message(other)` decides eligibility, and the order is the point:

1. **Both parties must be `is_adult_messaging_user` — first and unconditional.** A linked player who
   is a minor, or a date of birth on the account showing a minor, disqualifies. The function's own
   comment: *"Nothing below can reach past this: not a shared club, not a guardian relationship, not a
   fixture, not an existing thread, not administrator status."* **Club Admin and Site Admin are not
   exceptions.**
2. A personal block, in **either** direction, is absolute.
3. Site and club policy (`direct_messaging_allowed_for_pair`).
4. Only then, discovery: an existing thread · the same club by any of three routes · the same team's
   staff, even across clubs · opposite sides of a fixture within 60 days.

`my_direct_message_candidates()` applies **the same predicate** to its own output, so the picker and
the send path cannot disagree — and the list never says *why* somebody is absent, because a block and
a minor must not be distinguishable.

**Unknown age is currently permitted.** `is_adult_messaging_user` disqualifies only where a date of
birth exists *and* resolves to a minor; a null DOB passes. The player model has an
`unknown_youth_protected` state that this predicate does not consult. That is the platform's posture
today, it is applied unchanged, and it is raised as an owner decision rather than altered in a UI
sprint.

## What M4 adds

New Message with an authority-aware recipient picker · inbox and conversation pagination · realtime
reuse · drafts · robust send states · virtualised lists · a header affordance for Messages.
