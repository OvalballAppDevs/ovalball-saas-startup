-- =====================================================================
-- SOME THINGS YOU DO NOT GET TO SWITCH OFF
--
-- THE DEFECT
--
-- "Mandatory" was a property of a TOPIC, and topics are broad. So
-- support_moderation held both "your support ticket was updated" and
-- "a safeguarding dispensation was revoked", and because the topic was
-- optional, a user could silence both with one switch. The same shape put
-- "fixture cancelled" inside the optional fixture_updates topic and
-- "training session cancelled" inside optional calendar_training_updates.
--
-- The consequence is not theoretical: a guardian who turns off fixture
-- updates because they do not care about pitch changes stops being told the
-- match is off, and drives to it.
--
-- THE FIX IS THE SMALLEST ONE THAT WORKS
--
-- Making the whole topic mandatory would be worse -- it would force every
-- routine kickoff-time change on everybody and guarantee the setting gets
-- ignored. Instead a TYPE may override its topic:
--
--     effective_mandatory = type.mandatory_override ?? topic.mandatory
--
-- One nullable column and one resolver. No parallel notification policy
-- system, no per-user exception table, and the topic default still governs
-- everything that has no opinion.
--
-- MANDATORY MEANS THE IN-APP NOTIFICATION, NOT EVERY CHANNEL
--
-- A person must be told, in the product, that the match is off. It does not
-- follow that they must also be emailed. Channels are decided separately:
-- in-app by the rule above, email by the email event's own classification,
-- which is where email already records whether something is operational or
-- identity-critical. That reconciles the two classifications the audit found
-- rather than leaving them to contradict each other.
--
-- AND IT FIXES A SECOND BUG WHILE IT IS HERE
--
-- should_deliver_notification returned FALSE for every non-in_app channel
-- unless the event was mandatory. So notification_preferences.email_enabled
-- has never been consulted by anything: the column exists, the UI calls it
-- "coming soon", and the gate would have refused it anyway. The email branch
-- below now reads the preference, so the stored column finally means what it
-- says.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A TYPE MAY OVERRIDE ITS TOPIC
-- ---------------------------------------------------------------------
alter table public.notification_types
  add column if not exists mandatory_override boolean;

comment on column public.notification_types.mandatory_override is
  'Whether this specific event is mandatory, overriding its topic default. NULL means "inherit the topic" and is the normal case -- an override is only for an event inside an optional topic that must still always be delivered, or the reverse.';

-- ---------------------------------------------------------------------
-- 2. THE ONE ANSWER
-- ---------------------------------------------------------------------
create or replace function internal.notification_is_mandatory(p_type text)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select coalesce(
    nt.mandatory_override,
    t.mandatory,
    false
  )
  from public.notification_types nt
  join public.notification_topics t on t.key = nt.topic_key
  where nt.type_key = p_type;
$$;

comment on function internal.notification_is_mandatory(text) is
  'Is this notification type one the recipient may not switch off? The type''s own override where it has one, otherwise its topic default. The single answer -- every channel gate and every settings screen reads it rather than re-deriving it.';

