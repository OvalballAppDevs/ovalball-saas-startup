-- NATIVE PUSH, PHASE 2-4: device registration, and the push channel the preference schema was
-- already carrying (`notification_preferences.push_enabled` and `notification_topic_settings.
-- push_ready` have existed since the schema was drawn up; `push_ready` has simply always returned
-- false because nothing delivered push yet).
--
-- A DEVICE TOKEN IS NEVER AUTHORIZATION. It says where a push CAN be delivered; whether somebody is
-- entitled to receive a given notification is decided the same way it always was, by who the
-- `notifications` row belongs to and by `notification_preferences.push_enabled` for that topic. This
-- table exists only to answer "which live tokens does this user currently hold".

create table public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  -- WHICH BUILD, not which backend. The dev/staging/production apps are three bundle identifiers
  -- (CLAUDE.md, mobile chrome section is the closest precedent for "one identity per environment");
  -- a token registered by the dev client must never be sent a production payload shape it cannot
  -- parse, or vice versa.
  app_variant text not null check (app_variant in ('development', 'staging', 'production')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- ONE ROW PER TOKEN. Expo can reissue the same token to the same install; re-registering updates
  -- `last_seen_at` in place rather than accumulating duplicates that would each receive a push.
  unique (token)
);

create index push_device_tokens_user_id_idx on public.push_device_tokens (user_id);

alter table public.push_device_tokens enable row level security;

create policy push_device_tokens_select_self on public.push_device_tokens
  for select using (user_id = auth.uid());

-- INSERT/UPDATE/DELETE all go through the RPCs below, which is what lets logout, reinstall and a
-- different person signing in on the same device all do the right, different thing to this table
-- rather than three screens each writing to it directly.
create policy push_device_tokens_session_ok on public.push_device_tokens
  as restrictive
  for all
  using (internal.session_ok())
  with check (internal.session_ok());

-- SELECT ONLY. Every write goes through the RPCs below, which is what lets logout, reinstall and a
-- different person signing in on the same device each do the right, different thing to this table
-- rather than three screens each writing to it directly -- so there is deliberately no INSERT, UPDATE
-- or DELETE grant here for `authenticated` to fall back on.
grant select on public.push_device_tokens to authenticated;

-- REGISTER OR REFRESH. The one entry point for "this device can now receive push for this person" --
-- first registration and token refresh are the same call, because Expo does not distinguish them
-- either: a token can change at any time and the client's job is just to keep this table current.
--
-- IF ANOTHER USER PREVIOUSLY HELD THIS EXACT TOKEN (a shared or reinstalled device, signed in as
-- somebody else before), that row is replaced rather than left to double-deliver -- a token belongs
-- to whoever most recently proved they are signed in on that device, never to two people at once.
create or replace function public.register_push_device_token(p_token text, p_platform text, p_app_variant text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to register a device.' using errcode = '42501';
  end if;
  if coalesce(trim(p_token), '') = '' then
    raise exception 'A device token is required.' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Unrecognised platform.' using errcode = '22023';
  end if;
  if p_app_variant not in ('development', 'staging', 'production') then
    raise exception 'Unrecognised app variant.' using errcode = '22023';
  end if;

  insert into public.push_device_tokens (user_id, token, platform, app_variant, last_seen_at)
  values (auth.uid(), p_token, p_platform, p_app_variant, now())
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_variant = excluded.app_variant,
    last_seen_at = now();
end;
$function$;

revoke all on function public.register_push_device_token(text, text, text) from public;
grant execute on function public.register_push_device_token(text, text, text) to authenticated;

-- SIGNING OUT removes THIS DEVICE'S token for the person signing out, never every token the device
-- has ever held -- if somebody else signs in next on the same phone they register their own, and nothing
-- here needs to know that happened.
create or replace function public.unregister_push_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  delete from public.push_device_tokens where token = p_token and user_id = auth.uid();
end;
$function$;

revoke all on function public.unregister_push_device_token(text) from public;
grant execute on function public.unregister_push_device_token(text) to authenticated;

-- THE PUSH CHANNEL ITSELF. `p_in_app_enabled`/`p_email_enabled` are untouched; this adds the third
-- channel the table has been carrying all along, with the same "only the channel actually named
-- changes" rule the other two already have.
create or replace function public.set_notification_preference(
  p_topic_key text,
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
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();

  if not exists (select 1 from public.notification_topics where key = p_topic_key) then
    raise exception 'Unknown notification category.';
  end if;

  if p_in_app_enabled is false
     and (select mandatory from public.notification_topics where key = p_topic_key) then
    raise exception 'This notification topic is mandatory and cannot be turned off.' using errcode = '23514';
  end if;

  insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled, push_enabled)
  values (
    auth.uid(),
    p_topic_key,
    coalesce(p_in_app_enabled, true),
    coalesce(p_email_enabled, true),
    coalesce(p_push_enabled, true)
  )
  on conflict (user_id, topic_key) do update set
    in_app_enabled = coalesce(p_in_app_enabled, public.notification_preferences.in_app_enabled),
    email_enabled  = coalesce(p_email_enabled,  public.notification_preferences.email_enabled),
    push_enabled   = coalesce(p_push_enabled,   public.notification_preferences.push_enabled),
    updated_at = now();
end;
$function$;

-- PUSH IS NOW REAL for every topic that already reaches a person in-app -- the delivery mechanism
-- below sends the same `notifications` row a push rather than a second kind of event, so there is no
-- per-topic push build-out left to gate on.
create or replace view public.notification_topic_settings as
select
  t.key,
  t.label,
  t.description,
  t.mandatory,
  t.sort_order,
  exists (select 1 from public.notification_types nt where nt.topic_key = t.key and nt.mandatory_override is true) as has_mandatory_events,
  exists (select 1 from public.email_events e where e.topic_key = t.key and e.active) as email_ready,
  exists (select 1 from public.email_events e where e.topic_key = t.key and e.active and e.classification = 'OPTIONAL_OPERATIONAL') as email_controllable,
  true as push_ready
from public.notification_topics t;
