-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE C: tournaments stop hiding under fixture_requests and
-- fixture_updates and get their own canonical preference topic.
--
-- The 10 tournament notification types were split across two broader topics purely because
-- "Tournaments" did not exist as a topic when they were added one at a time -- never a deliberate
-- product decision that a tournament invitation IS a fixture request. The owner's approved mock-up
-- shows Tournaments as its own category; this migration is the classification change that makes
-- that honest, over the existing canonical notification system (no parallel tournament notification
-- infrastructure is created).
--
-- EXISTING USERS' EFFECTIVE PREFERENCES ARE PRESERVED EXACTLY, not approximated. See Phase D below:
-- a type's old effective behaviour (inherited from fixture_requests or fixture_updates, whichever it
-- used to belong to) is captured as an explicit EVENT-level preference row before the type moves, so
-- moving a tournament_result_contested notification from fixture_updates to tournaments cannot
-- silently re-enable a channel a user had turned off for fixture_updates.
--
-- email_ready/email_controllable will read false for the new topic (no email_events row exists for
-- it): tournament notifications were never deliberately wired for email -- the one existing
-- email_events row near them, 'match_cancelled' on fixture_updates, is about an ordinary fixture
-- cancellation and only coexisted on the same topic by coincidence of fixture_updates being a wide
-- bucket. This migration closes that coincidental, never-decided email eligibility rather than
-- carrying it forward onto a topic nobody asked to email about.

-- NOT email_ready/push_ready: those columns were retired from this table once
-- notification_topic_settings started deriving both (20270224000000 / 20270706000000); the live
-- table carries only key/label/description/mandatory/sort_order now.
insert into public.notification_topics (key, label, description, mandatory, sort_order)
values ('tournaments', 'Tournaments', 'Applications, draws, schedules and results for tournaments you are entered in or running.', false, 4);

-- Renumber to make room: Tournaments sits right after Fixtures, matching the owner's approved
-- category order (Messages, Fixtures, Tournaments, Availability, Team updates, Club updates, ...).
update public.notification_topics set sort_order = sort_order + 1
where key in ('calendar_training_updates', 'access_invitations', 'support_moderation', 'account_security', 'membership_payments');

update public.notification_types
set topic_key = 'tournaments'
where type_key in (
  'tournament_invitation_received',
  'tournament_invitation_responded',
  'tournament_host_proposed',
  'tournament_host_claimed',
  'team_created_from_tournament_invitation',
  'tournament_venue_changed',
  'tournament_result_awaiting_confirmation',
  'tournament_result_confirmed',
  'tournament_result_contested',
  'tournament_result_resolved'
);

-- ===================================================================================================
-- PHASE D: event-level preferences -- the granularity inside a topic the mock-up's "Notify me about"
-- list needs. A USER-FACING preference key, distinct from and coarser than notification_types'
-- type_key: several type_keys legitimately roll up into one switch (a side's own result being
-- contested and an organiser resolving someone else's dispute are both "result_disputes" to the
-- person deciding whether to hear about either). The internal type vocabulary and this UI vocabulary
-- are deliberately not required to be the same list.
--
-- EVALUATION ORDER, exactly as specified: mandatory policy -> event preference -> topic/channel
-- preference -> delivery. internal.should_deliver_notification below encodes that as a three-tier
-- coalesce per channel: the event-level row wins if one exists for this user and this type has an
-- event_key; otherwise the topic-level row; otherwise the same "true" default every topic has always
-- had.
-- ===================================================================================================

create table public.notification_events (
  key text primary key,
  topic_key text not null references public.notification_topics(key),
  label text not null,
  description text not null,
  sort_order integer not null,
  -- Lets notification_types.event_key carry a composite FK back to (key, topic_key), so a type can
  -- never be event-tagged with an event that belongs to a DIFFERENT topic than the type's own.
  unique (key, topic_key)
);

alter table public.notification_events enable row level security;
create policy notification_events_select_all on public.notification_events for select using (true);
create policy session_ok_required on public.notification_events as restrictive
  to authenticated using (internal.session_ok()) with check (internal.session_ok());
grant select on public.notification_events to authenticated, anon;

