-- =====================================================================================================
-- AN EVENT HAS A CENTRE (Events brief, 2026-10-03)
--
-- public.club_events (20270211) is already Ovalball's canonical EVENT: its own stable id, a club, an
-- optional set of teams, a canonical venue or an external place, a span of days, a cancellation. The
-- calendar, pitch allocation and team availability all read it. This migration EVOLVES that table into
-- the Event Centre the brief describes; it does not stand up a second event system beside it.
--
-- WHAT IS REUSED, UNCHANGED
--   club_events, club_event_teams, club_event_pitches   the event, its sides and its pitches
--   internal.can_manage_club_event / calendar.event.*    who may run it
--   internal.resolve_attendance_response_source          who may answer for a player
--   internal.player_contact_eligibility                  who hears about a player (guardians for a child)
--   public.notifications + push trigger                  the one notification pipeline
--   public.fixture_communications                        the one log of staff announcements & reminders
--   internal.audit_row_change                            the one audit trail
--
-- WHAT IS ADDED, AND WHY IT IS NOT ALREADY SOMEWHERE
--   * columns on club_events: type, host team, meet time, the lifecycle, who is invited, the RSVP rule,
--     guests, catering, capacity and waiting list, payment, the cover, an online place;
--   * club_event_invitees -- named people (a committee dinner) -- the existing scope is teams only;
--   * club_event_guests -- people without an account, recorded by the organiser;
--   * club_event_responses -- ONE row per answering unit, see section 3 for why the player register is
--     no longer the home of an EVENT answer.
-- =====================================================================================================

-- =====================================================================================================
-- 1. THE EVENT, EVOLVED
-- =====================================================================================================
alter table public.club_events
  add column if not exists event_type text not null default 'SOCIAL',
  add column if not exists host_team_id uuid references public.teams(id) on delete set null,
  add column if not exists meet_time time,
  add column if not exists location_kind text not null default 'VENUE',
  add column if not exists location_detail text,
  add column if not exists online_url text,
  add column if not exists visibility text not null default 'INVITED',
  add column if not exists invite_players boolean not null default true,
  add column if not exists invite_staff boolean not null default true,
  add column if not exists invite_members boolean not null default false,
  add column if not exists rsvp_required boolean not null default true,
  add column if not exists rsvp_deadline timestamptz,
  add column if not exists max_guests smallint not null default 0,
  add column if not exists catering_required boolean not null default false,
  add column if not exists catering_notes text,
  add column if not exists catering_deadline timestamptz,
  add column if not exists capacity integer,
  add column if not exists waiting_list_enabled boolean not null default false,
  add column if not exists payment_mode text not null default 'FREE',
  add column if not exists price_note text,
  add column if not exists cover_image_path text,
  add column if not exists cover_stock_key text,
  add column if not exists invitation_message text,
  add column if not exists invitations_sent_at timestamptz,
  add column if not exists status_note text,
  -- RECURRENCE IS NOT BUILT. A future series names its occurrences here, so a monthly committee meeting
  -- becomes N rows of one series rather than a schema replacement.
  add column if not exists series_id uuid;

comment on column public.club_events.event_type is 'What kind of event: SOCIAL, FUNDRAISING, COMMUNITY, TRAINING, MEETING, AWARDS, TOUR, VOLUNTEER, CLUB_FUNCTION, TEAM_EVENT, FESTIVAL, EDUCATION or OTHER. Drives the default picture and the badge; never authority.';
comment on column public.club_events.host_team_id is 'A team''s own event ("Hosted by Ovalball UAT RUFC · Under 9s"). Null: the club hosts it.';
comment on column public.club_events.visibility is 'INVITED: only the people invited (and organisers) can find it. CLUB: every member of the club can see it on the calendar; only the invited are asked to respond.';
comment on column public.club_events.max_guests is 'How many extra people one answer may bring (0 = the invitee only). Never more than the event allows: catering and capacity are counted from this.';
comment on column public.club_events.online_url is 'The meeting link for an online event. Sent only to the invited and the organisers, never to the calendar of anybody else.';
comment on column public.club_events.payment_mode is 'FREE, or PAID_EXTERNALLY with a price note. Ovalball has no event checkout; a club collects payment its own way.';

alter table public.club_events drop constraint if exists club_events_status_check;
alter table public.club_events add constraint club_events_status_check
  check (status in ('DRAFT', 'SCHEDULED', 'POSTPONED', 'CANCELLED'));

alter table public.club_events drop constraint if exists club_events_event_type_check;
alter table public.club_events add constraint club_events_event_type_check
  check (event_type in ('SOCIAL', 'FUNDRAISING', 'COMMUNITY', 'TRAINING', 'MEETING', 'AWARDS', 'TOUR', 'VOLUNTEER',
                        'CLUB_FUNCTION', 'TEAM_EVENT', 'FESTIVAL', 'EDUCATION', 'OTHER'));

-- A PLACE, ONE OF THREE KINDS. The original rule (venue XOR external) stands for a physical event; an
-- online event has neither and carries its link instead.
alter table public.club_events drop constraint if exists club_events_location_check;
alter table public.club_events add constraint club_events_location_check check (
  (location_kind = 'VENUE' and venue_id is not null and external_location_name is null)
  or (location_kind = 'EXTERNAL' and venue_id is null and external_location_name is not null)
  or (location_kind = 'ONLINE' and venue_id is null and external_location_name is null)
);

alter table public.club_events drop constraint if exists club_events_rules_check;
alter table public.club_events add constraint club_events_rules_check check (
  visibility in ('INVITED', 'CLUB')
  and payment_mode in ('FREE', 'PAID_EXTERNALLY')
  and max_guests between 0 and 20
  and (capacity is null or capacity between 1 and 100000)
  and (not waiting_list_enabled or capacity is not null)
  and (cover_image_path is null or cover_stock_key is null)
  and (online_url is null or online_url ~* '^https://')
  and length(coalesce(description, '')) <= 2000
  and length(coalesce(catering_notes, '')) <= 1000
  and length(coalesce(price_note, '')) <= 200
  and length(coalesce(invitation_message, '')) <= 500
);

create index if not exists club_events_host_team_idx on public.club_events (host_team_id) where host_team_id is not null;

-- =====================================================================================================
-- 2. WHO ELSE IS INVITED
--
-- Teams (club_event_teams) and the whole club (is_club_wide) were already the scope. Two more ways in:
-- a NAMED PERSON with an account, and an EXTERNAL GUEST without one. A person who matches several ways
-- in -- a coach who is also a parent and is also named -- is still one person: see section 4.
-- =====================================================================================================
create table if not exists public.club_event_invitees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists club_event_invitees_user_idx on public.club_event_invitees (user_id);

create table if not exists public.club_event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  -- The guest's own answer, as the organiser recorded it. External guests have no login, so there is
  -- no link for them to follow here; the organiser speaks for them.
  status text check (status is null or status in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE')),
  guest_count smallint not null default 0 check (guest_count between 0 and 20),
  catering_count smallint not null default 0 check (catering_count between 0 and 21),
  dietary jsonb not null default '{}'::jsonb,
  dietary_note text check (dietary_note is null or length(dietary_note) <= 300),
  notes text check (notes is null or length(notes) <= 500),
  waitlisted_at timestamptz,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists club_event_guests_event_idx on public.club_event_guests (event_id);

-- =====================================================================================================
-- 3. ONE ANSWER PER PERSON OR PLAYER
--
-- WHY THE PLAYER REGISTER IS NO LONGER WHERE AN EVENT ANSWER LIVES. 20270211 put event answers in
-- public.player_fixture_attendance so "has this child answered" had one home. An event now needs what a
-- match register never will: an ADULT who is not a player (a coach at CPD, a committee member at a
-- dinner), the people coming WITH them, how many need FOOD, what they cannot EAT, and a place in a
-- WAITING LIST. Splitting that across the register and a second table would give every event answer
-- two homes. So an event answer has exactly one: this table. The status vocabulary and the authority
-- to answer for a child (resolve_attendance_response_source) are the register's, unchanged. No event
-- answer had ever been stored (0 rows), so nothing moves.
--
-- A unit is a PLAYER (answered by the player or their guardian) or a PERSON (answered by themselves).
-- =====================================================================================================
create table if not exists public.club_event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE')),
  guest_count smallint not null default 0 check (guest_count between 0 and 20),
  catering_count smallint not null default 0 check (catering_count between 0 and 21),
  dietary jsonb not null default '{}'::jsonb,
  dietary_note text check (dietary_note is null or length(dietary_note) <= 300),
  -- ON THE WAITING LIST: answered Attending after the event was full. Not confirmed, not counted for
  -- catering, promoted in order of this timestamp.
  waitlisted_at timestamptz,
  responded_by uuid not null references auth.users(id),
  response_source text not null check (response_source in ('guardian', 'player', 'staff', 'self')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_event_responses_unit_check check (num_nonnulls(player_id, user_id) = 1),
  constraint club_event_responses_party_check check (catering_count <= guest_count + 1),
  constraint club_event_responses_waitlist_check check (waitlisted_at is null or status = 'ATTENDING')
);
create unique index if not exists club_event_responses_player_unique on public.club_event_responses (event_id, player_id) where player_id is not null;
create unique index if not exists club_event_responses_user_unique on public.club_event_responses (event_id, user_id) where user_id is not null;
create index if not exists club_event_responses_event_idx on public.club_event_responses (event_id);

-- THE REGISTER RETURNS TO MATCHES, TRAINING AND TOURNAMENTS.
drop policy if exists player_fixture_attendance_select_event_scoped on public.player_fixture_attendance;
alter table public.player_fixture_attendance drop constraint if exists player_fixture_attendance_activity_check;
drop index if exists public.player_fixture_attendance_event_unique;
drop index if exists public.player_fixture_attendance_event_id_idx;
alter table public.player_fixture_attendance drop column if exists event_id;
alter table public.player_fixture_attendance add constraint player_fixture_attendance_activity_check
  check (num_nonnulls(fixture_id, training_session_id, tournament_id) = 1);

-- One idempotency ledger for "this person has been told": invitations and automatic reminders.
create table if not exists public.club_event_deliveries (
  event_id uuid not null references public.club_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('INVITATION', 'RSVP_DEADLINE_REMINDER', 'DAY_BEFORE_REMINDER')),
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id, kind)
);

-- ANNOUNCEMENTS AND REMINDERS: the Match Centre's own log, now about a match OR an event.
alter table public.fixture_communications alter column fixture_id drop not null;
alter table public.fixture_communications add column if not exists event_id uuid references public.club_events(id) on delete cascade;
alter table public.fixture_communications drop constraint if exists fixture_communications_subject_check;
alter table public.fixture_communications add constraint fixture_communications_subject_check
  check (num_nonnulls(fixture_id, event_id) = 1);
alter table public.fixture_communications drop constraint if exists fixture_communications_action_check;
alter table public.fixture_communications add constraint fixture_communications_action_check check (action = any (array[
  'ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE', 'MESSAGE_ATTENDEES', 'MESSAGE_TEAM',
  'MESSAGE_CANNOT_ATTEND', 'MESSAGE_UNSURE', 'MESSAGE_AWAITING',
  -- events
  'MESSAGE_ALL', 'MESSAGE_WAITLIST', 'REMIND_AWAITING']));
