-- =====================================================================
-- A NOTIFICATION THAT GOES NOWHERE
--
-- WHAT THE AUDIT FOUND
--
-- Ovalball emits 62 distinct notification types. The registry
-- (public.notification_types) knew about 37 of them. Twenty-five were
-- emitted by real, shipping code and registered nowhere -- including
-- `fixture_cancelled`, which is one of the most consequential things the
-- product can tell a parent, and `gocardless_membership_cancelled`, which is
-- emitted from TypeScript and so was invisible to every SQL-side check.
--
-- An unregistered type is not a cosmetic gap. The registry is what maps a
-- type to a TOPIC, and the topic is what a person's notification preferences
-- actually switch. A type with no registry row belongs to no topic, so it can
-- never be governed by a preference, can never be reasoned about by the email
-- policy, and will never appear in any future Push eligibility decision. It
-- is a notification outside the system that is supposed to manage
-- notifications.
--
-- THE FLAG THAT LIED
--
-- notification_topics.email_ready is rendered to people, verbatim, as
-- "Email available" or "Email coming soon" on the account page. It is a
-- hand-maintained boolean, and it had already drifted: `fixture_updates`
-- carried an ACTIVE email event while its flag said false, so Ovalball was
-- telling somebody email was "coming soon" for a topic it was already
-- mailing them about.
--
-- A stored flag that duplicates a fact the database already holds will always
-- drift eventually. So it stops being stored. Channel readiness is now
-- DERIVED from whether the topic actually has an active email event, which is
-- the same thing Site Admin's Email Configuration switches, and push
-- readiness is derived from the honest answer that no push infrastructure
-- exists yet.
--
-- AND THEN IT CANNOT HAPPEN AGAIN
--
-- With every emitted type registered, notifications.type gains a foreign key
-- to the registry. Emitting an unregistered type is no longer a thing that
-- can be shipped and discovered later -- it fails at the insert, in
-- development, in the test suite, in CI.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE ONE GENUINELY MISSING TOPIC
-- ---------------------------------------------------------------------
-- Club membership payments are not "Ovalball billing and trial": one is a
-- club collecting a subscription from a family, the other is Ovalball
-- charging a club. Filing a failed Direct Debit under the wrong one would
-- put it behind a preference about Ovalball's own invoicing.
--
-- Mandatory, because a payment that failed has to reach the person whose
-- payment it was.
insert into public.notification_topics (key, label, description, mandatory, sort_order)
values (
  'membership_payments',
  'Membership payments',
  'Payments for a player''s club membership, including failed collections and cancellations.',
  true,
  8
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. REGISTER EVERY TYPE THE PRODUCT ACTUALLY EMITS
-- ---------------------------------------------------------------------
-- Every row below was found by reading the emitting code, not by guessing
-- what ought to exist. The topic is the one whose preference a person would
-- expect to govern that message.
insert into public.notification_types (type_key, topic_key) values
  -- Fixtures: what happened to a game.
  ('fixture_cancelled',                        'fixture_updates'),
  ('fixture_kickoff_change_declined',          'fixture_updates'),
  ('fixture_attendance_invitation',            'fixture_updates'),
  ('historical_fixtures_linked',               'fixture_updates'),

  -- Fixture requests and call-ups: something needs a decision.
  ('fixture_call_up_requested',                'fixture_requests'),
  ('fixture_call_up_decided',                  'fixture_requests'),
  ('player_eligibility_approval_required',     'fixture_requests'),
  ('team_created_from_tournament_invitation',  'fixture_requests'),

  -- Training and the season calendar.
  ('training_staff_message',                   'calendar_training_updates'),
  ('season_transition_warning',                'calendar_training_updates'),
  ('season_transition_needs_attention',        'calendar_training_updates'),
  ('season_transition_completed',              'calendar_training_updates'),

  -- Getting in, and being told about it.
  ('add_child_approved',                       'access_invitations'),
  ('add_child_declined',                       'access_invitations'),
  ('club_join_approved',                       'access_invitations'),
  ('club_join_request_submitted',              'access_invitations'),
  ('club_claim_rejected',                      'access_invitations'),
  ('safeguarding_officer_invitation_accepted', 'access_invitations'),
  ('player_information_requested',             'access_invitations'),

  -- Support, moderation and safeguarding decisions.
  ('support_ticket_update',                    'support_moderation'),
  ('safeguarding_dispensation_requested',      'support_moderation'),
  ('safeguarding_dispensation_decided',        'support_moderation'),
  ('safeguarding_dispensation_revoked',        'support_moderation'),

  -- A family's own membership money.
  ('gocardless_payment_failed',                'membership_payments'),
  ('gocardless_membership_cancelled',          'membership_payments')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------
-- 3. CHANNEL READINESS IS DERIVED, NOT DECLARED
-- ---------------------------------------------------------------------
create or replace view public.notification_topic_channels
with (security_invoker = true)
as
select
  t.key,
  t.label,
  t.description,
  t.mandatory,
  t.sort_order,
  -- EMAIL IS READY WHEN EMAIL IS ACTUALLY ON. The same email_events.active
  -- row Site Admin toggles, read here rather than mirrored into a second
  -- boolean somebody has to remember to update.
  exists (
    select 1 from public.email_events e
    where e.topic_key = t.key and e.active
  ) as email_ready,
  -- PUSH IS NOT READY FOR ANYBODY. There is no push infrastructure in this
  -- product yet. Deriving it from one honest place means the day push does
  -- exist, this view changes once rather than eight topic rows changing
  -- individually and inconsistently.
  false as push_ready
from public.notification_topics t;

comment on view public.notification_topic_channels is
  'Notification topics with channel readiness DERIVED from real state: email_ready reflects an active email event for the topic, push_ready reflects that no push channel exists. Read this, never notification_topics.email_ready.';

grant select on public.notification_topic_channels to authenticated;

-- The stale booleans go, so nothing can read the misleading answer. Dropping
-- rather than deprecating: a column left behind is a column somebody selects.
alter table public.notification_topics drop column if exists email_ready;
alter table public.notification_topics drop column if exists push_ready;

-- ---------------------------------------------------------------------
-- 4. AN UNREGISTERED TYPE BECOMES IMPOSSIBLE
-- ---------------------------------------------------------------------
-- The strongest available guard, and the cheapest: not a lint rule somebody
-- can switch off, and not a review habit -- the database simply will not
-- store a notification whose type nothing knows about.
do $$
declare v_orphans int;
begin
  select count(*) into v_orphans
  from public.notifications n
  left join public.notification_types t on t.type_key = n.type
  where t.type_key is null;

  if v_orphans > 0 then
    raise exception 'Refusing to add the registry foreign key: % existing notification row(s) carry an unregistered type. Register them first.', v_orphans;
  end if;
end $$;

alter table public.notifications
  add constraint notifications_type_registered
  foreign key (type) references public.notification_types(type_key)
  on update cascade;

comment on constraint notifications_type_registered on public.notifications is
  'Every notification belongs to a registered type, and therefore to a topic a person can actually have a preference about. Emitting an unregistered type fails here rather than shipping and being discovered later.';