insert into public.notification_events (key, topic_key, label, description, sort_order) values
  ('applications', 'tournaments', 'Invitations & applications', 'An invitation to enter, or news that someone has asked to join a tournament you run.', 1),
  ('application_decisions', 'tournaments', 'Application decisions', 'Your own application to a tournament was accepted or declined.', 2),
  ('schedule_published', 'tournaments', 'Schedule published', 'A tournament''s playing schedule has been published.', 3),
  ('schedule_changes', 'tournaments', 'Schedule changes', 'A venue, pitch, date or kick-off time changed after publication.', 4),
  ('draw_updates', 'tournaments', 'Draw updates', 'A knockout draw was published or materially changed.', 5),
  ('result_submissions', 'tournaments', 'Result submissions', 'A result was submitted and is waiting on your side.', 6),
  ('result_confirmations', 'tournaments', 'Result confirmations', 'A result you were waiting on has been confirmed.', 7),
  ('result_disputes', 'tournaments', 'Result disputes', 'A result was contested, or an organiser resolved one.', 8),
  ('knockout_progression', 'tournaments', 'Knockout progression', 'Your side advanced, or your next opponent became known.', 9),
  ('attendance', 'tournaments', 'Attendance', 'Tournament-wide availability and attendance requests.', 10),
  ('announcements', 'tournaments', 'Announcements', 'News posted by the tournament''s organiser.', 11);

alter table public.notification_types add column event_key text;
alter table public.notification_types
  add constraint notification_types_event_topic_fk
  foreign key (event_key, topic_key) references public.notification_events (key, topic_key);

update public.notification_types set event_key = 'applications'
  where type_key in ('tournament_invitation_received', 'tournament_host_proposed', 'tournament_host_claimed', 'team_created_from_tournament_invitation');
update public.notification_types set event_key = 'application_decisions' where type_key = 'tournament_invitation_responded';
update public.notification_types set event_key = 'schedule_changes' where type_key = 'tournament_venue_changed';
update public.notification_types set event_key = 'result_submissions' where type_key = 'tournament_result_awaiting_confirmation';
update public.notification_types set event_key = 'result_confirmations' where type_key = 'tournament_result_confirmed';
update public.notification_types set event_key = 'result_disputes' where type_key in ('tournament_result_contested', 'tournament_result_resolved');

create table public.notification_event_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null references public.notification_events(key),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.notification_event_preferences enable row level security;
create policy notification_event_preferences_select_self on public.notification_event_preferences for select using (user_id = auth.uid());
create policy notification_event_preferences_upsert_self on public.notification_event_preferences for insert with check (user_id = auth.uid());
create policy notification_event_preferences_update_self on public.notification_event_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_event_preferences_delete_self on public.notification_event_preferences for delete using (user_id = auth.uid());
create policy session_ok_required on public.notification_event_preferences as restrictive
  to authenticated using (internal.session_ok()) with check (internal.session_ok());
grant select, insert, update, delete on public.notification_event_preferences to authenticated;

-- THE PRESERVATION BACKFILL. For every user who ever set an explicit topic-level preference on
-- fixture_requests or fixture_updates, materialise that SAME value as an explicit event-level row
-- for the tournament event_keys that used to inherit it -- so delivery for those events is identical
-- the instant this migration completes, not merely "defaults to true and happens to match for most
-- people". A user who never touched their preferences needs no row: both the old topic-level default
-- and the new event-level default are "true", so absence already means the same thing before and
-- after.
with event_origin (event_key, old_topic_key) as (
  values
    ('applications', 'fixture_requests'),
    ('application_decisions', 'fixture_requests'),
    ('schedule_changes', 'fixture_updates'),
    ('result_submissions', 'fixture_updates'),
    ('result_confirmations', 'fixture_updates'),
    ('result_disputes', 'fixture_updates')
)
insert into public.notification_event_preferences (user_id, event_key, in_app_enabled, email_enabled, push_enabled)
select np.user_id, eo.event_key, np.in_app_enabled, np.email_enabled, np.push_enabled
from public.notification_preferences np
join event_origin eo on eo.old_topic_key = np.topic_key
on conflict (user_id, event_key) do nothing;