create index if not exists fixture_communications_event_idx on public.fixture_communications (event_id) where event_id is not null;

-- RLS: reads go through the RPCs below; nothing here is a browser table.
alter table public.club_event_invitees enable row level security;
alter table public.club_event_guests enable row level security;
alter table public.club_event_responses enable row level security;
alter table public.club_event_deliveries enable row level security;
do $$
declare t text;
begin
  foreach t in array array['club_event_invitees', 'club_event_guests', 'club_event_responses', 'club_event_deliveries'] loop
    execute format('drop policy if exists %I on public.%I', t || '_session_ok', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (internal.session_ok()) with check (internal.session_ok())', t || '_session_ok', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- AUDIT: the one trail, on the records an organiser changes.
drop trigger if exists club_events_audit on public.club_events;
create trigger club_events_audit after insert or update or delete on public.club_events
  for each row execute function internal.audit_row_change();
drop trigger if exists club_event_guests_audit on public.club_event_guests;
create trigger club_event_guests_audit after insert or update or delete on public.club_event_guests
  for each row execute function internal.audit_row_change();
drop trigger if exists club_event_invitees_audit on public.club_event_invitees;
create trigger club_event_invitees_audit after insert or update or delete on public.club_event_invitees
  for each row execute function internal.audit_row_change();

-- An event written by the older web form names a venue or an external place but no location kind;
-- the kind follows what was named, so that writer stays valid without being taught a new field.
create or replace function internal.club_events_location_kind()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Named a venue or an external place: that is the kind. Named neither: the kind stays as written, so
  -- a physical event with no place at all still fails the location check rather than becoming "online".
  if new.venue_id is not null then new.location_kind := 'VENUE';
  elsif new.external_location_name is not null then new.location_kind := 'EXTERNAL';
  end if;
  if new.location_kind <> 'ONLINE' then new.online_url := null; end if;
  return new;
end;
$function$;
revoke all on function internal.club_events_location_kind() from public, anon, authenticated;
drop trigger if exists club_events_location_kind on public.club_events;
create trigger club_events_location_kind before insert or update on public.club_events
  for each row execute function internal.club_events_location_kind();

-- =====================================================================================================
-- 4. WHO AN EVENT IS FOR -- ONE RESOLVER, DEDUPLICATED
--
-- A UNIT is somebody an answer is given for:
--   PLAYER  an active player on a side the event is for, when players are invited. Their guardian
--           answers (or the player, where the consent domain lets them); their family comes WITH them.
--   PERSON  an adult answering for themselves: STAFF on those sides, a named INVITEE, or -- for a
--           whole-club event that invites members -- a club MEMBER.
-- A person who already answers for an invited player (a parent, an adult player) is NOT also a separate
-- PERSON: they come in that player's party, so nobody is counted twice for food or a place. The
-- first matching way in names a person's category: STAFF, then INVITEE, then MEMBER.
-- =====================================================================================================
create or replace function internal.club_event_units(p_event_id uuid)
returns table(unit_kind text, player_id uuid, user_id uuid, category text, team_id uuid)
language sql
stable security definer
set search_path to ''
as $function$
  with e as (
    select * from public.club_events where id = p_event_id
  ), scope_teams as (
    -- A side NAMED on the event is in it as named; "the whole club" means the club's current sides.
    select t.id
      from public.teams t, e
     where t.club_id = e.club_id
       and ((e.is_club_wide and t.active and t.archived_at is null)
            or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = t.id))
  ), player_units as (
    select distinct on (ptm.player_id) ptm.player_id, ptm.team_id
      from public.player_team_memberships ptm
      join scope_teams st on st.id = ptm.team_id
      cross join e
     where e.invite_players and ptm.status = 'active'
     order by ptm.player_id, ptm.team_id
  ), answerers as (
    select g.guardian_user_id as user_id from public.guardians g join player_units pu on pu.player_id = g.player_id where g.status = 'active'
    union
    select p.user_id from public.players p join player_units pu on pu.player_id = p.id where p.user_id is not null
  ), people as (
    -- STAFF: a role on one of the event's sides, or (whole club) any club role but plain membership.
    select ra.user_id, 'STAFF'::text as category, 1 as rank, ra.team_id
      from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id and cm.status = 'active'
      cross join e
     where e.invite_staff and ra.state = 'ACTIVE' and ra.club_id = e.club_id and ra.role_key <> 'MEMBER'
       and (ra.team_id in (select id from scope_teams) or (e.is_club_wide and ra.team_id is null))
    union all
    select i.user_id, 'INVITEE', 2, null::uuid from public.club_event_invitees i where i.event_id = p_event_id
    union all
    select cm.user_id, 'MEMBER', 3, null::uuid
      from public.club_memberships cm cross join e
     where e.is_club_wide and e.invite_members and cm.club_id = e.club_id and cm.status = 'active'
  ), person_units as (
    select distinct on (pp.user_id) pp.user_id, pp.category, pp.team_id
      from people pp
     where pp.user_id is not null and pp.user_id not in (select a.user_id from answerers a where a.user_id is not null)
     order by pp.user_id, pp.rank, pp.team_id
  )
  select 'PLAYER'::text, pu.player_id, null::uuid, 'PLAYER'::text, pu.team_id from player_units pu
  union all
  select 'PERSON', null, pu.user_id, pu.category, pu.team_id from person_units pu;
$function$;
revoke all on function internal.club_event_units(uuid) from public, anon, authenticated;

-- WHO IS TOLD. Units, turned into people through the one contact rule: a child is reached through
-- their guardians, never directly.
create or replace function internal.club_event_unit_recipients(p_event_id uuid, p_player_ids uuid[], p_user_ids uuid[])
returns table(user_id uuid)
language sql
stable security definer
set search_path to ''
as $function$
  select distinct e.user_id from internal.player_contact_eligibility(coalesce(p_player_ids, '{}')) e where e.user_id is not null
  union
  select distinct u from unnest(coalesce(p_user_ids, '{}')) u where u is not null;
$function$;
revoke all on function internal.club_event_unit_recipients(uuid, uuid[], uuid[]) from public, anon, authenticated;

create or replace function internal.club_event_recipients(p_event_id uuid)
returns table(user_id uuid)
language sql
stable security definer
set search_path to ''
as $function$
  select r.user_id from internal.club_event_unit_recipients(
    p_event_id,
    array(select u.player_id from internal.club_event_units(p_event_id) u where u.unit_kind = 'PLAYER'),
    array(select u.user_id from internal.club_event_units(p_event_id) u where u.unit_kind = 'PERSON')) r;
$function$;
revoke all on function internal.club_event_recipients(uuid) from public, anon, authenticated;

-- IS THE CALLER INVITED: a person unit, or the guardian / adult self of a player unit.
create or replace function internal.club_event_caller_invited(p_event_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from internal.club_event_units(p_event_id) u
     where (u.unit_kind = 'PERSON' and u.user_id = auth.uid())
        or (u.unit_kind = 'PLAYER' and internal.can_player_as_family('player.profile.view', u.player_id)));
$function$;
revoke all on function internal.club_event_caller_invited(uuid) from public, anon, authenticated;

-- =====================================================================================================
-- 5. WHO MAY SEE IT -- the one visibility rule, now about invitations
--
-- Before: anybody with calendar.event.view at the club saw every event, so a coaches' dinner sat on
-- every parent's calendar. Now: a DRAFT is its organisers' alone; an INVITE-ONLY event is seen by the
-- people it is for and its organisers; a CLUB event is also seen by the club's members. Same signature,
-- so every policy and RPC that already asks it now asks the new question.
-- =====================================================================================================
create or replace function internal.club_event_visible_row(p_event_id uuid, p_club_id uuid, p_is_club_wide boolean)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    internal.has_site_capability('site.clubs.view')
    or internal.can_manage_club_event(p_event_id)
    or exists (
      select 1 from public.club_events e
       where e.id = p_event_id and e.status <> 'DRAFT'
         and ((e.visibility = 'CLUB' and internal.can('calendar.event.view', 'club', e.club_id, null, null))
              or internal.club_event_caller_invited(e.id))), false);
$function$;

-- The phase a person sees: the stored lifecycle, plus COMPLETED once the last day has passed.
create or replace function internal.club_event_phase(p_status text, p_ends_on date)
returns text
language sql
stable
set search_path to ''
as $function$
  select case when p_status = 'SCHEDULED' and p_ends_on < (now() at time zone 'Europe/London')::date then 'COMPLETED' else p_status end;
$function$;
revoke all on function internal.club_event_phase(text, date) from public, anon;

-- CONFIRMED PLACES: every confirmed answer's party, and every confirmed external guest's.
create or replace function internal.club_event_confirmed_heads(p_event_id uuid, p_except_response uuid default null, p_except_guest uuid default null)
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((select sum(1 + r.guest_count) from public.club_event_responses r
                    where r.event_id = p_event_id and r.status = 'ATTENDING' and r.waitlisted_at is null
                      and r.id is distinct from p_except_response), 0)::int
       + coalesce((select sum(1 + g.guest_count) from public.club_event_guests g
                    where g.event_id = p_event_id and g.status = 'ATTENDING' and g.waitlisted_at is null
                      and g.id is distinct from p_except_guest), 0)::int;
