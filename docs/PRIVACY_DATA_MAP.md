# Ovalball Privacy Data Map (internal)

Evidence-based map of what the application actually holds, built from the live schema and
source. Internal document — not published. Keep in step with `/legal/privacy`.

Legend: **Child?** = may relate to a person under 18. "Club-scoped" access means visibility
is determined by club/team membership, role and verified relationships, enforced in the
database rather than only in the interface.

| Data category | Actual fields / examples | Data subject | Source | Purpose | Storage | Who can access | Third parties | Child? | Candidate lawful basis | Retention behaviour | Deletion behaviour | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Account | email, first name, surname, account_status | Account holder | User | Identify and secure the account | `profiles`, `auth.users` | The user; Site Admin | Supabase | Sometimes (player logins) | Contract | While account exists | Removable on closure | — |
| Authentication | session cookie, provider identifier | Account holder | Auth provider | Sign-in | Supabase Auth | System | Supabase; later Google/Meta/Apple | Sometimes | Contract | Session lifetime | Ends on sign-out | — |
| Club | name, code, crest, contacts, venues, pitches | Club | Club Admin | Club administration | `clubs`, `venues`, `club_pitches` | Club users; Site Admin | Supabase | No | Legitimate interests | While club active | Club lifecycle | — |
| Club directory | club name, town, county, nation | Club (org) | Public sources | Identify opposition | `club_directory` | All authenticated | Supabase | No | Legitimate interests | Durable reference | Not user-deletable | — |
| Team | name, age group, gender, squad, active | Team | Club Admin | Team structure | `teams` | Club users | Supabase | No | Legitimate interests | Folded, not erased | Soft lifecycle | — |
| Player | first name, surname, DOB, age grade | Player (often child) | Club / guardian | Place in correct age grade | `players` | Club-scoped; linked guardians | Supabase | **Yes** | Legitimate interests + child protection | While club record needed | Request-based; history may persist | **Yes** |
| Player-team membership | team, status (pending/active/ended), ended_at | Player | Club / guardian | Squad composition | `player_team_memberships` | Club-scoped; guardians | Supabase | **Yes** | Legitimate interests | End-dated, not deleted | End-dating preferred | **Yes** |
| Guardian relationship | guardian↔player link, status | Guardian + player | Guardian / club | Establish responsible adult | `guardians`, guardian links | The pair; club staff | Supabase | **Yes** | Legitimate interests + child protection | While relationship active | Ended, retained as record | **Yes** |
| Guardian permissions | per-permission grants for a player account | Player (child) | Guardian | Control what a child's login can do | `guardian_player_permissions` | Guardian; club staff | Supabase | **Yes** | Legitimate interests + child protection | While account exists | Revocable | **Yes** |
| Player account invitation | token, invited email, status | Player/guardian | Club | Invite to create login | `player_account_invitations` | Issuing club | Supabase | **Yes** | Legitimate interests | Until accepted/expired | Expires | — |
| Duplicate review | candidate matches, decision | Player | System + staff | Prevent duplicate player records | `player_duplicate_reviews` | Club staff | Supabase | **Yes** | Legitimate interests | Until resolved | Resolved, retained | — |
| Roles | club/team role, active, authority_suspended | Staff member | Club Admin | Authorisation | `club_memberships`, `team_permissions` | Club Admin; Site Admin | Supabase | Rarely | Contract + legitimate interests | While role held | Removable | — |
| Fixture | teams, date, kickoff, home/away, venue, pitch, status, result | Teams/clubs | Club | Arrange and record rugby | `fixtures` | Both clubs; club-scoped | Supabase | No | Legitimate interests | **Durable club history** | Not routinely deleted | — |
| Attendance | player response to a fixture | Player (often child) | Player/guardian | Know availability | `player_fixture_attendance` | Team staff; guardians | Supabase | **Yes** | Legitimate interests | With fixture history | Follows fixture | **Yes** |
| Training | team, date, times, note | Team | Club | Schedule training | `training_sessions` | Team staff; team members | Supabase | **Yes** | Legitimate interests | While relevant | Deletable by club | — |
| Pitch allocation | fixture↔pitch, warm-up/pack-up | Team | Club | Avoid clashes | allocation tables | Club users | Supabase | No | Legitimate interests | With fixture | Follows fixture | — |
| Mini-Rugby Group | grouped teams, season binding | Teams | Club Admin | Combined scheduling | `scheduling_groups`, members | Club users | Supabase | No | Legitimate interests | Frozen once played | Composition frozen | — |
| Player request | player, source/target team, eligibility rule, decision | Player (often child) | Team staff | Traceable eligibility decision | `fixture_player_call_up` | Both teams; club | Supabase | **Yes** | Legitimate interests | **Durable evidence** | Retained | **Yes** |
| Dispensation | player, rule, governing-body ref, status | Player (often child) | Club / governing body | Approve out-of-grade play | `player_team_dispensation` | Club; approvers | Supabase | **Yes** | Legitimate interests + legal/GB obligation | **Durable evidence** | Retained | **Yes** |
| Graduation queue | player, source team, status | Player | System | Season progression | `player_graduation_queue` | Club staff | Supabase | **Yes** | Legitimate interests | Until placed | Resolved | — |
| Messages | body, sender, timestamp, scope | Participants | Users | Organise rugby | `fixture_messages` etc. | Conversation participants | Supabase | **Yes** | Legitimate interests | Retained; soft-delete supported | Soft delete/tombstone | **Yes** |
| Message reports | report, reason, outcome | Reporter + subject | Users | Moderation and safeguarding | moderation fields | Club staff; Site Admin | Supabase | **Yes** | Legitimate interests + child protection | Durable | Retained | **Yes** |
| Invitations | token, invited email, role, status | Invitee | Club Admin | Onboard staff/guardians | `invitations` and variants | Issuing club | Supabase | Sometimes | Legitimate interests | Until accepted/expired | Expires | — |
| Subscription programme | amount, collection day, first-payment policy, sibling rules | Club | Club Admin | Membership pricing | `club_subscription_*` | Club finance users | Supabase | No | Contract | While programme exists | Club-controlled | — |
| Payer/membership | payer, player, agreed amount, status | Payer + player | Parent/club | Collect membership | `player_subscription_payers`, `membership_obligations` | Club finance; the payer | Supabase; GoCardless | **Yes** (player) | Contract | Financial retention applies | Retained per law | **Yes** |
| Payment references | customer/mandate/payment/subscription IDs + status | Payer | GoCardless | Reconcile payments | `gocardless_*` | Club finance | GoCardless | No | Contract + legal obligation | Statutory financial period | Retained | **Yes** |
| Audit log | actor, action, target, timestamp | Acting user | System | Accountability | `audit_log` | Site Admin | Supabase | Sometimes | Legitimate interests + legal | **Durable** | Not deleted on request | **Yes** |
| Technical/security | request and error logs | Visitor | System | Serve and secure the site | Vercel / Supabase | Operator | Vercel, Supabase | Possibly | Legitimate interests | Provider retention | Provider-controlled | — |
| Browser storage | `sb-*`, `ovalball_ctx`, `ovalball-remember`, `ovalball-iris-seen` | Visitor | System | Session, context, UI state | Browser | The visitor | — | Sometimes | Strictly necessary / functional | Session or short-lived | Clearable in browser | — |

## Notes

- **No special-category data.** No health, medical, injury, ethnicity or religion fields
  exist today. Adding any makes this Article 9 data and requires review first.
- **No analytics or advertising.** Verified against source; nothing to map.
- **Durable by design.** Fixtures, results, audit entries, player requests and
  dispensations are retained so a club's record of what happened stays accurate. This is
  why `/legal/data-rights` says closing an account does not erase everything.
- **13 categories touch children's data.** That is the norm here, not the exception — the
  product exists to run youth rugby.
