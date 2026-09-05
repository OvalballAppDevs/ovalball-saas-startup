-- Presence: never a permanent `online = true` flag (that lies the moment a
-- tab closes without a clean disconnect). Two honest signals instead:
--
--  1. Supabase Realtime Presence on a per-fixture-conversation channel --
--     genuinely ephemeral, server-tracked-in-memory client state, gone the
--     instant a socket disconnects. This is the only thing ever allowed to
--     render the word "Online".
--  2. profiles.last_active_at -- a plain heartbeat timestamp, updated by
--     touch_last_active() while a user has the app open. The graceful
--     fallback when nobody is realtime-connected right now: "Recently
--     active" / "Last active HH:MM" / "Offline", never claiming "Online".
--
-- Realtime Presence itself needs no new table (it lives in the Realtime
-- server's memory, per channel) -- what it DOES need is authorization, or
-- "club-scoped/role-appropriate, never public" is just a claim. Realtime's
-- private-channel model checks RLS on realtime.messages using realtime.
-- topic() before allowing a client to join -- the policies below reuse the
-- exact same internal.can_access_fixture_conversation() boundary as the
-- messages/attachments themselves, keyed off a 'presence:f:<fixture_id>'
-- / 'presence:r:<fixture_request_id>' topic naming convention.

alter table public.profiles add column last_active_at timestamptz;

comment on column public.profiles.last_active_at is
  'Heartbeat timestamp, updated by touch_last_active() while the user has the app open. Never a boolean online flag -- the UI derives Online only from a live Realtime Presence channel; this column is purely the graceful "Recently active" / "Last active HH:MM" fallback when nobody is realtime-connected.';

create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;

comment on function public.touch_last_active() is
  'Self-only heartbeat -- a user may only ever update their own last_active_at, called periodically by the client while the app is open (never a per-request thing, to avoid writing on every navigation).';

revoke execute on function public.touch_last_active() from public;
grant execute on function public.touch_last_active() to authenticated;

-- ============================================================
-- Realtime Presence authorization for private fixture-conversation
-- channels. Topic shape: 'presence:f:<fixture_id>' or
-- 'presence:r:<fixture_request_id>' -- parsed the same way storage
-- attachment paths are, and gated by the identical authorization function.
-- ============================================================

create or replace function internal.can_access_fixture_presence_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
begin
  v_parts := regexp_split_to_array(p_topic, ':');
  if array_length(v_parts, 1) <> 3 or v_parts[1] <> 'presence' then
    return false;
  end if;
  if v_parts[2] = 'f' then
    return internal.can_access_fixture_conversation(v_parts[3]::uuid, null);
  elsif v_parts[2] = 'r' then
    return internal.can_access_fixture_conversation(null, v_parts[3]::uuid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function internal.can_access_fixture_presence_topic(text) to authenticated;

create policy fixture_presence_read on realtime.messages for select to authenticated
using (internal.can_access_fixture_presence_topic(realtime.topic()));

create policy fixture_presence_write on realtime.messages for insert to authenticated
with check (internal.can_access_fixture_presence_topic(realtime.topic()));

comment on policy fixture_presence_read on realtime.messages is
  'Gates joining a private presence:f:<fixture_id>/presence:r:<fixture_request_id> Realtime channel to the same real fixture-conversation participants (Club Admin/Fixtures Admin/relevant Team Admin/Site Admin) as the messages themselves -- never public, never a suspended or unrelated-club user (can_access_fixture_conversation already excludes both via can_manage_team/can_manage_club_fixtures).';