$function$;
revoke all on function internal.club_event_confirmed_heads(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function internal.club_event_date_label(p_event public.club_events)
returns text
language sql
stable
set search_path to ''
as $function$
  select trim(to_char(p_event.starts_on, 'FMDay FMDD FMMonth'))
         || coalesce(' at ' || to_char(p_event.start_time, 'HH24:MI'), '');
$function$;
revoke all on function internal.club_event_date_label(public.club_events) from public, anon;

create or replace function internal.club_event_place_label(p_event public.club_events)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select case p_event.location_kind
           when 'VENUE' then (select v.name from public.venues v where v.id = p_event.venue_id)
           when 'EXTERNAL' then p_event.external_location_name
           else 'Online' end;
$function$;
revoke all on function internal.club_event_place_label(public.club_events) from public, anon, authenticated;

-- ONE NOTIFICATION PER PERSON, for a set of people, about this event. `p_push` false keeps it in the
-- app only (the organiser's choice on an announcement); otherwise each person's own preferences decide.
create or replace function internal.club_event_notify(p_event_id uuid, p_user_ids uuid[], p_type text, p_title text, p_body text,
                                                       p_extra jsonb default '{}'::jsonb, p_push boolean default true)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer;
begin
  insert into public.notifications (user_id, type, title, body, data)
  select distinct u, p_type, p_title, p_body,
         jsonb_build_object('event_id', p_event_id) || coalesce(p_extra, '{}'::jsonb)
           || case when p_push then '{}'::jsonb else jsonb_build_object('push', false) end
    from unnest(coalesce(p_user_ids, '{}')) u
   where u is not null and u is distinct from auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function internal.club_event_notify(uuid, uuid[], text, text, text, jsonb, boolean) from public, anon, authenticated;

-- =====================================================================================================
-- 6. THE WAITING LIST
--
-- STRICT ORDER OF ARRIVAL. When places free up, the earliest waiting party is promoted if it fits; if
-- the party at the head of the queue does not fit, nobody behind it jumps ahead. Deterministic (time,
-- then id), auditable (the response row changes, and each promoted family is told).
-- =====================================================================================================
create or replace function internal.club_event_promote_waiting(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  e public.club_events;
  w record;
  v_free integer;
  v_promoted integer := 0;
  v_users uuid[];
begin
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or e.capacity is null then return 0; end if;
  for w in
    select 'R' as src, r.id, r.player_id, r.user_id, r.guest_count, r.waitlisted_at
      from public.club_event_responses r where r.event_id = p_event_id and r.waitlisted_at is not null
    union all
    select 'G', g.id, null, null, g.guest_count, g.waitlisted_at
      from public.club_event_guests g where g.event_id = p_event_id and g.waitlisted_at is not null
    order by 6, 2
  loop
    v_free := e.capacity - internal.club_event_confirmed_heads(p_event_id);
    exit when 1 + w.guest_count > v_free;
    if w.src = 'R' then
      update public.club_event_responses set waitlisted_at = null, updated_at = now() where id = w.id;
      select array_agg(x.user_id) into v_users
        from internal.club_event_unit_recipients(p_event_id,
               case when w.player_id is not null then array[w.player_id] end,
               case when w.user_id is not null then array[w.user_id] end) x;
      perform internal.club_event_notify(p_event_id, v_users, 'event_waitlist_promoted', e.name,
        'A place has come up at ' || e.name || ' on ' || internal.club_event_date_label(e) || '. You are confirmed.');
    else
      update public.club_event_guests set waitlisted_at = null, updated_at = now() where id = w.id;
    end if;
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end;
$function$;
revoke all on function internal.club_event_promote_waiting(uuid) from public, anon, authenticated;

-- The catering and dietary shape of one answer, checked in one place for families and external guests.
create or replace function internal.club_event_check_party(e public.club_events, p_status text, p_guests integer,
                                                             p_catering integer, p_dietary jsonb)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_guests integer := coalesce(p_guests, 0);
  v_catering integer;
  v_diet jsonb := coalesce(p_dietary, '{}'::jsonb);
  v_key text;
  v_sum integer := 0;
begin
  if p_status <> 'ATTENDING' then
    return jsonb_build_object('guests', 0, 'catering', 0, 'dietary', '{}'::jsonb);
  end if;
  if v_guests < 0 or v_guests > e.max_guests then
    raise exception '%', case when e.max_guests = 0 then 'This event is for invited people only -- guests are not included.'
                              else 'You can bring up to ' || e.max_guests || ' guest' || case when e.max_guests = 1 then '' else 's' end || '.' end
      using errcode = '22023';
  end if;
  if not e.catering_required then
    return jsonb_build_object('guests', v_guests, 'catering', 0, 'dietary', '{}'::jsonb);
  end if;
  v_catering := coalesce(p_catering, v_guests + 1);
  if v_catering < 0 or v_catering > v_guests + 1 then
    raise exception 'Food can be ordered for up to % people in this party.', v_guests + 1 using errcode = '22023';
  end if;
  if jsonb_typeof(v_diet) <> 'object' then
    raise exception 'Dietary requirements are counts.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_diet) loop
    if v_key not in ('vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'nut_allergy', 'other') then
      raise exception 'That is not a dietary requirement Ovalball records.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_diet -> v_key) <> 'number' or (v_diet ->> v_key)::numeric < 0 or (v_diet ->> v_key)::numeric <> floor((v_diet ->> v_key)::numeric) then
      raise exception 'Dietary requirements are whole numbers of people.' using errcode = '22023';
    end if;
    v_sum := v_sum + (v_diet ->> v_key)::int;
  end loop;
  if v_sum > v_catering * 2 then
    -- One person can be both vegetarian and gluten free, so the counts may overlap -- but not without limit.
    raise exception 'More dietary requirements than people eating.' using errcode = '22023';
  end if;
  -- Zeros are not kept: the aggregate is the same, and the stored answer says only what was meant.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_diet from jsonb_each(v_diet) as d(k, v) where (v)::text <> '0';
  return jsonb_build_object('guests', v_guests, 'catering', v_catering, 'dietary', v_diet);
end;
$function$;
revoke all on function internal.club_event_check_party(public.club_events, text, integer, integer, jsonb) from public, anon, authenticated;

-- =====================================================================================================
-- 7. ANSWERING
-- =====================================================================================================
create or replace function public.respond_to_event(
  p_event_id uuid,
  p_player_id uuid,
  p_status text,
  p_guest_count integer default 0,
  p_catering_count integer default null,
  p_dietary jsonb default '{}'::jsonb,
  p_dietary_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  v_source text;
  v_party jsonb;
  v_existing public.club_event_responses;
  v_wait timestamptz;
  v_free integer;
  v_heads integer;
  v_was_confirmed boolean;
  v_promoted integer := 0;
begin
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Attending, Can''t Attend or Unsure.' using errcode = '22023';
  end if;

  -- ONE ANSWER AT A TIME PER EVENT: the event row is the lock, so two last places cannot both be taken.
  select * into e from public.club_events where id = p_event_id for update;
  if e.id is null or e.status = 'DRAFT' or not internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide) then
    raise exception 'This event is not available.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' then raise exception 'This event has been cancelled.' using errcode = '22023'; end if;
  if e.ends_on < (now() at time zone 'Europe/London')::date then raise exception 'This event has finished.' using errcode = '22023'; end if;
  if e.rsvp_deadline is not null and now() > e.rsvp_deadline and not internal.can_manage_club_event(e.id) then
    raise exception 'Responses closed on %.', to_char(e.rsvp_deadline at time zone 'Europe/London', 'FMDay FMDD FMMonth') using errcode = '22023';
  end if;

  if p_player_id is not null then
    if not exists (select 1 from internal.club_event_units(e.id) u where u.unit_kind = 'PLAYER' and u.player_id = p_player_id) then
      raise exception 'That player is not invited to this event.' using errcode = '42501';
    end if;
    v_source := internal.resolve_attendance_response_source(p_player_id);
    if v_source is null then raise exception 'You cannot answer for this player.' using errcode = '42501'; end if;
    select * into v_existing from public.club_event_responses where event_id = e.id and player_id = p_player_id;
  else
    if not exists (select 1 from internal.club_event_units(e.id) u where u.unit_kind = 'PERSON' and u.user_id = auth.uid()) then
      raise exception 'You are not invited to this event.' using errcode = '42501';
    end if;
    v_source := 'self';
    select * into v_existing from public.club_event_responses where event_id = e.id and user_id = auth.uid();
  end if;

  v_party := internal.club_event_check_party(e, p_status, p_guest_count, p_catering_count, p_dietary);
  v_was_confirmed := v_existing.id is not null and v_existing.status = 'ATTENDING' and v_existing.waitlisted_at is null;
  v_wait := null;

  if p_status = 'ATTENDING' and e.capacity is not null then
    v_heads := 1 + (v_party ->> 'guests')::int;
    v_free := e.capacity - internal.club_event_confirmed_heads(e.id, v_existing.id);
    if v_existing.waitlisted_at is not null then
      -- Already queued: keep the place in the queue; promotion decides, in order.
      v_wait := v_existing.waitlisted_at;
    elsif v_heads > v_free or (not v_was_confirmed and exists (
            select 1 from public.club_event_responses r where r.event_id = e.id and r.waitlisted_at is not null
            union all select 1 from public.club_event_guests g where g.event_id = e.id and g.waitlisted_at is not null)) then
      if v_was_confirmed then
        raise exception 'Only % place% left -- your party can be up to % people.', greatest(v_free, 0),
          case when v_free = 1 then ' is' else 's are' end, greatest(v_free, 1) using errcode = '22023';
      elsif e.waiting_list_enabled then
        v_wait := now();
      else
        raise exception 'This event is full.' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_existing.id is null then
    insert into public.club_event_responses (event_id, player_id, user_id, status, guest_count, catering_count, dietary, dietary_note,
                                             waitlisted_at, responded_by, response_source)
    values (e.id, p_player_id, case when p_player_id is null then auth.uid() end, p_status,
            (v_party ->> 'guests')::int, (v_party ->> 'catering')::int, v_party -> 'dietary',
            case when p_status = 'ATTENDING' and e.catering_required then nullif(btrim(coalesce(p_dietary_note, '')), '') end,
            v_wait, auth.uid(), v_source);
  else
    update public.club_event_responses
       set status = p_status, guest_count = (v_party ->> 'guests')::int, catering_count = (v_party ->> 'catering')::int,
           dietary = v_party -> 'dietary',
           dietary_note = case when p_status = 'ATTENDING' and e.catering_required then nullif(btrim(coalesce(p_dietary_note, '')), '') end,
           waitlisted_at = v_wait, responded_by = auth.uid(), response_source = v_source, updated_at = now()
     where id = v_existing.id;
  end if;

  -- A place given back, or a smaller party, may let the queue move.
  if e.capacity is not null and v_was_confirmed and (p_status <> 'ATTENDING' or (v_party ->> 'guests')::int < v_existing.guest_count) then
    v_promoted := internal.club_event_promote_waiting(e.id);
  end if;

  return jsonb_build_object('status', p_status, 'waitlisted', v_wait is not null, 'promoted', v_promoted,
                            'guests', (v_party ->> 'guests')::int, 'catering', (v_party ->> 'catering')::int);
end;
$function$;
revoke all on function public.respond_to_event(uuid, uuid, text, integer, integer, jsonb, text) from public, anon;
grant execute on function public.respond_to_event(uuid, uuid, text, integer, integer, jsonb, text) to authenticated;

-- =====================================================================================================
-- 8. ONE SAVE FOR AN EVENT
--
-- Everything an organiser edits, in one call, so one Save produces at most ONE notification to the
-- people already invited ("Christmas Party updated: now Saturday 19 December at 18:00 at Ovalball
-- Clubhouse."). Keys present change; keys absent keep their value. Authority is the existing
-- event authority: club-scoped calendar.event.manage, or a team scope that covers every side named.
-- =====================================================================================================
create or replace function public.save_event(p_event_id uuid, p_club_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  n public.club_events;
  v_id uuid := p_event_id;
  v_club uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_team_ids uuid[];
  v_user_ids uuid[];
  v_club_level boolean;
  v_bad uuid;
  v_changed text[] := '{}';
  v_notified integer := 0;
  v_ext jsonb;
begin
  perform internal.require_live_session();

  if v_id is not null then
    select * into e from public.club_events where id = v_id for update;
    if e.id is null or not internal.can_manage_club_event(v_id) then
      raise exception 'You do not have permission to manage this event.' using errcode = '42501';
    end if;
    v_club := e.club_id;
  else
    v_club := p_club_id;
  end if;
  if v_club is null or not exists (select 1 from public.clubs c where c.id = v_club) then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  v_club_level := internal.has_site_capability('site.support.act_in_club') or internal.can('calendar.event.manage', 'club', v_club, null, null);

  v_team_ids := case when v_patch ? 'team_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'team_ids') x)
                     else array(select cet.team_id from public.club_event_teams cet where cet.event_id = v_id) end;
  v_user_ids := case when v_patch ? 'individual_user_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'individual_user_ids') x)
                     else array(select i.user_id from public.club_event_invitees i where i.event_id = v_id) end;

  -- The row as it will be: the old row (or defaults) with the patch laid over it.
  if e.id is not null then
    n := e;
  else
    n.club_id := v_club; n.name := ''; n.starts_on := current_date; n.ends_on := current_date; n.is_club_wide := false;
    n.status := 'DRAFT'; n.event_type := 'SOCIAL'; n.location_kind := 'VENUE'; n.visibility := 'INVITED';
    n.invite_players := true; n.invite_staff := true; n.invite_members := false; n.rsvp_required := true; n.max_guests := 0;
    n.catering_required := false; n.waiting_list_enabled := false; n.payment_mode := 'FREE';
  end if;
  n.name := case when v_patch ? 'name' then btrim(coalesce(v_patch ->> 'name', '')) else n.name end;
  n.event_type := coalesce(v_patch ->> 'event_type', n.event_type);
  n.description := case when v_patch ? 'description' then nullif(btrim(coalesce(v_patch ->> 'description', '')), '') else n.description end;
  n.starts_on := coalesce((v_patch ->> 'starts_on')::date, n.starts_on);
  n.ends_on := coalesce((v_patch ->> 'ends_on')::date, case when v_patch ? 'starts_on' and e.id is null then n.starts_on else n.ends_on end);
  if v_patch ? 'starts_on' and not v_patch ? 'ends_on' and n.ends_on < n.starts_on then n.ends_on := n.starts_on; end if;
  n.start_time := case when v_patch ? 'start_time' then nullif(v_patch ->> 'start_time', '')::time else n.start_time end;
  n.end_time := case when v_patch ? 'end_time' then nullif(v_patch ->> 'end_time', '')::time else n.end_time end;
  n.meet_time := case when v_patch ? 'meet_time' then nullif(v_patch ->> 'meet_time', '')::time else n.meet_time end;
  n.host_team_id := case when v_patch ? 'host_team_id' then nullif(v_patch ->> 'host_team_id', '')::uuid else n.host_team_id end;
  n.is_club_wide := coalesce((v_patch ->> 'is_club_wide')::boolean, n.is_club_wide);
  n.invite_players := coalesce((v_patch ->> 'invite_players')::boolean, n.invite_players);
  n.invite_staff := coalesce((v_patch ->> 'invite_staff')::boolean, n.invite_staff);
  n.invite_members := coalesce((v_patch ->> 'invite_members')::boolean, n.invite_members);
  n.visibility := coalesce(v_patch ->> 'visibility', n.visibility);
  n.rsvp_required := coalesce((v_patch ->> 'rsvp_required')::boolean, n.rsvp_required);
  n.rsvp_deadline := case when v_patch ? 'rsvp_deadline' then nullif(v_patch ->> 'rsvp_deadline', '')::timestamptz else n.rsvp_deadline end;
  n.max_guests := coalesce((v_patch ->> 'max_guests')::int, n.max_guests);
  n.catering_required := coalesce((v_patch ->> 'catering_required')::boolean, n.catering_required);
  n.catering_notes := case when v_patch ? 'catering_notes' then nullif(btrim(coalesce(v_patch ->> 'catering_notes', '')), '') else n.catering_notes end;
  n.catering_deadline := case when v_patch ? 'catering_deadline' then nullif(v_patch ->> 'catering_deadline', '')::timestamptz else n.catering_deadline end;
  n.capacity := case when v_patch ? 'capacity' then nullif(v_patch ->> 'capacity', '')::int else n.capacity end;
  n.waiting_list_enabled := coalesce((v_patch ->> 'waiting_list_enabled')::boolean, n.waiting_list_enabled) and n.capacity is not null;
  n.payment_mode := coalesce(v_patch ->> 'payment_mode', n.payment_mode);
  n.price_note := case when v_patch ? 'price_note' then nullif(btrim(coalesce(v_patch ->> 'price_note', '')), '') else n.price_note end;
  n.cover_stock_key := case when v_patch ? 'cover_stock_key' then nullif(v_patch ->> 'cover_stock_key', '') else n.cover_stock_key end;
  n.cover_image_path := case when v_patch ? 'cover_image_path' then nullif(v_patch ->> 'cover_image_path', '') else n.cover_image_path end;
  if v_patch ? 'cover_image_path' and n.cover_image_path is not null then n.cover_stock_key := null; end if;
  if v_patch ? 'cover_stock_key' and n.cover_stock_key is not null then n.cover_image_path := null; end if;
  n.location_detail := case when v_patch ? 'location_detail' then nullif(btrim(coalesce(v_patch ->> 'location_detail', '')), '') else n.location_detail end;
  if v_patch ? 'location_kind' then
    n.location_kind := v_patch ->> 'location_kind';
    n.venue_id := null; n.external_location_name := null; n.online_url := null;
    n.external_address_line_1 := null; n.external_address_line_2 := null; n.external_town := null; n.external_county := null;
    n.external_postcode := null; n.external_country := null; n.external_latitude := null; n.external_longitude := null;
    if n.location_kind = 'VENUE' then n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
    elsif n.location_kind = 'EXTERNAL' then
      v_ext := coalesce(v_patch -> 'external', '{}'::jsonb);
      n.external_location_name := nullif(btrim(coalesce(v_ext ->> 'name', '')), '');
      n.external_address_line_1 := nullif(btrim(coalesce(v_ext ->> 'address_line_1', '')), '');
      n.external_address_line_2 := nullif(btrim(coalesce(v_ext ->> 'address_line_2', '')), '');
      n.external_town := nullif(btrim(coalesce(v_ext ->> 'town', '')), '');
      n.external_county := nullif(btrim(coalesce(v_ext ->> 'county', '')), '');
      n.external_postcode := nullif(upper(btrim(coalesce(v_ext ->> 'postcode', ''))), '');
      n.external_country := nullif(btrim(coalesce(v_ext ->> 'country', '')), '');
      n.external_latitude := nullif(v_ext ->> 'latitude', '')::numeric;
      n.external_longitude := nullif(v_ext ->> 'longitude', '')::numeric;
      n.external_address_provider_ref := nullif(v_ext ->> 'provider_ref', '');
    elsif n.location_kind = 'ONLINE' then n.online_url := nullif(btrim(coalesce(v_patch ->> 'online_url', '')), '');
    else raise exception 'A place is a club venue, an external address or online.' using errcode = '22023';
    end if;
  elsif v_patch ? 'venue_id' and n.location_kind = 'VENUE' then
    n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
  end if;

  -- AUTHORITY OVER THE AUDIENCE. Below club level, only an event confined to sides you manage.
  if not v_club_level then
    if n.is_club_wide then raise exception 'Only club administration can make an event club-wide.' using errcode = '42501'; end if;
    if coalesce(array_length(v_team_ids, 1), 0) = 0 then
      raise exception 'Choose the sides this event is for.' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(v_team_ids) t(id) where not internal.can('calendar.event.manage', 'team', v_club, t.id, null)) then
      raise exception 'You do not have permission to include one of those teams.' using errcode = '42501';
    end if;
    if n.visibility = 'CLUB' then raise exception 'Only club administration can show an event to the whole club.' using errcode = '42501'; end if;
  end if;

  -- SHAPE.
  if length(n.name) = 0 or length(n.name) > 100 then raise exception 'An event needs a name of up to 100 characters.' using errcode = '22023'; end if;
  if n.ends_on < n.starts_on then raise exception 'An event cannot end before it starts.' using errcode = '22023'; end if;
  if n.ends_on = n.starts_on and n.start_time is not null and n.end_time is not null and n.end_time < n.start_time then
    raise exception 'An event cannot finish before it begins.' using errcode = '22023';
  end if;
  if n.meet_time is not null and n.start_time is not null and n.meet_time > n.start_time then
    raise exception 'The arrival time is before the start.' using errcode = '22023';
  end if;
  if n.location_kind = 'VENUE' and (n.venue_id is null or not exists (select 1 from public.venues v where v.id = n.venue_id and v.club_id = v_club and v.active)) then
    raise exception 'Choose one of the club''s own venues.' using errcode = '42501';
  end if;
  if n.location_kind = 'EXTERNAL' and n.external_location_name is null then
    raise exception 'Name the external place.' using errcode = '22023';
  end if;
  if n.location_kind = 'ONLINE' and (n.online_url is null or n.online_url !~* '^https://') then
    raise exception 'An online event needs a meeting link starting https://.' using errcode = '22023';
  end if;
  if n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) > 0 then
    raise exception 'A club-wide event covers every team and does not list them individually.' using errcode = '22023';
  end if;
  if not n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) = 0 and coalesce(array_length(v_user_ids, 1), 0) = 0 and v_patch ? 'team_ids' then
    raise exception 'Invite the whole club, some teams or some people.' using errcode = '22023';
  end if;
  select t.id into v_bad from unnest(v_team_ids) t(id)
   where not exists (select 1 from public.teams tm where tm.id = t.id and tm.club_id = v_club) limit 1;
  if v_bad is not null then raise exception 'One of those teams does not belong to this club.' using errcode = '42501'; end if;
  if n.host_team_id is not null and not exists (select 1 from public.teams tm where tm.id = n.host_team_id and tm.club_id = v_club) then
    raise exception 'The host team must belong to this club.' using errcode = '42501';
  end if;
  if n.host_team_id is not null and not v_club_level and not internal.can('calendar.event.manage', 'team', v_club, n.host_team_id, null) then
    raise exception 'You can only host an event for a team you manage.' using errcode = '42501';
  end if;
  -- A NAMED PERSON must already belong to the club (a member, or the family of one of its players).
  select u.id into v_bad from unnest(v_user_ids) u(id)
   where not exists (select 1 from public.club_memberships cm where cm.user_id = u.id and cm.club_id = v_club and cm.status = 'active')
     and not exists (select 1 from public.guardians g join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
                       join public.teams t on t.id = ptm.team_id where g.guardian_user_id = u.id and g.status = 'active' and t.club_id = v_club)
   limit 1;
  if v_bad is not null then raise exception 'You can invite people from your own club only.' using errcode = '42501'; end if;
  if n.cover_stock_key is not null and n.cover_stock_key !~ '^event-[a-z0-9-]+$' then
    raise exception 'That is not an Ovalball event picture.' using errcode = '22023';
  end if;
  if n.cover_image_path is not null and split_part(n.cover_image_path, '/', 1) <> coalesce(v_id::text, '') then
    raise exception 'Upload the picture to this event first.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.club_events (club_id, name, event_type, description, starts_on, ends_on, start_time, end_time, meet_time,
        host_team_id, is_club_wide, invite_players, invite_staff, invite_members, visibility, rsvp_required, rsvp_deadline,
        max_guests, catering_required, catering_notes, catering_deadline, capacity, waiting_list_enabled, payment_mode, price_note,
        cover_stock_key, location_kind, location_detail, venue_id, external_location_name, external_address_line_1,
        external_address_line_2, external_town, external_county, external_postcode, external_country, external_latitude,
        external_longitude, external_address_provider_ref, online_url, status, created_by, updated_by, season_id)
    values (v_club, n.name, n.event_type, n.description, n.starts_on, n.ends_on, n.start_time, n.end_time, n.meet_time,
        n.host_team_id, n.is_club_wide, n.invite_players, n.invite_staff, n.invite_members, n.visibility, n.rsvp_required, n.rsvp_deadline,
        n.max_guests, n.catering_required, n.catering_notes, n.catering_deadline, n.capacity, n.waiting_list_enabled, n.payment_mode, n.price_note,
        n.cover_stock_key, n.location_kind, n.location_detail, n.venue_id, n.external_location_name, n.external_address_line_1,
        n.external_address_line_2, n.external_town, n.external_county, n.external_postcode, n.external_country, n.external_latitude,
        n.external_longitude, n.external_address_provider_ref, n.online_url, 'DRAFT', auth.uid(), auth.uid(),
        (select s.id from public.seasons s join public.clubs c on c.id = v_club join public.club_directory d on d.id = c.directory_id
          where s.rugby_code = d.rugby_code and n.starts_on between s.starts_on and s.ends_on order by s.starts_on desc limit 1))
    returning id into v_id;
  else
    if e.status = 'CANCELLED' then raise exception 'A cancelled event cannot be changed.' using errcode = '22023'; end if;
    if n.starts_on is distinct from e.starts_on or n.ends_on is distinct from e.ends_on then v_changed := array_append(v_changed, 'date'); end if;
    if n.start_time is distinct from e.start_time or n.end_time is distinct from e.end_time or n.meet_time is distinct from e.meet_time then v_changed := array_append(v_changed, 'time'); end if;
    if n.location_kind is distinct from e.location_kind or n.venue_id is distinct from e.venue_id
       or n.external_location_name is distinct from e.external_location_name or n.external_postcode is distinct from e.external_postcode
       or n.online_url is distinct from e.online_url then v_changed := array_append(v_changed, 'place'); end if;
    update public.club_events set
      name = n.name, event_type = n.event_type, description = n.description, starts_on = n.starts_on, ends_on = n.ends_on,
      start_time = n.start_time, end_time = n.end_time, meet_time = n.meet_time, host_team_id = n.host_team_id,
      is_club_wide = n.is_club_wide, invite_players = n.invite_players, invite_staff = n.invite_staff, invite_members = n.invite_members,
      visibility = n.visibility, rsvp_required = n.rsvp_required, rsvp_deadline = n.rsvp_deadline, max_guests = n.max_guests,
      catering_required = n.catering_required, catering_notes = n.catering_notes, catering_deadline = n.catering_deadline,
      capacity = n.capacity, waiting_list_enabled = n.waiting_list_enabled, payment_mode = n.payment_mode, price_note = n.price_note,
      cover_stock_key = n.cover_stock_key, cover_image_path = n.cover_image_path, location_kind = n.location_kind,
      location_detail = n.location_detail, venue_id = n.venue_id, external_location_name = n.external_location_name,
      external_address_line_1 = n.external_address_line_1, external_address_line_2 = n.external_address_line_2,
      external_town = n.external_town, external_county = n.external_county, external_postcode = n.external_postcode,
      external_country = n.external_country, external_latitude = n.external_latitude, external_longitude = n.external_longitude,
      external_address_provider_ref = n.external_address_provider_ref, online_url = n.online_url,
      -- A postponed event given a new date is back on.
      status = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then 'SCHEDULED' else e.status end,
      status_note = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then null else e.status_note end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id;
    -- Guests beyond the new rule are trimmed rather than left over the limit; food follows.
    update public.club_event_responses set guest_count = least(guest_count, n.max_guests),
           catering_count = case when n.catering_required then least(catering_count, least(guest_count, n.max_guests) + 1) else 0 end,
           dietary = case when n.catering_required then dietary else '{}'::jsonb end, updated_at = now()
     where event_id = v_id and (guest_count > n.max_guests or (not n.catering_required and catering_count > 0));
  end if;

  delete from public.club_event_teams where event_id = v_id and not (team_id = any(v_team_ids));
  insert into public.club_event_teams (event_id, team_id) select v_id, t from unnest(v_team_ids) t on conflict do nothing;
  delete from public.club_event_invitees where event_id = v_id and not (user_id = any(v_user_ids));
  insert into public.club_event_invitees (event_id, user_id, added_by) select v_id, u, auth.uid() from unnest(v_user_ids) u on conflict do nothing;

  -- ONE NOTICE FOR ONE SAVE, only once people have been invited, only for what changes their plans.
  if e.id is not null and e.invitations_sent_at is not null and e.status in ('SCHEDULED', 'POSTPONED') and cardinality(v_changed) > 0 then
    select * into n from public.club_events where id = v_id;
    v_notified := internal.club_event_notify(v_id, array(select r.user_id from internal.club_event_recipients(v_id) r),
      'event_updated', n.name || ' updated',
      'The event is now ' || internal.club_event_date_label(n) || ' at ' || coalesce(internal.club_event_place_label(n), 'a place to be confirmed') || '.',
      jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  if e.id is not null and n.capacity is distinct from e.capacity then
    perform internal.club_event_promote_waiting(v_id);
  end if;

  return jsonb_build_object('eventId', v_id, 'notified', v_notified, 'changed', to_jsonb(v_changed));
end;
$function$;
revoke all on function public.save_event(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_event(uuid, uuid, jsonb) to authenticated;

-- =====================================================================================================
-- 9. SENDING THE INVITATIONS -- and with them, publishing the event
--
-- Idempotent per person: sending again reaches only the people added since (a newly invited team, a
-- newly joined family), never the people already asked.
-- =====================================================================================================
create or replace function public.preview_event_invitations(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare e public.club_events;
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  return (
    -- The organiser sending is never sent their own invitation, so is never counted in it.
    with r as (select x.user_id from internal.club_event_recipients(p_event_id) x where x.user_id is distinct from auth.uid()),
    u as (select * from internal.club_event_units(p_event_id))
    select jsonb_build_object(
      'recipients', (select count(*) from r),
      'alreadyInvited', (select count(*) from r join public.club_event_deliveries d on d.event_id = p_event_id and d.user_id = r.user_id and d.kind = 'INVITATION'),
      'players', (select count(*) from u where u.unit_kind = 'PLAYER'),
      'staff', (select count(*) from u where u.category = 'STAFF'),
      'people', (select count(*) from u where u.category in ('INVITEE', 'MEMBER')),
      'externalGuests', (select count(*) from public.club_event_guests g where g.event_id = p_event_id))
  );
end;
$function$;
revoke all on function public.preview_event_invitations(uuid) from public, anon;
grant execute on function public.preview_event_invitations(uuid) to authenticated;

create or replace function public.send_event_invitations(p_event_id uuid, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  v_host text;
  v_new uuid[];
  v_sent integer;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id for update;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' then raise exception 'This event has been cancelled.' using errcode = '22023'; end if;
  if e.ends_on < (now() at time zone 'Europe/London')::date then raise exception 'This event has finished.' using errcode = '22023'; end if;
  if length(coalesce(v_msg, '')) > 500 then raise exception 'Keep the message under 500 characters.' using errcode = '22023'; end if;

  update public.club_events
     set status = case when status = 'DRAFT' then 'SCHEDULED' else status end,
         invitations_sent_at = coalesce(invitations_sent_at, now()),
         invitation_message = coalesce(v_msg, invitation_message),
         updated_by = auth.uid(), updated_at = now()
   where id = p_event_id
  returning * into e;

  select array_agg(r.user_id) into v_new
    from internal.club_event_recipients(p_event_id) r
   where r.user_id is distinct from auth.uid()
     and not exists (select 1 from public.club_event_deliveries d where d.event_id = p_event_id and d.user_id = r.user_id and d.kind = 'INVITATION');

  insert into public.club_event_deliveries (event_id, user_id, kind)
  select p_event_id, u, 'INVITATION' from unnest(coalesce(v_new, '{}')) u on conflict do nothing;

  v_host := coalesce((select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = e.club_id), 'Your club');
  v_sent := internal.club_event_notify(p_event_id, v_new, 'event_invitation', e.name,
    v_host || ' has invited you to the ' || e.name || ' on ' || internal.club_event_date_label(e) || '.'
      || coalesce(E'\n' || v_msg, ''));

  return jsonb_build_object('sent', v_sent, 'newlyInvited', coalesce(cardinality(v_new), 0), 'status', e.status);
end;
$function$;
revoke all on function public.send_event_invitations(uuid, text) from public, anon;
grant execute on function public.send_event_invitations(uuid, text) to authenticated;

-- =====================================================================================================
-- 10. CANCELLING AND POSTPONING -- the event keeps its identity, its answers and its history
-- =====================================================================================================
create or replace function public.cancel_club_event(p_event_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare e public.club_events; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id for update;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' then return; end if;
  update public.club_events
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = v_reason,
         updated_by = auth.uid(), updated_at = now()
   where id = p_event_id;
  if e.invitations_sent_at is not null then
    perform internal.club_event_notify(p_event_id, array(select r.user_id from internal.club_event_recipients(p_event_id) r),
      'event_cancelled', e.name || ' cancelled',
      e.name || ' on ' || internal.club_event_date_label(e) || ' is not going ahead.' || coalesce(' ' || v_reason, ''));
  end if;
end;
$function$;
revoke all on function public.cancel_club_event(uuid, text) from public, anon;
grant execute on function public.cancel_club_event(uuid, text) to authenticated;

create or replace function public.postpone_event(p_event_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare e public.club_events; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id for update;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  if e.status <> 'SCHEDULED' then raise exception 'Only a scheduled event can be postponed.' using errcode = '22023'; end if;
  if length(coalesce(v_note, '')) > 300 then raise exception 'Keep the note under 300 characters.' using errcode = '22023'; end if;
  update public.club_events set status = 'POSTPONED', status_note = v_note, updated_by = auth.uid(), updated_at = now() where id = p_event_id;
  if e.invitations_sent_at is not null then
    perform internal.club_event_notify(p_event_id, array(select r.user_id from internal.club_event_recipients(p_event_id) r),
      'event_postponed', e.name || ' postponed',
      e.name || ' is postponed. A new date will follow, and your answer is kept.' || coalesce(' ' || v_note, ''));
  end if;
end;
$function$;
revoke all on function public.postpone_event(uuid, text) from public, anon;
grant execute on function public.postpone_event(uuid, text) to authenticated;

-- =====================================================================================================
-- 11. THE EVENT CENTRE, AS THIS VIEWER MAY SEE IT
--
-- ONE projection, every viewer. Organisers get the totals, names, catering aggregates and controls;
-- an invitee gets the event, their own household's answers and the public catering notes; anybody
-- else gets nothing (the visibility rule). The meeting link is sent only to the invited and organisers.
-- Dietary detail is AGGREGATE for organisers; a person's own answer is theirs.
-- =====================================================================================================
create or replace function public.get_event_centre(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  v_manage boolean;
  v_invited boolean;
  v_mine jsonb;
  v_summary jsonb;
  v_heads integer;
  v_wait_count integer;
  v_wait_heads integer;
  v_host jsonb;
  v_venue jsonb;
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or not internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide) then
    return null;
  end if;
  v_manage := internal.can_manage_club_event(e.id);
  v_invited := internal.club_event_caller_invited(e.id);

  select jsonb_build_object('clubId', c.id, 'clubName', d.name, 'directoryId', d.id,
                            'logoPath', coalesce(c.logo_storage_path, d.logo_storage_path),
                            'teamId', t.id, 'teamName', t.display_name)
    into v_host
    from public.clubs c join public.club_directory d on d.id = c.directory_id
    left join public.teams t on t.id = e.host_team_id
   where c.id = e.club_id;

  if e.location_kind = 'VENUE' then
    select jsonb_build_object('id', v.id, 'name', v.name,
             'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.address_line_2), ''),
                                                  nullif(btrim(v.town), ''), nullif(btrim(v.county), '')), ''), nullif(btrim(v.address), '')),
             'postcode', v.postcode, 'latitude', v.latitude, 'longitude', v.longitude, 'directions', nullif(btrim(v.directions), ''),
             'coverImagePath', v.cover_image_path, 'coverStockKey', v.cover_stock_key)
      into v_venue from public.venues v where v.id = e.venue_id;
  end if;

  -- MY HOUSEHOLD: the players I answer for, and myself where I am invited in my own right.
  select coalesce(jsonb_agg(x order by x ->> 'sort', x ->> 'name'), '[]') into v_mine from (
    select jsonb_build_object(
             'kind', 'PLAYER', 'playerId', p.id, 'userId', null, 'sort', '1',
             'name', nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), 'firstName', p.first_name,
             'teamName', t.display_name, 'isSelf', coalesce(p.user_id = auth.uid(), false),
             'canRespond', internal.resolve_attendance_response_source(p.id) is not null,
             'response', case when r.id is null then null else jsonb_build_object('status', r.status, 'guests', r.guest_count,
                           'catering', r.catering_count, 'dietary', r.dietary, 'dietaryNote', r.dietary_note,
                           'waitlisted', r.waitlisted_at is not null) end) x
      from internal.club_event_units(e.id) u
      join public.players p on p.id = u.player_id
      left join public.teams t on t.id = u.team_id
      left join public.club_event_responses r on r.event_id = e.id and r.player_id = p.id
     where u.unit_kind = 'PLAYER' and internal.can_player_as_family('player.profile.view', p.id)
    union all
    select jsonb_build_object(
             'kind', 'PERSON', 'playerId', null, 'userId', u.user_id, 'sort', '0',
             'name', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'firstName', pr.first_name,
             'teamName', null, 'isSelf', true, 'canRespond', true, 'category', u.category,
             'response', case when r.id is null then null else jsonb_build_object('status', r.status, 'guests', r.guest_count,
                           'catering', r.catering_count, 'dietary', r.dietary, 'dietaryNote', r.dietary_note,
                           'waitlisted', r.waitlisted_at is not null) end)
      from internal.club_event_units(e.id) u
      join public.profiles pr on pr.id = u.user_id
      left join public.club_event_responses r on r.event_id = e.id and r.user_id = u.user_id
     where u.unit_kind = 'PERSON' and u.user_id = auth.uid()
  ) q(x);

  v_heads := internal.club_event_confirmed_heads(e.id);
  select count(*), coalesce(sum(1 + w.guest_count), 0) into v_wait_count, v_wait_heads from (
    select r.guest_count from public.club_event_responses r where r.event_id = e.id and r.waitlisted_at is not null
    union all select g.guest_count from public.club_event_guests g where g.event_id = e.id and g.waitlisted_at is not null) w;

  if v_manage then
    with units as (select * from internal.club_event_units(e.id)),
    ans as (
      select u.category, r.status, r.guest_count, r.catering_count, r.dietary, r.waitlisted_at
        from units u
        left join public.club_event_responses r on r.event_id = e.id
             and ((u.unit_kind = 'PLAYER' and r.player_id = u.player_id) or (u.unit_kind = 'PERSON' and r.user_id = u.user_id))
    ),
    conf as (select * from ans where status = 'ATTENDING' and waitlisted_at is null),
    gconf as (select * from public.club_event_guests g where g.event_id = e.id and g.status = 'ATTENDING' and g.waitlisted_at is null),
    diet as (
      select k, sum((v)::int) n from (
        select d.k, d.v from conf c, jsonb_each_text(c.dietary) d(k, v)
        union all select d.k, d.v from gconf g, jsonb_each_text(g.dietary) d(k, v)) z group by k)
    select jsonb_build_object(
      'invited', (select count(*) from units),
      'attending', (select count(*) from ans where status = 'ATTENDING' and waitlisted_at is null),
      'cannotAttend', (select count(*) from ans where status = 'CANNOT_ATTEND'),
      'unsure', (select count(*) from ans where status = 'UNSURE'),
      'awaiting', (select count(*) from ans where status is null),
      'waiting', v_wait_count,
      'externalGuests', (select count(*) from public.club_event_guests g where g.event_id = e.id),
      'peopleConfirmed', v_heads,
      'catering', case when e.catering_required then jsonb_build_object(
          'players', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category = 'PLAYER'),
          'staff', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category = 'STAFF'),
          'members', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category in ('INVITEE', 'MEMBER')),
          'familyAndGuests', (select coalesce(sum(greatest(catering_count - 1, 0)), 0) from conf),
          'externalGuests', (select coalesce(sum(catering_count), 0) from gconf),
          'total', (select coalesce(sum(catering_count), 0) from conf) + (select coalesce(sum(catering_count), 0) from gconf),
          'dietary', coalesce((select jsonb_object_agg(k, n) from diet where n > 0), '{}'::jsonb),
          'otherNotes', (select count(*) from public.club_event_responses r where r.event_id = e.id and r.dietary_note is not null
                          and r.status = 'ATTENDING' and r.waitlisted_at is null)) end)
      into v_summary;
  end if;

  return jsonb_build_object(
    'id', e.id, 'name', e.name, 'eventType', e.event_type, 'description', e.description,
    'status', e.status, 'phase', internal.club_event_phase(e.status, e.ends_on), 'statusNote', e.status_note,
    'cancellationReason', e.cancellation_reason,
    'startsOn', e.starts_on, 'endsOn', e.ends_on, 'startTime', to_char(e.start_time, 'HH24:MI'), 'endTime', to_char(e.end_time, 'HH24:MI'),
    'meetTime', to_char(e.meet_time, 'HH24:MI'),
    'host', v_host, 'isClubWide', e.is_club_wide,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) order by t.display_name)
                         from public.club_event_teams cet join public.teams t on t.id = cet.team_id where cet.event_id = e.id), '[]'),
    'invites', jsonb_build_object('players', e.invite_players, 'staff', e.invite_staff, 'members', e.invite_members,
                                  'individuals', (select count(*) from public.club_event_invitees i where i.event_id = e.id)),
    'visibility', e.visibility,
    'location', jsonb_build_object(
      'kind', e.location_kind, 'detail', e.location_detail, 'venue', v_venue,
      'external', case when e.location_kind = 'EXTERNAL' then jsonb_build_object('name', e.external_location_name,
          'address', nullif(concat_ws(', ', e.external_address_line_1, e.external_address_line_2, e.external_town, e.external_county), ''),
          'postcode', e.external_postcode, 'latitude', e.external_latitude, 'longitude', e.external_longitude) end,
      'onlineUrl', case when e.location_kind = 'ONLINE' and (v_manage or v_invited) then e.online_url end),
    'rsvp', jsonb_build_object('required', e.rsvp_required, 'deadline', e.rsvp_deadline,
                               'open', e.status in ('SCHEDULED', 'POSTPONED') and e.ends_on >= (now() at time zone 'Europe/London')::date
                                       and (e.rsvp_deadline is null or now() <= e.rsvp_deadline)),
    'maxGuests', e.max_guests,
    'catering', jsonb_build_object('required', e.catering_required, 'notes', e.catering_notes, 'deadline', e.catering_deadline),
    'capacity', jsonb_build_object('limit', e.capacity, 'waitingList', e.waiting_list_enabled,
                                   'remaining', case when e.capacity is not null then greatest(e.capacity - v_heads, 0) end,
                                   'full', e.capacity is not null and v_heads >= e.capacity),
    'payment', jsonb_build_object('mode', e.payment_mode, 'note', e.price_note),
    'cover', jsonb_build_object('path', e.cover_image_path, 'stockKey', e.cover_stock_key),
    'invitationsSentAt', e.invitations_sent_at, 'invitationMessage', e.invitation_message,
    'viewer', jsonb_build_object('canManage', v_manage, 'invited', v_invited),
    'mine', v_mine,
    'summary', v_summary);