revoke all on function internal.notification_is_mandatory(text) from public, anon;
grant execute on function internal.notification_is_mandatory(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. THE EVENTS THAT MUST ALWAYS ARRIVE
-- ---------------------------------------------------------------------
-- SAFEGUARDING OUTCOMES. A dispensation is a decision about whether a
-- specific child may do something; the people it concerns cannot be allowed
-- to miss that it was requested, granted or withdrawn. Ordinary support
-- traffic in the same topic stays optional.
update public.notification_types set mandatory_override = true
where type_key in (
  'safeguarding_dispensation_requested',
  'safeguarding_dispensation_decided',
  'safeguarding_dispensation_revoked'
);

-- CANCELLATIONS. The distinguishing feature of a cancellation is that acting
-- on stale information means turning up. A changed kickoff time is a
-- correction; a cancellation is the absence of the event, and the cost of
-- missing it falls on a family in a car.
update public.notification_types set mandatory_override = true
where type_key in (
  'fixture_cancelled',
  'fixture_cancelled_team_folded',
  'training_session_cancelled',
  'training_plan_cancelled'
);

-- ---------------------------------------------------------------------
-- 4. THE DELIVERY GATE
-- ---------------------------------------------------------------------
create or replace function internal.should_deliver_notification(
  p_user_id uuid,
  p_type text,
  p_channel text default 'in_app'
)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select case
    -- An unregistered type is delivered rather than dropped: the catalogue
    -- guard exists to stop those being created, and silently swallowing one
    -- would hide the bug instead of surfacing it.
    when not exists (select 1 from public.notification_types where type_key = p_type) then true

    -- IN-APP: mandatory events ignore the preference; everything else obeys
    -- it, defaulting to on.
    when p_channel = 'in_app' then
      internal.notification_is_mandatory(p_type)
      or coalesce(
        (select np.in_app_enabled from public.notification_preferences np
         join public.notification_types nt on nt.topic_key = np.topic_key
         where nt.type_key = p_type and np.user_id = p_user_id),
        true
      )

    -- EMAIL: governed by the EMAIL event's own classification, not by the
    -- in-app rule. MANDATORY_OPERATIONAL and TRANSACTIONAL_IDENTITY always
    -- send -- a password link or a failed payment is not a newsletter --
    -- while OPTIONAL_OPERATIONAL obeys the user. A type with no email event
    -- has no email to send, so the answer is false rather than true.
    when p_channel = 'email' then
      case
        when exists (
          select 1 from public.email_events e
          join public.notification_types nt on nt.topic_key = e.topic_key
          where nt.type_key = p_type and e.active
            and e.classification in ('MANDATORY_OPERATIONAL', 'TRANSACTIONAL_IDENTITY')
        ) then true
        when exists (
          select 1 from public.email_events e
          join public.notification_types nt on nt.topic_key = e.topic_key
          where nt.type_key = p_type and e.active
            and e.classification = 'OPTIONAL_OPERATIONAL'
        ) then coalesce(
          (select np.email_enabled from public.notification_preferences np
           join public.notification_types nt on nt.topic_key = np.topic_key
           where nt.type_key = p_type and np.user_id = p_user_id),
          true
        )
        else false
      end

    -- PUSH does not exist. Answering false is the honest result: there is no
    -- transport, and pretending otherwise would let a caller believe it had
    -- notified somebody.
    else false
  end;
$$;

comment on function internal.should_deliver_notification(uuid, text, text) is
  'Should this notification reach this person on this channel? In-app follows the mandatory rule then the user''s preference; email follows the email event''s own classification then the user''s email preference; push always returns false because no push transport exists.';

-- ---------------------------------------------------------------------
-- 5. WHAT A SETTINGS SCREEN NEEDS TO SAY
-- ---------------------------------------------------------------------
-- A topic is no longer simply "mandatory" or not: it can be optional overall
-- while still containing events that always arrive. A screen that said
-- "Fixtures & events: off" without qualification would be lying to somebody
-- who will still be told their match is cancelled. This gives the UI the
-- truth in one read.
create or replace view public.notification_topic_settings as
  select
    t.key,
    t.label,
    t.description,
    t.mandatory,
    t.sort_order,
    -- Does switching this topic off still leave some events arriving?
    exists (
      select 1 from public.notification_types nt
      where nt.topic_key = t.key and nt.mandatory_override is true
    ) as has_mandatory_events,
    exists (
      select 1 from public.email_events e
      where e.topic_key = t.key and e.active
    ) as email_ready,
    -- Only where an OPTIONAL email event exists is an email switch meaningful.
    exists (
      select 1 from public.email_events e
      where e.topic_key = t.key and e.active
        and e.classification = 'OPTIONAL_OPERATIONAL'
    ) as email_controllable,
    false as push_ready
  from public.notification_topics t;

comment on view public.notification_topic_settings is
  'What a notification settings screen needs: the topic, whether it is wholly mandatory, whether it still contains always-delivered events when switched off, and whether an email switch would actually control anything. push_ready is constant false because no push transport exists.';

grant select on public.notification_topic_settings to authenticated;
