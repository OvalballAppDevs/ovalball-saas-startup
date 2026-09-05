-- Personal Notification Settings -- Overnight Master Pass Phase B. A
-- normalized, event-topic architecture (never one column per feature),
-- belonging to the human/user, never a club/team/player/guardian role
-- identity. Retrofits every one of the 31 real notification `type`
-- values already inserted across this schema's RPCs via ONE central
-- BEFORE INSERT trigger on notifications -- zero per-callsite changes,
-- matching this pass's "canonical architecture, not several edited
-- pages" acceptance test.

-- 1. The topic catalogue -- the six topics Section 41 named, plus one
-- reserved for Phase G's future message-moderation reports, plus one
-- always-mandatory "account_security" topic for notices about the
-- account's OWN administrative authority changing (never suppressible --
-- Section 43).
create table public.notification_topics (
  key text primary key,
  label text not null,
  description text not null,
  mandatory boolean not null default false,
  sort_order integer not null,
  -- Channel readiness -- Section 42: expose only actually-supported
  -- delivery channels today. Only in_app is real; email/push are modeled
  -- now so the schema never needs replacing later, but stay false until
  -- a real dispatcher exists.
  email_ready boolean not null default false,
  push_ready boolean not null default false
);

insert into public.notification_topics (key, label, description, mandatory, sort_order) values
  ('messages', 'Messages', 'New messages in a fixture or club conversation.', false, 1),
  ('fixture_requests', 'Fixture requests', 'New fixture, tournament, and partner requests, and responses to your own.', false, 2),
  ('fixture_updates', 'Fixture updates', 'Kickoff, pitch, or result changes to a fixture you are involved in.', false, 3),
  ('calendar_training_updates', 'Calendar and training updates', 'Calendar sharing and training session changes.', false, 4),
  ('access_invitations', 'Access and invitations', 'Club claims and invitations you sent, received, or that were accepted.', false, 5),
  ('support_moderation', 'Support and moderation', 'Updates on a support request or a report you made.', false, 6),
  ('account_security', 'Account and security', 'Changes to your own account access or administrative authority. Cannot be turned off.', true, 7);

-- 2. Every real notification `type` value in use today, mapped to its
-- topic. `notifications.type` stays free text (unchanged, to avoid a
-- disruptive column-type migration on a live table) -- this is the one
-- place that mapping is declared, not repeated at 31 call sites.
create table public.notification_types (
  type_key text primary key,
  topic_key text not null references public.notification_topics(key)
);

insert into public.notification_types (type_key, topic_key) values
  ('new_fixture_message', 'messages'),
  ('club_message_request_received', 'messages'),
  ('club_message_request_declined', 'messages'),
  ('fixture_request_received', 'fixture_requests'),
  ('fixture_request_accepted', 'fixture_requests'),
  ('fixture_request_declined', 'fixture_requests'),
  ('team_created_from_fixture_request', 'fixture_requests'),
  ('tournament_invitation_received', 'fixture_requests'),
  ('tournament_invitation_responded', 'fixture_requests'),
  ('tournament_host_proposed', 'fixture_requests'),
  ('tournament_host_claimed', 'fixture_requests'),
  ('partner_request_received', 'fixture_requests'),
  ('fixture_kickoff_change_proposed', 'fixture_updates'),
  ('fixture_kickoff_changed', 'fixture_updates'),
  ('fixture_pitch_changed', 'fixture_updates'),
  ('fixture_cancelled_team_folded', 'fixture_updates'),
  ('fixture_result_amendment_proposed', 'fixture_updates'),
  ('fixture_result_awaiting_confirmation', 'fixture_updates'),
  ('fixture_result_disputed', 'fixture_updates'),
  ('fixture_result_final', 'fixture_updates'),
  ('tournament_venue_changed', 'fixture_updates'),
  ('calendar_share_approved', 'calendar_training_updates'),
  ('calendar_share_declined', 'calendar_training_updates'),
  ('club_claim_approved', 'access_invitations'),
  ('club_claim_submitted', 'access_invitations'),
  ('club_invitation_accepted', 'access_invitations'),
  ('site_admin_invitation_accepted', 'access_invitations'),
  ('site_admin_diagnostic_access_changed', 'account_security'),
  ('site_admin_competitions_access_changed', 'account_security'),
  ('site_admin_fixture_support_access_changed', 'account_security'),
  ('site_admin_team_catalogue_access_changed', 'account_security'),
  ('site_admin_seasons_access_changed', 'account_security');

-- 3. Per-user, per-topic preference. Absent row = default true (opt-out
-- model, matching a person's normal expectation that notifications work
-- until they turn them off). email_enabled/push_enabled are modeled now
-- for Section 42's forward-compatibility but have no live effect until a
-- dispatcher exists and the topic's own email_ready/push_ready flips true.
create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_key text not null references public.notification_topics(key),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_key)
);

alter table public.notification_topics enable row level security;
alter table public.notification_types enable row level security;
alter table public.notification_preferences enable row level security;

create policy notification_topics_select_all on public.notification_topics for select using (true);
create policy notification_types_select_all on public.notification_types for select using (true);

create policy notification_preferences_select_self on public.notification_preferences for select
  using (user_id = auth.uid());
create policy notification_preferences_upsert_self on public.notification_preferences for insert
  with check (user_id = auth.uid());
create policy notification_preferences_update_self on public.notification_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy notification_preferences_delete_self on public.notification_preferences for delete
  using (user_id = auth.uid());

-- 4. The one central choke point: a mandatory topic, or an unmapped
-- type (fail open -- an uncatalogued notification type is a bug to fix
-- in this table, never a reason to silently drop a real notification),
-- always delivers. A mapped, non-mandatory topic is suppressed only when
-- the user has an explicit in_app_enabled = false row; no row at all
-- means "on" (Section 44's forward-compatible default).
create or replace function internal.should_deliver_notification(p_user_id uuid, p_type text, p_channel text default 'in_app')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.notification_types where type_key = p_type) then true
    when (select mandatory from public.notification_topics t join public.notification_types nt on nt.topic_key = t.key where nt.type_key = p_type) then true
    when p_channel = 'in_app' then coalesce(
      (select np.in_app_enabled from public.notification_preferences np
       join public.notification_types nt on nt.topic_key = np.topic_key
       where nt.type_key = p_type and np.user_id = p_user_id),
      true
    )
    else false
  end;
$$;

create or replace function internal.notifications_gate_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.should_deliver_notification(new.user_id, new.type, 'in_app') then
    return null; -- suppress the insert entirely; the mandatory/safety path above never reaches here
  end if;
  return new;
end;
$$;

create trigger notifications_gate_delivery_trigger
  before insert on public.notifications
  for each row execute function internal.notifications_gate_delivery();

-- 5. One RPC for the Personal Settings UI to toggle a topic -- upserts
-- rather than requiring the client to know whether a row already exists.
-- Mandatory topics reject a false value outright (Section 43: optional
-- preferences must never suppress mandatory notices) rather than
-- silently ignoring the attempt.
create or replace function public.set_notification_preference(p_topic_key text, p_in_app_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select mandatory from public.notification_topics where key = p_topic_key) then
    if not p_in_app_enabled then
      raise exception 'This notification topic is mandatory and cannot be turned off.' using errcode = '23514';
    end if;
    return;
  end if;
  insert into public.notification_preferences (user_id, topic_key, in_app_enabled)
  values (auth.uid(), p_topic_key, p_in_app_enabled)
  on conflict (user_id, topic_key) do update set in_app_enabled = excluded.in_app_enabled, updated_at = now();
end;
$$;