end;
$function$;
revoke all on function public.get_event_centre(uuid) from public, anon;
grant execute on function public.get_event_centre(uuid) to authenticated;

-- THE GUEST LIST -- organisers only, and then only the people this event is for.
create or replace function public.get_event_guest_list(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  if not internal.can_manage_club_event(p_event_id) then
    raise exception 'Only the event''s organisers can see who has answered.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', u.unit_kind, 'playerId', u.player_id, 'userId', u.user_id, 'category', u.category,
               'name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Name not recorded'),
               'teamName', t.display_name,
               'status', r.status, 'guests', coalesce(r.guest_count, 0), 'catering', coalesce(r.catering_count, 0),
               'waitlisted', r.waitlisted_at is not null, 'waitlistedAt', r.waitlisted_at,
               'dietary', coalesce(r.dietary, '{}'::jsonb), 'dietaryNote', r.dietary_note)
             order by u.category, coalesce(p.surname, pr.surname), coalesce(p.first_name, pr.first_name))
        from internal.club_event_units(p_event_id) u
        left join public.players p on p.id = u.player_id
        left join public.profiles pr on pr.id = u.user_id
        left join public.teams t on t.id = u.team_id
        left join public.club_event_responses r on r.event_id = p_event_id
             and ((u.unit_kind = 'PLAYER' and r.player_id = u.player_id) or (u.unit_kind = 'PERSON' and r.user_id = u.user_id))), '[]'),
    'external', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'phone', g.phone, 'status', g.status,
               'guests', g.guest_count, 'catering', g.catering_count, 'dietary', g.dietary, 'dietaryNote', g.dietary_note,
               'notes', g.notes, 'waitlisted', g.waitlisted_at is not null) order by g.created_at)
        from public.club_event_guests g where g.event_id = p_event_id), '[]'),
    'individuals', coalesce((
      select jsonb_agg(jsonb_build_object('userId', i.user_id, 'name', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), '')) order by pr.first_name)
        from public.club_event_invitees i join public.profiles pr on pr.id = i.user_id where i.event_id = p_event_id), '[]'));