-- THE DELIVERY GATE, extended to the three-tier order. Mandatory still bypasses everything, exactly
-- as before; what changes is what a non-mandatory type falls back through before reaching the
-- unconditional "true" default: the event-level preference (new) ahead of the topic-level one
-- (unchanged), rather than straight to the topic.
create or replace function internal.should_deliver_notification(p_user_id uuid, p_type text, p_channel text default 'in_app')
returns boolean
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select case
    when not exists (select 1 from public.notification_types where type_key = p_type) then true

    when p_channel = 'in_app' then
      internal.notification_is_mandatory(p_type)
      or coalesce(
        (select ep.in_app_enabled from public.notification_event_preferences ep
         join public.notification_types nt on nt.event_key = ep.event_key
         where nt.type_key = p_type and ep.user_id = p_user_id),
        (select np.in_app_enabled from public.notification_preferences np
         join public.notification_types nt on nt.topic_key = np.topic_key
         where nt.type_key = p_type and np.user_id = p_user_id),
        true
      )

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
          (select ep.email_enabled from public.notification_event_preferences ep
           join public.notification_types nt on nt.event_key = ep.event_key
           where nt.type_key = p_type and ep.user_id = p_user_id),
          (select np.email_enabled from public.notification_preferences np
           join public.notification_types nt on nt.topic_key = np.topic_key
           where nt.type_key = p_type and np.user_id = p_user_id),
          true
        )
        else false
      end

    when p_channel = 'push' then
      internal.notification_is_mandatory(p_type)
      or coalesce(
        (select ep.push_enabled from public.notification_event_preferences ep
         join public.notification_types nt on nt.event_key = ep.event_key
         where nt.type_key = p_type and ep.user_id = p_user_id),
        (select np.push_enabled from public.notification_preferences np
         join public.notification_types nt on nt.topic_key = np.topic_key
         where nt.type_key = p_type and np.user_id = p_user_id),
        true
      )

    else false
  end;
$function$;

-- THE WRITE PATH for an event-level preference, the same shape as set_notification_preference: only
-- the named channel changes, a mandatory topic's in-app switch cannot be turned off (checked through
-- the event's own topic), and a live session is required.
create or replace function public.set_notification_event_preference(
  p_event_key text,
  p_in_app_enabled boolean default null,
  p_email_enabled boolean default null,
  p_push_enabled boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();

  if not exists (select 1 from public.notification_events where key = p_event_key) then
    raise exception 'Unknown notification event.';
  end if;

  if p_in_app_enabled is false
     and exists (
       select 1 from public.notification_events e
       join public.notification_topics t on t.key = e.topic_key
       where e.key = p_event_key and t.mandatory
     ) then
    raise exception 'This notification topic is mandatory and cannot be turned off.' using errcode = '23514';
  end if;

  insert into public.notification_event_preferences (user_id, event_key, in_app_enabled, email_enabled, push_enabled)
  values (
    auth.uid(),
    p_event_key,
    coalesce(p_in_app_enabled, true),
    coalesce(p_email_enabled, true),
    coalesce(p_push_enabled, true)
  )
  on conflict (user_id, event_key) do update set
    in_app_enabled = coalesce(p_in_app_enabled, public.notification_event_preferences.in_app_enabled),
    email_enabled  = coalesce(p_email_enabled,  public.notification_event_preferences.email_enabled),
    push_enabled   = coalesce(p_push_enabled,   public.notification_event_preferences.push_enabled),
    updated_at = now();
end;
$function$;

revoke all on function public.set_notification_event_preference(text, boolean, boolean, boolean) from public;
grant execute on function public.set_notification_event_preference(text, boolean, boolean, boolean) to authenticated;

-- THE READ SURFACE for a topic's own event catalogue plus whether each has an active type yet --
-- several event_keys (schedule_published, draw_updates, knockout_progression, attendance,
-- announcements) are deliberately seeded with no type_key pointing at them yet; their notification
-- producers are Phase F/G of this programme. has_type lets the UI decide whether to show a row that
-- genuinely controls nothing yet, rather than guessing from the row's mere existence.
create or replace view public.notification_event_settings
with (security_invoker = true)
as
select
  e.key,
  e.topic_key,
  e.label,
  e.description,
  e.sort_order,
  exists (select 1 from public.notification_types nt where nt.event_key = e.key) as has_type
from public.notification_events e;

-- Redundant with the WITH clause above on a first create, but the exact bug 20270710000000 just
-- fixed (CREATE OR REPLACE VIEW silently drops a prior security_invoker setting if the replacement
-- statement omits it) means this line is what actually protects the NEXT edit of this view, not this
-- one.
alter view public.notification_event_settings set (security_invoker = true);

grant select on public.notification_event_settings to authenticated, anon;