end;
$function$;
revoke all on function public.get_event_guest_list(uuid) from public, anon;
grant execute on function public.get_event_guest_list(uuid) to authenticated;

-- PEOPLE AN ORGANISER CAN NAME: the club's own members and families, searched by name.
create or replace function public.search_event_invitable_people(p_event_id uuid, p_query text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare e public.club_events; v_q text := btrim(coalesce(p_query, ''));
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', x.id, 'name', x.name, 'detail', x.detail) order by x.name)
      from (
        select distinct on (pr.id) pr.id, nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), '') as name,
               coalesce((select string_agg(distinct initcap(replace(lower(ra.role_key), '_', ' ')), ', ')
                           from public.role_assignments ra where ra.user_id = pr.id and ra.club_id = e.club_id and ra.state = 'ACTIVE'
                             and ra.role_key <> 'MEMBER'), 'Member') as detail
          from public.profiles pr
         where (exists (select 1 from public.club_memberships cm where cm.user_id = pr.id and cm.club_id = e.club_id and cm.status = 'active')
                or exists (select 1 from public.guardians g join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
                             join public.teams t on t.id = ptm.team_id where g.guardian_user_id = pr.id and g.status = 'active' and t.club_id = e.club_id))
           and concat_ws(' ', pr.first_name, pr.surname) ilike '%' || v_q || '%'
         limit 25) x), '[]'::jsonb);
end;
$function$;
revoke all on function public.search_event_invitable_people(uuid, text) from public, anon;
grant execute on function public.search_event_invitable_people(uuid, text) to authenticated;

-- EXTERNAL GUESTS -- recorded by an organiser, no account needed, capacity enforced the same way.
create or replace function public.save_event_guest(p_event_id uuid, p_guest_id uuid, p_guest jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  g public.club_event_guests;
  v_id uuid := p_guest_id;
  v_status text := nullif(p_guest ->> 'status', '');
  v_party jsonb;
  v_wait timestamptz;
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id for update;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' then raise exception 'This event has been cancelled.' using errcode = '22023'; end if;
  if v_id is not null then
    select * into g from public.club_event_guests where id = v_id and event_id = p_event_id;
    if g.id is null then raise exception 'Guest not found.' using errcode = 'P0002'; end if;
  end if;
  if v_status is not null and v_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Attending, Can''t Attend or Unsure.' using errcode = '22023';
  end if;
  v_party := internal.club_event_check_party(e, coalesce(v_status, 'UNSURE'), (p_guest ->> 'guests')::int,
                                              (p_guest ->> 'catering')::int, p_guest -> 'dietary');
  if v_status = 'ATTENDING' and e.capacity is not null and g.waitlisted_at is null
     and 1 + (v_party ->> 'guests')::int > e.capacity - internal.club_event_confirmed_heads(e.id, null, v_id) then
    if e.waiting_list_enabled then v_wait := now(); else raise exception 'This event is full.' using errcode = '22023'; end if;
  elsif v_status = 'ATTENDING' then
    v_wait := g.waitlisted_at;
  end if;

  if v_id is null then
    insert into public.club_event_guests (event_id, name, email, phone, status, guest_count, catering_count, dietary, dietary_note, notes, waitlisted_at, added_by)
    values (p_event_id, btrim(coalesce(p_guest ->> 'name', '')), nullif(btrim(coalesce(p_guest ->> 'email', '')), ''),
            nullif(btrim(coalesce(p_guest ->> 'phone', '')), ''), v_status, (v_party ->> 'guests')::int, (v_party ->> 'catering')::int,
            v_party -> 'dietary', nullif(btrim(coalesce(p_guest ->> 'dietaryNote', '')), ''), nullif(btrim(coalesce(p_guest ->> 'notes', '')), ''),
            v_wait, auth.uid())
    returning id into v_id;
  else
    update public.club_event_guests set name = btrim(coalesce(p_guest ->> 'name', name)),
           email = case when p_guest ? 'email' then nullif(btrim(coalesce(p_guest ->> 'email', '')), '') else email end,
           phone = case when p_guest ? 'phone' then nullif(btrim(coalesce(p_guest ->> 'phone', '')), '') else phone end,
           status = v_status, guest_count = (v_party ->> 'guests')::int, catering_count = (v_party ->> 'catering')::int,
           dietary = v_party -> 'dietary',
           dietary_note = case when p_guest ? 'dietaryNote' then nullif(btrim(coalesce(p_guest ->> 'dietaryNote', '')), '') else dietary_note end,
           notes = case when p_guest ? 'notes' then nullif(btrim(coalesce(p_guest ->> 'notes', '')), '') else notes end,
           waitlisted_at = v_wait, updated_at = now()
     where id = v_id;
    if g.status = 'ATTENDING' and g.waitlisted_at is null then perform internal.club_event_promote_waiting(p_event_id); end if;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.save_event_guest(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_event_guest(uuid, uuid, jsonb) to authenticated;

create or replace function public.remove_event_guest(p_event_id uuid, p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  perform 1 from public.club_events where id = p_event_id for update;
  if not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  delete from public.club_event_guests where id = p_guest_id and event_id = p_event_id;
  perform internal.club_event_promote_waiting(p_event_id);
end;
$function$;
revoke all on function public.remove_event_guest(uuid, uuid) from public, anon;
grant execute on function public.remove_event_guest(uuid, uuid) to authenticated;

-- =====================================================================================================
-- 12. ANNOUNCEMENTS AND REMINDERS -- the Match Centre's pattern, at an event's scale
--
-- Organisers write to an audience defined by the answers; the reach is shown before sending; every
-- send is logged in public.fixture_communications (event_id) with exactly who it went to. There is no
-- all-attendee group chat: a 400-person party would be unusable and would expose every family to every
-- other. Families read what was sent to them in the Event Centre; organisers have the log.
-- =====================================================================================================
create or replace function internal.club_event_audience(p_event_id uuid, p_audience text)
returns table(user_id uuid)
language sql
stable security definer
set search_path to ''
as $function$
  with units as (select * from internal.club_event_units(p_event_id)),
  ans as (
    select u.*, r.status, r.waitlisted_at
      from units u
      left join public.club_event_responses r on r.event_id = p_event_id
           and ((u.unit_kind = 'PLAYER' and r.player_id = u.player_id) or (u.unit_kind = 'PERSON' and r.user_id = u.user_id))
  ), picked as (
    select * from ans
     where case p_audience
             when 'ALL' then true
             when 'ATTENDING' then status = 'ATTENDING' and waitlisted_at is null
             when 'CANNOT_ATTEND' then status = 'CANNOT_ATTEND'
             when 'UNSURE' then status = 'UNSURE'
             when 'AWAITING' then status is null
             when 'AWAITING_AND_UNSURE' then status is null or status = 'UNSURE'
             when 'WAITLIST' then waitlisted_at is not null
             else false end
  )
  select r.user_id from internal.club_event_unit_recipients(p_event_id,
    array(select player_id from picked where unit_kind = 'PLAYER'),
    array(select user_id from picked where unit_kind = 'PERSON')) r;
$function$;
revoke all on function internal.club_event_audience(uuid, text) from public, anon, authenticated;

create or replace function public.event_audience_counts(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  if not internal.can_manage_club_event(p_event_id) then
    raise exception 'Only the event''s organisers can message its guests.' using errcode = '42501';
  end if;
  return (select jsonb_object_agg(a, (select count(*) from internal.club_event_audience(p_event_id, a) x where x.user_id is distinct from auth.uid()))
            from unnest(array['ALL', 'ATTENDING', 'CANNOT_ATTEND', 'UNSURE', 'AWAITING', 'AWAITING_AND_UNSURE', 'WAITLIST']) a);
end;
$function$;
revoke all on function public.event_audience_counts(uuid) from public, anon;
grant execute on function public.event_audience_counts(uuid) to authenticated;

create or replace function public.send_event_message(p_event_id uuid, p_kind text, p_audience text, p_body text, p_push boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  e public.club_events;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_users uuid[];
  v_comm uuid;
  v_action text;
  v_type text := 'event_announcement';
  v_sent integer := 0;
  v_recent integer;
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or not internal.can_manage_club_event(p_event_id) then
    raise exception 'Only the event''s organisers can message its guests.' using errcode = '42501';
  end if;
  if e.status = 'DRAFT' or e.invitations_sent_at is null then
    raise exception 'Send the invitations first.' using errcode = '22023';
  end if;
  if p_kind not in ('ANNOUNCEMENT', 'REMINDER') then raise exception 'An announcement or a reminder.' using errcode = '22023'; end if;
  if p_kind = 'REMINDER' then
    v_type := 'event_reminder';
  end if;
  if p_kind = 'REMINDER' and p_audience not in ('AWAITING', 'UNSURE', 'AWAITING_AND_UNSURE') then
    raise exception 'A reminder goes to people who have not answered, or are unsure.' using errcode = '22023';
  end if;
  if p_audience not in ('ALL', 'ATTENDING', 'CANNOT_ATTEND', 'UNSURE', 'AWAITING', 'AWAITING_AND_UNSURE', 'WAITLIST') then
    raise exception 'Unknown audience.' using errcode = '22023';
  end if;
  if p_kind = 'ANNOUNCEMENT' and v_body is null then raise exception 'Write the announcement first.' using errcode = '22023'; end if;
  if length(coalesce(v_body, '')) > 1000 then raise exception 'Keep it under 1,000 characters.' using errcode = '22023'; end if;

  v_action := case
    when p_kind = 'REMINDER' and p_audience = 'AWAITING' then 'REMIND_AWAITING'
    when p_kind = 'REMINDER' and p_audience = 'UNSURE' then 'REMIND_UNSURE'
    when p_kind = 'REMINDER' then 'REMIND_AWAITING_AND_UNSURE'
    else case p_audience when 'ALL' then 'MESSAGE_ALL' when 'ATTENDING' then 'MESSAGE_ATTENDEES' when 'CANNOT_ATTEND' then 'MESSAGE_CANNOT_ATTEND'
                         when 'UNSURE' then 'MESSAGE_UNSURE' when 'AWAITING' then 'MESSAGE_AWAITING' when 'WAITLIST' then 'MESSAGE_WAITLIST'
                         else 'MESSAGE_ALL' end end;

  -- NO REMINDER STORMS: the same reminder to the same audience at most once in six hours.
  if p_kind = 'REMINDER' then
    select count(*) into v_recent from public.fixture_communications
     where event_id = p_event_id and action = v_action and created_at > now() - interval '6 hours' and outcome = 'SENT';
    if v_recent > 0 then
      raise exception 'That reminder went out in the last six hours.' using errcode = '22023';
    end if;
  end if;

  select array_agg(a.user_id) into v_users from internal.club_event_audience(p_event_id, p_audience) a where a.user_id is distinct from auth.uid();

  insert into public.fixture_communications (event_id, action, sent_by, outcome, player_count, recipient_count, delivered_count, body)
  values (p_event_id, v_action, auth.uid(), case when coalesce(cardinality(v_users), 0) = 0 then 'NO_ELIGIBLE_RECIPIENTS' else 'SENT' end,
          0, coalesce(cardinality(v_users), 0), coalesce(cardinality(v_users), 0),
          coalesce(v_body, case when p_kind = 'REMINDER' then null end))
  returning id into v_comm;
  insert into public.fixture_communication_recipients (communication_id, user_id) select v_comm, u from unnest(coalesce(v_users, '{}')) u;

  if coalesce(cardinality(v_users), 0) > 0 then
    v_sent := internal.club_event_notify(p_event_id, v_users, v_type,
      case when p_kind = 'REMINDER' then e.name || ': please reply' else e.name end,
      coalesce(v_body, 'Please let the organisers know whether you can come to ' || e.name || ' on ' || internal.club_event_date_label(e) || '.'),
      jsonb_build_object('communication_id', v_comm), coalesce(p_push, true));
  end if;
  return jsonb_build_object('communicationId', v_comm, 'sent', v_sent);
end;
$function$;
revoke all on function public.send_event_message(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.send_event_message(uuid, text, text, text, boolean) to authenticated;

create or replace function public.get_event_messages(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare v_manage boolean;
begin
  perform internal.require_live_session();
  if not exists (select 1 from public.club_events e where e.id = p_event_id and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)) then
    raise exception 'This event is not available.' using errcode = '42501';
  end if;
  v_manage := internal.can_manage_club_event(p_event_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', fc.id,
             'kind', case when fc.action like 'REMIND%' then 'REMINDER' else 'ANNOUNCEMENT' end,
             'audience', case fc.action when 'MESSAGE_ALL' then 'Everyone invited' when 'MESSAGE_ATTENDEES' then 'Attending'
                           when 'MESSAGE_CANNOT_ATTEND' then 'Can''t Attend' when 'MESSAGE_UNSURE' then 'Unsure'
                           when 'MESSAGE_AWAITING' then 'Awaiting a reply' when 'MESSAGE_WAITLIST' then 'Waiting list'
                           when 'REMIND_AWAITING' then 'Awaiting a reply' when 'REMIND_UNSURE' then 'Unsure'
                           else 'Awaiting a reply or unsure' end,
             'body', fc.body,
             'sentBy', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''),
             'sentAt', fc.created_at,
             'reach', case when v_manage then fc.recipient_count end) order by fc.created_at desc)
      from public.fixture_communications fc
      left join public.profiles pr on pr.id = fc.sent_by
     where fc.event_id = p_event_id and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
       and (v_manage or exists (select 1 from public.fixture_communication_recipients r where r.communication_id = fc.id and r.user_id = auth.uid()))), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_event_messages(uuid) from public, anon;
grant execute on function public.get_event_messages(uuid) to authenticated;

-- =====================================================================================================
-- 13. AUTOMATIC REMINDERS -- once per person per kind, through the same ledger as invitations
--   * two days before the RSVP deadline, to those still to answer
--   * the day before, to those attending
-- =====================================================================================================
create or replace function internal.send_due_event_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare e public.club_events; v_users uuid[]; v_total integer := 0; v_today date := (now() at time zone 'Europe/London')::date;
begin
  for e in select * from public.club_events where status = 'SCHEDULED' and invitations_sent_at is not null and ends_on >= v_today loop
    if e.rsvp_required and e.rsvp_deadline is not null and now() < e.rsvp_deadline and e.rsvp_deadline - now() <= interval '2 days' then
      select array_agg(a.user_id) into v_users from internal.club_event_audience(e.id, 'AWAITING') a
       where not exists (select 1 from public.club_event_deliveries d where d.event_id = e.id and d.user_id = a.user_id and d.kind = 'RSVP_DEADLINE_REMINDER');
      insert into public.club_event_deliveries (event_id, user_id, kind) select e.id, u, 'RSVP_DEADLINE_REMINDER' from unnest(coalesce(v_users, '{}')) u on conflict do nothing;
      v_total := v_total + internal.club_event_notify(e.id, v_users, 'event_reminder', e.name || ': please reply',
        'Replies for ' || e.name || ' close on ' || to_char(e.rsvp_deadline at time zone 'Europe/London', 'FMDay FMDD FMMonth') || '.');
    end if;
    if e.starts_on = v_today + 1 then
      select array_agg(a.user_id) into v_users from internal.club_event_audience(e.id, 'ATTENDING') a
       where not exists (select 1 from public.club_event_deliveries d where d.event_id = e.id and d.user_id = a.user_id and d.kind = 'DAY_BEFORE_REMINDER');
      insert into public.club_event_deliveries (event_id, user_id, kind) select e.id, u, 'DAY_BEFORE_REMINDER' from unnest(coalesce(v_users, '{}')) u on conflict do nothing;
      v_total := v_total + internal.club_event_notify(e.id, v_users, 'event_reminder', e.name || ' is tomorrow',
        e.name || ' is tomorrow' || coalesce(' at ' || to_char(e.start_time, 'HH24:MI'), '') || ', ' || coalesce(internal.club_event_place_label(e), '') || '.');
    end if;
  end loop;
  return v_total;
end;
$function$;
revoke all on function internal.send_due_event_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('send-event-reminders', '0 9 * * *', $job$select internal.send_due_event_reminders()$job$);
  else
    raise notice 'pg_cron is not installed in %; send-event-reminders was not scheduled.', current_database();
  end if;
end $$;

-- =====================================================================================================
-- 14. THE NOTIFICATIONS -- registered, under their own topic, each landing on the Event Centre
-- =====================================================================================================
insert into public.notification_topics (key, label, description, mandatory, sort_order)
values ('events', 'Club events', 'Invitations, changes and announcements for club and team events you are invited to.', false, 5)
on conflict (key) do nothing;
insert into public.notification_types (type_key, topic_key, mandatory_override) values
  ('event_invitation', 'events', null),
  ('event_updated', 'events', null),
  ('event_postponed', 'events', null),
  ('event_cancelled', 'events', true),
  ('event_announcement', 'events', null),
  ('event_reminder', 'events', null),
  ('event_waitlist_promoted', 'events', null)
on conflict (type_key) do nothing;

-- PUSH IS THE ORGANISER'S CHOICE PER ANNOUNCEMENT. A notification marked {"push": false} stays in the
-- app; everything else is pushed exactly as before, subject to each person's own preferences.
create or replace function internal.deliver_push_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_messages jsonb;
begin
  if coalesce(new.data ->> 'push', 'true') = 'false' then
    return new;
  end if;
  if not internal.should_deliver_notification(new.user_id, new.type, 'push') then
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', new.title,
    'body', new.body,
    'data', jsonb_build_object('type', new.type, 'notificationId', new.id) || coalesce(new.data, '{}'::jsonb),
    'sound', 'default'
  )), '[]'::jsonb)
  into v_messages
  from public.push_device_tokens t
  where t.user_id = new.user_id;

  if jsonb_array_length(v_messages) = 0 then
    return new;
  end if;

  -- FIRE-AND-FORGET, deliberately: `net.http_post` queues the request and returns immediately, and
  -- nothing here waits on or inspects Expo's response. A push failing is not a reason to fail the
  -- write that already told this person in the app.
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );

  return new;
end;
$function$;

-- =====================================================================================================
-- 15. THE COVER PICTURE -- a private bucket, read by the people who can see the event
-- =====================================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function internal.event_cover_access(p_name text, p_write boolean)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((
    select case when p_write then internal.can_manage_club_event(e.id)
                else internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide) end
      from public.club_events e
     where e.id::text = split_part(p_name, '/', 1)), false);
$function$;
revoke all on function internal.event_cover_access(text, boolean) from public, anon;
grant execute on function internal.event_cover_access(text, boolean) to authenticated;

drop policy if exists event_covers_select on storage.objects;
create policy event_covers_select on storage.objects for select to authenticated
  using (bucket_id = 'event-covers' and internal.event_cover_access(name, false));
drop policy if exists event_covers_insert on storage.objects;
create policy event_covers_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-covers' and internal.event_cover_access(name, true));
drop policy if exists event_covers_update on storage.objects;
create policy event_covers_update on storage.objects for update to authenticated
  using (bucket_id = 'event-covers' and internal.event_cover_access(name, true));
drop policy if exists event_covers_delete on storage.objects;
create policy event_covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-covers' and internal.event_cover_access(name, true));

-- =====================================================================================================
-- 16. RETIRED -- the older event writers and readers, superseded above
-- =====================================================================================================
-- The WEBSITE's Event page (not changed in this mobile slice) still asks these three. They keep their
-- shapes and now read and write the one answer table, so the web and the app agree on every answer.
create or replace function public.respond_to_event_attendance(p_event_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform public.respond_to_event(p_event_id, p_player_id, p_status, 0, null, '{}'::jsonb, null);
end;
$function$;
revoke all on function public.respond_to_event_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.respond_to_event_attendance(uuid, uuid, text) to authenticated;

create or replace function public.get_my_players_for_club_event(p_event_id uuid)
returns table(player_id uuid, player_name text, team_display_name text, status text, can_respond boolean)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p.id, nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), t.display_name, r.status,
         internal.resolve_attendance_response_source(p.id) is not null
    from public.club_events e
    cross join lateral internal.club_event_units(e.id) u
    join public.players p on p.id = u.player_id
    left join public.teams t on t.id = u.team_id
    left join public.club_event_responses r on r.event_id = e.id and r.player_id = p.id
   where e.id = p_event_id and u.unit_kind = 'PLAYER'
     and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)
     and internal.can_player_as_family('player.profile.view', p.id);
$function$;

create or replace function public.get_club_event_register(p_event_id uuid)
returns table(player_id uuid, player_name text, team_id uuid, team_display_name text, status text, response_source text, responded_at timestamptz)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p.id, nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), u.team_id, t.display_name, r.status, r.response_source, r.updated_at
    from internal.club_event_units(p_event_id) u
    join public.players p on p.id = u.player_id
    left join public.teams t on t.id = u.team_id
    left join public.club_event_responses r on r.event_id = p_event_id and r.player_id = p.id
   where u.unit_kind = 'PLAYER' and internal.can_manage_club_event(p_event_id);
$function$;

-- =====================================================================================================
-- 17. MY ANSWERS, FOR THE CALENDAR -- one row per event and household member, so a card can say
-- "Ava · Attending" without the calendar reading anybody else's answer.
-- =====================================================================================================
create or replace function public.my_event_answers(p_event_ids uuid[])
returns table(event_id uuid, player_id uuid, first_name text, status text, waitlisted boolean, is_self boolean)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select e.id, u.player_id, coalesce(p.first_name, pr.first_name), r.status, r.waitlisted_at is not null,
         u.unit_kind = 'PERSON' or coalesce(p.user_id = auth.uid(), false)
    from public.club_events e
    cross join lateral internal.club_event_units(e.id) u
    left join public.players p on p.id = u.player_id
    left join public.profiles pr on pr.id = u.user_id
    left join public.club_event_responses r on r.event_id = e.id
         and ((u.unit_kind = 'PLAYER' and r.player_id = u.player_id) or (u.unit_kind = 'PERSON' and r.user_id = u.user_id))
   where e.id = any (coalesce(p_event_ids, '{}')) and e.status <> 'DRAFT'
     and ((u.unit_kind = 'PERSON' and u.user_id = auth.uid())
          or (u.unit_kind = 'PLAYER' and internal.can_player_as_family('player.profile.view', u.player_id)))
   limit 500;
$function$;
revoke all on function public.my_event_answers(uuid[]) from public, anon;
grant execute on function public.my_event_answers(uuid[]) to authenticated;
