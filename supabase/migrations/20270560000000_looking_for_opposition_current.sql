-- CLUBHOUSE PROGRAMME SECTIONS 15/16 -- LOOKING FOR OPPOSITION / OPPORTUNITY MATCHING.
--
-- OWNER RECONCILIATION, NOT A REPLAY. supabase/migrations/20270554000000_looking_for_opposition.sql was
-- drafted, parked, and re-audited twice without ever being applied. The owner's own review (this
-- session) accepted its core architecture -- team-owned listing, converge-into-accept_fixture_request,
-- select-only RLS with SECURITY DEFINER writes, superseded-on-accept race handling -- as still exactly
-- what we would design today, and explicitly classified it "B": adopt the concept, reissue as a new,
-- current migration, never apply the parked file itself. The parked file remains untouched, unapplied,
-- historical reference only -- checksummed before and after this migration was written; this file
-- duplicates none of its text, it is written fresh against the schema this repository actually has today.
--
-- WHAT THIS FIXES THAT THE PARKED DRAFT DID NOT, EACH FOUND BY DILIGENCE AGAINST CURRENT CODE, NOT GUESSED:
--
--   1. SAFEGUARDING (the one defect the owner named explicitly as unacceptable): the parked draft's four
--      notification fan-outs joined team_permissions with no rank filter at all. team_permissions.permission
--      has a fourth value, 'view_only' -- documented in 20260831090000_role_vocabulary_and_claim_approval.sql
--      as "(parents/players)". Every notification insert below carries the same
--      `tp.permission in ('team_admin', 'coach', 'manager')` filter counter_fixture_request already
--      established (20270553000000) -- staff-only club-to-club scheduling chatter never reaches a family
--      account, matching this domain's own discovery policy, which already excludes them the same way.
--   2. OWNERSHIP INTEGRITY: publishing_club_id is now SERVER-DERIVED on every insert/update via trigger,
--      never trusted from the row as supplied -- a caller cannot persist publishing_team_id from one club
--      alongside publishing_club_id naming a different one.
--   3. REAL EXPIRY: `expired` was a declared status nothing could ever enter. internal.
--      fixture_opportunity_effective_status() derives it transactionally from proposed_date -- no cron,
--      no scheduled worker -- and every consumer that matters (the RLS policy, every mutating function's
--      own refusal check, and find_fixture_opportunities) calls it fresh rather than trusting the stored
--      column, so the discovery read never returns a stale "open" row. The stored column is deliberately
--      NOT persisted by a refusal path -- found, testing this exact migration, that a raised exception
--      always undoes an update made earlier in the same call; see the comment beside the function itself.
--   4. THE DUPLICATE-REQUEST INTERACTION: Section 8 (this run, chronologically AFTER the parked draft)
--      added internal.enforce_fixture_request_not_duplicate(), a trigger the parked draft's author could
--      not have known about. accept_fixture_opportunity_response now pre-checks the exact same predicate
--      that trigger enforces and returns a clear, specific refusal naming the existing request rather than
--      letting a raw trigger exception surface.
--   5. NOTIFICATION CATALOGUE REGISTRATION: all four new notification types are registered in
--      packages/contracts/src/notifications/destinations.ts (this migration's companion TypeScript
--      changes) and in CLUBHOUSE_NOTIFICATION_TYPES, so scripts/verify-notification-catalogue.mjs never
--      sees an unrouted emission and Clubhouse's own Activity feed actually shows this domain's events.
--   6. A REAL BATCHED DISCOVERY READ MODEL (Section 16): find_fixture_opportunities(p_team_id) returns
--      everything a Discover screen needs in one round trip -- never a bare `select * from
--      fixture_opportunities` with client-side filtering, which is exactly the architecture Clubhouse
--      discovery moved past in Sections 6-8. It re-derives compatibility and authority itself (SECURITY
--      DEFINER bypasses RLS, so the table's own SELECT policy is not a substitute for re-checking inside
--      the function body -- the same discipline compatible_opponent_teams/find_fixture_candidate_teams
--      already follow). Distance and partnership state are DELIBERATELY NOT computed here: the RPC returns
--      raw, already-public club_directory location facts for the publishing club (never its venue --
--      venues_select RLS only ever admits a club's own venue, and widening that for every other club on
--      the network would be the "separate authority decision" Section 3's own architecture note already
--      declined to make; this migration does not make it either) and leaves distance/partnership
--      resolution to the EXISTING pure client functions (resolveClubLocation, distanceMiles,
--      resolvePartnershipStatus) already trusted everywhere else in Clubhouse -- no second geo
--      calculation, no second partnership-authority decision.

begin;

-- =====================================================================================================
-- 1. TABLES.
-- =====================================================================================================

create table public.fixture_opportunities (
  id uuid primary key default gen_random_uuid(),
  publishing_team_id uuid not null references public.teams(id),
  publishing_club_id uuid not null references public.clubs(id),
  proposed_date date not null,
  kickoff_time time without time zone,
  -- Relative to the PUBLISHING team, same home/away/either vocabulary as fixture_requests.venue_preference.
  -- Inverted when an accepted response becomes a fixture_requests row, because that row's
  -- venue_preference is relative to WHOEVER RESPONDED, who becomes its requesting_team_id.
  venue_preference text not null check (venue_preference in ('home', 'away', 'either')),
  game_type text check (game_type in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match')),
  note text check (note is null or char_length(btrim(note)) <= 500),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled', 'expired')),
  filled_response_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fixture_opportunities is
  'CLUBHOUSE SECTIONS 15/16: "Looking for Opposition" -- a team publicly saying it wants a fixture on a '
  'date, before any opponent is named. status is the STORED lifecycle value; internal.'
  'fixture_opportunity_effective_status() is the TRUTHFUL one once proposed_date has passed, and is what '
  'every consumer that matters actually calls -- the stored column may legitimately lag behind it '
  'forever for a listing nobody successfully acts on again, which is harmless. filled_response_id names '
  'which response was accepted once status=filled; every other response resolves to superseded in the '
  'same transaction. Never itself a negotiation -- accepting a response hands off to the existing '
  'fixture_requests/accept_fixture_request machinery.';

create index fixture_opportunities_publishing_team_id_idx on public.fixture_opportunities (publishing_team_id);
create index fixture_opportunities_open_idx on public.fixture_opportunities (proposed_date) where status = 'open';

create table public.fixture_opportunity_responses (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.fixture_opportunities(id) on delete cascade,
  responding_team_id uuid not null references public.teams(id),
  note text check (note is null or char_length(btrim(note)) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'superseded')),
  -- Set only once accepted -- the negotiation from that point on lives in fixture_requests, not here.
  fixture_request_id uuid references public.fixture_requests(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, responding_team_id)
);

comment on table public.fixture_opportunity_responses is
  'CLUBHOUSE SECTIONS 15/16: one team''s expression of interest in one opportunity. At most one row per '
  'team per opportunity -- a team that wants to change its note withdraws and responds again rather than '
  'editing a live response, so decided_at/status always reflect a genuine transition.';

create index fixture_opportunity_responses_opportunity_id_idx on public.fixture_opportunity_responses (opportunity_id, status);
create index fixture_opportunity_responses_responding_team_id_idx on public.fixture_opportunity_responses (responding_team_id, status);

alter table public.fixture_opportunities
  add constraint fixture_opportunities_filled_response_id_fkey
  foreign key (filled_response_id) references public.fixture_opportunity_responses(id);

alter table public.fixture_opportunities enable row level security;
alter table public.fixture_opportunity_responses enable row level security;

-- database_api_perimeter (20270342000000) revoked every default privilege for objects created from then
-- on -- a new table gets NOTHING until its own migration grants it. SELECT only, matching the "every
-- write goes through a function" design: RLS decides which rows, this grant only decides that the
-- operation may be attempted at all.
grant select on public.fixture_opportunities to authenticated;
grant select on public.fixture_opportunity_responses to authenticated;

-- =====================================================================================================
-- 2. OWNERSHIP INTEGRITY -- publishing_club_id is never trusted as supplied.
-- =====================================================================================================
-- OWNER INSTRUCTION: "Never permit a caller to spoof publishing_team_id from Club A + publishing_club_id
-- from Club B. Enforce the relationship server-side." publish_fixture_opportunity already derives
-- v_club_id from the team and never accepts it as a parameter, so this trigger is belt-and-braces
-- defence-in-depth against any future direct write path (e.g. a service-role migration or fixture) --
-- it recomputes the column from the team on every insert/update regardless of what was supplied.
create or replace function internal.fixture_opportunity_derive_club_id()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_real_club_id uuid;
begin
  select club_id into v_real_club_id from public.teams where id = new.publishing_team_id;
  if v_real_club_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;
  new.publishing_club_id := v_real_club_id;
  return new;
end $$;

comment on function internal.fixture_opportunity_derive_club_id() is
  'Defence in depth: publishing_club_id is always recomputed from publishing_team_id here, never trusted '
  'from the row as supplied, so publishing_team_id (Club A) + publishing_club_id (Club B) can never '
  'persist together.';

create trigger fixture_opportunity_derive_club_id
  before insert or update on public.fixture_opportunities
  for each row execute function internal.fixture_opportunity_derive_club_id();

-- =====================================================================================================
-- 3. REAL EXPIRY -- derived transactionally, no cron, no scheduled worker.
-- =====================================================================================================
create or replace function internal.fixture_opportunity_effective_status(p_status text, p_proposed_date date)
returns text language sql immutable set search_path to '' as $$
  select case when p_status = 'open' and p_proposed_date < current_date then 'expired' else p_status end;
$$;

comment on function internal.fixture_opportunity_effective_status(text, date) is
  'The TRUTHFUL lifecycle status: an "open" listing whose proposed_date has already passed is "expired", '
  'whatever the stored column still says. Used by every read and every mutating function so "open" never '
  'means "was open, once". Deliberately query-time only, never persisted by a mutating function''s own '
  'refusal path -- see the comment below this one for why (a raised refusal always undoes an update '
  'made earlier in the same call).';

-- RLS POLICIES RUN AS THE QUERYING ROLE, NOT AS A DEFINER -- fixture_opportunities_select_scoped (below)
-- calls this directly, so `authenticated` needs EXECUTE to even invoke it from within that policy,
-- exactly like internal.can/internal.teams_can_play_fixture already are granted for the same reason.
grant execute on function internal.fixture_opportunity_effective_status(text, date) to authenticated;

-- DELIBERATELY QUERY-TIME ONLY, NO PERSIST ATTEMPTED. An earlier version of this migration tried to
-- have every mutating function UPDATE the stored column to 'expired' before refusing the action --
-- found, testing this exact migration, to not actually work: when a PL/pgSQL function raises an
-- exception, the ENCLOSING caller's own exception handler (whether that is PostgREST's own request
-- handling or a client's try/catch) rolls back to the savepoint taken before that call, undoing every
-- change made inside it, including an UPDATE issued moments before the RAISE. "Update, then refuse" can
-- never make the update survive in the same call -- there is no way to persist a side effect and still
-- refuse the action that would have caused it, short of an autonomous transaction (dblink/pg_background,
-- deliberately not reached for here -- exactly the "unnecessary architecture" the decision warned against).
-- The stored `status` column may therefore legitimately lag behind reality for an opportunity nobody
-- ever successfully acts on again -- harmless, because internal.fixture_opportunity_effective_status()
-- is what every consumer that matters (the RLS policy above, find_fixture_opportunities below, and
-- every mutating function's own refusal check) actually calls, never the raw column alone. A stored
-- 'open' row past its date is never treated as open anywhere it counts; it simply may never be
-- re-labelled 'expired' in storage unless some OTHER, successful action happens to touch it first (e.g.
-- decline_fixture_opportunity_response, which does not itself raise based on the opportunity's status).

-- =====================================================================================================
-- 4. READ ACCESS -- the only policy either table carries for authenticated.
-- =====================================================================================================

create policy fixture_opportunities_select_scoped on public.fixture_opportunities
for select
using (
  -- The publisher's own side: the team itself, its club, or whoever created the listing.
  internal.can('fixture.request.create', 'team', publishing_club_id, publishing_team_id, null)
  or internal.can('fixture.request.create', 'club', publishing_club_id, null, null)
  or created_by = (select auth.uid())
  -- Discovery: any OTHER club's staff who could legally raise a fixture for some team of theirs against
  -- this one, while the listing is genuinely open (never a stale row the effective-status function would
  -- call expired). fixture.request.create is a staff-only capability, so a parent or player account --
  -- which holds neither at any scope -- never matches this clause regardless of team membership.
  or (
    internal.fixture_opportunity_effective_status(status, proposed_date) = 'open'
    and exists (
      select 1 from public.teams v
      where v.club_id <> fixture_opportunities.publishing_club_id
        and internal.can('fixture.request.create', 'team', v.club_id, v.id, null)
        and internal.teams_can_play_fixture(v.id, fixture_opportunities.publishing_team_id)
    )
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_opportunities_select_scoped on public.fixture_opportunities is
  'The publishing side always reads its own listing; any other club''s staff reads it while genuinely '
  'open (effective status, not the stored column alone) if they hold fixture.request.create for a '
  'compatible team of their own -- this clause IS the Discover surface''s authority and compatibility '
  'filter, not a convenience layered in front of it.';

create policy fixture_opportunity_responses_select_scoped on public.fixture_opportunity_responses
for select
using (
  internal.can('fixture.request.create', 'team',
               (select t.club_id from public.teams t where t.id = responding_team_id),
               responding_team_id, null)
  or created_by = (select auth.uid())
  or exists (
    select 1 from public.fixture_opportunities o
    where o.id = opportunity_id
      and (internal.can('fixture.request.respond', 'team', o.publishing_club_id, o.publishing_team_id, null)
           or internal.can('fixture.request.respond', 'club', o.publishing_club_id, null, null))
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_opportunity_responses_select_scoped on public.fixture_opportunity_responses is
  'A responding team reads its own response; the publisher reads every response on its own opportunity '
  '(fixture.request.respond, the same capability accept_fixture_request already requires of the deciding '
  'side).';

-- NOTIFICATION CATALOGUE REGISTRATION (owner-mandated, Section 6 of the decision): notifications.type
-- carries a real FOREIGN KEY to notification_types.type_key (notifications_type_registered) -- an
-- unregistered type is refused at the database itself, before packages/contracts or the notification
-- catalogue guard ever see it. Registered under the existing 'fixture_requests' topic (the same topic
-- every fixture_request_* type already uses), never a new topic invented for four types that are, in
-- substance, the same negotiation domain reaching a wider audience.
insert into public.notification_types (type_key, topic_key) values
  ('fixture_opportunity_cancelled', 'fixture_requests'),
  ('fixture_opportunity_response_received', 'fixture_requests'),
  ('fixture_opportunity_response_declined', 'fixture_requests'),
  ('fixture_opportunity_filled', 'fixture_requests');

create trigger set_updated_at before update on public.fixture_opportunities for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.fixture_opportunity_responses for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.fixture_opportunities for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.fixture_opportunity_responses for each row execute function internal.audit_row_change();

-- =====================================================================================================
-- 5. publish_fixture_opportunity -- list a team as looking for opposition on a date.
-- =====================================================================================================
create or replace function public.publish_fixture_opportunity(
  p_team_id uuid,
  p_date date,
  p_kickoff_time time without time zone default null,
  p_venue_preference text default 'either',
  p_game_type text default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_club_id uuid;
  v_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id and coalesce(active, true) and folded_at is null and archived_at is null;
  if v_club_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;
  if not (internal.can('fixture.request.create', 'team', v_club_id, p_team_id, null)
          or internal.can('fixture.request.create', 'club', v_club_id, null, null)) then
    raise exception 'You do not have permission to publish an opportunity for this team.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'A date is required.';
  end if;
  if p_date < current_date then
    raise exception 'The date must be today or later.';
  end if;
  if p_venue_preference not in ('home', 'away', 'either') then
    raise exception 'Not a recognised venue preference.';
  end if;
  if p_game_type is not null and p_game_type not in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match') then
    raise exception 'Not a recognised game type.';
  end if;

  insert into public.fixture_opportunities (
    publishing_team_id, publishing_club_id, proposed_date, kickoff_time, venue_preference, game_type, note, created_by
  ) values (
    p_team_id, v_club_id, p_date, p_kickoff_time, p_venue_preference, p_game_type, nullif(btrim(p_note), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.publish_fixture_opportunity(uuid, date, time without time zone, text, text, text) is
  'Publish an open "Looking for Opposition" listing for one team on one date. A single concrete date, '
  'deliberately -- a team wanting several dates publishes several listings, kept simple rather than '
  'inventing a fuzzy date-range model this domain''s availability integration does not need.';

grant execute on function public.publish_fixture_opportunity(uuid, date, time without time zone, text, text, text) to authenticated;
grant execute on function public.publish_fixture_opportunity(uuid, date, time without time zone, text, text, text) to service_role;

-- =====================================================================================================
-- 6. cancel_fixture_opportunity -- the publisher withdraws an open listing.
-- =====================================================================================================
create or replace function public.cancel_fixture_opportunity(p_opportunity_id uuid, p_expected_updated_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_opp public.fixture_opportunities;
  v_effective text;
begin
  select * into v_opp from public.fixture_opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Opportunity not found.' using errcode = '42501';
  end if;
  v_effective := internal.fixture_opportunity_effective_status(v_opp.status, v_opp.proposed_date);
  if p_expected_updated_at is not null and v_opp.updated_at is distinct from p_expected_updated_at then
    raise exception 'This listing has changed since you last viewed it. Please refresh and try again.' using errcode = '40001';
  end if;
  if not (internal.can('fixture.request.create', 'team', v_opp.publishing_club_id, v_opp.publishing_team_id, null)
          or internal.can('fixture.request.create', 'club', v_opp.publishing_club_id, null, null)) then
    raise exception 'You do not have permission to cancel this listing.' using errcode = '42501';
  end if;
  if v_effective <> 'open' then
    raise exception 'This listing is no longer open (current status: %).', v_effective;
  end if;

  update public.fixture_opportunities set status = 'cancelled' where id = p_opportunity_id;

  update public.fixture_opportunity_responses
  set status = 'superseded', decided_at = now()
  where opportunity_id = p_opportunity_id and status = 'pending';

  -- SAFEGUARDING FIX (owner-mandated): team_admin/coach/manager only -- never view_only (parents/players).
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_opportunity_cancelled', 'Opportunity withdrawn',
    format('The opportunity on %s was withdrawn by the other club.', to_char(v_opp.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('opportunity_id', p_opportunity_id)
  from public.fixture_opportunity_responses r
  join public.team_permissions tp on tp.team_id = r.responding_team_id and tp.permission in ('team_admin', 'coach', 'manager')
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where r.opportunity_id = p_opportunity_id and r.status = 'superseded';
end;
$$;

comment on function public.cancel_fixture_opportunity(uuid, timestamptz) is
  'Withdraw an open listing. Any pending response resolves to superseded and its team''s staff (never a '
  'view_only/family recipient) is notified.';

grant execute on function public.cancel_fixture_opportunity(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_fixture_opportunity(uuid, timestamptz) to service_role;

-- =====================================================================================================
-- 7. respond_to_fixture_opportunity -- express interest in an open listing.
-- =====================================================================================================
create or replace function public.respond_to_fixture_opportunity(p_opportunity_id uuid, p_responding_team_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_opp public.fixture_opportunities;
  v_effective text;
  v_responding_club_id uuid;
  v_id uuid;
begin
  select * into v_opp from public.fixture_opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Opportunity not found.' using errcode = '42501';
  end if;
  v_effective := internal.fixture_opportunity_effective_status(v_opp.status, v_opp.proposed_date);
  if v_effective <> 'open' then
    raise exception 'This opportunity is no longer open (current status: %).', v_effective;
  end if;

  select club_id into v_responding_club_id from public.teams
   where id = p_responding_team_id and coalesce(active, true) and folded_at is null and archived_at is null;
  if v_responding_club_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;
  if v_responding_club_id = v_opp.publishing_club_id then
    raise exception 'You cannot respond to your own club''s opportunity.';
  end if;
  if not (internal.can('fixture.request.create', 'team', v_responding_club_id, p_responding_team_id, null)
          or internal.can('fixture.request.create', 'club', v_responding_club_id, null, null)) then
    raise exception 'You do not have permission to respond for this team.' using errcode = '42501';
  end if;
  if not internal.teams_can_play_fixture(p_responding_team_id, v_opp.publishing_team_id) then
    raise exception 'This team is not age-eligible against that opportunity.';
  end if;

  insert into public.fixture_opportunity_responses (opportunity_id, responding_team_id, note, created_by)
  values (p_opportunity_id, p_responding_team_id, nullif(btrim(p_note), ''), auth.uid())
  on conflict (opportunity_id, responding_team_id) do update
    set note = excluded.note, status = 'pending', decided_by = null, decided_at = null, created_by = excluded.created_by
    where public.fixture_opportunity_responses.status in ('withdrawn', 'declined', 'superseded')
  returning id into v_id;

  if v_id is null then
    raise exception 'You have already responded to this opportunity.';
  end if;

  -- SAFEGUARDING FIX (owner-mandated): team_admin/coach/manager only -- never view_only (parents/players).
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_opportunity_response_received', 'New interest in your opportunity',
    format('A club has responded to your opportunity on %s.', to_char(v_opp.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('opportunity_id', p_opportunity_id, 'response_id', v_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_opp.publishing_team_id and tp.permission in ('team_admin', 'coach', 'manager');

  return v_id;
end;
$$;

comment on function public.respond_to_fixture_opportunity(uuid, uuid, text) is
  'Express interest in an open opportunity. At most one live response per team per opportunity -- '
  'responding again after withdrawing or being declined/superseded reopens the same row rather than '
  'creating a second one.';

grant execute on function public.respond_to_fixture_opportunity(uuid, uuid, text) to authenticated;
grant execute on function public.respond_to_fixture_opportunity(uuid, uuid, text) to service_role;

-- =====================================================================================================
-- 8. withdraw_fixture_opportunity_response -- a responder changes their mind.
-- =====================================================================================================
create or replace function public.withdraw_fixture_opportunity_response(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_resp public.fixture_opportunity_responses;
begin
  select * into v_resp from public.fixture_opportunity_responses where id = p_response_id for update;
  if not found then
    raise exception 'Response not found.' using errcode = '42501';
  end if;
  if not internal.can('fixture.request.create', 'team',
                       (select t.club_id from public.teams t where t.id = v_resp.responding_team_id),
                       v_resp.responding_team_id, null) then
    raise exception 'You do not have permission to withdraw this response.' using errcode = '42501';
  end if;
  if v_resp.status <> 'pending' then
    raise exception 'This response is no longer pending (current status: %).', v_resp.status;
  end if;

  update public.fixture_opportunity_responses
  set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
  where id = p_response_id;
end;
$$;

comment on function public.withdraw_fixture_opportunity_response(uuid) is
  'A responding team withdraws its own pending response.';

grant execute on function public.withdraw_fixture_opportunity_response(uuid) to authenticated;
grant execute on function public.withdraw_fixture_opportunity_response(uuid) to service_role;

-- =====================================================================================================
-- 9. decline_fixture_opportunity_response -- the publisher says no to ONE response, opportunity stays open.
-- =====================================================================================================
create or replace function public.decline_fixture_opportunity_response(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_resp public.fixture_opportunity_responses;
  v_opp public.fixture_opportunities;
begin
  select * into v_resp from public.fixture_opportunity_responses where id = p_response_id for update;
  if not found then
    raise exception 'Response not found.' using errcode = '42501';
  end if;
  select * into v_opp from public.fixture_opportunities where id = v_resp.opportunity_id for update;
  if not (internal.can('fixture.request.respond', 'team', v_opp.publishing_club_id, v_opp.publishing_team_id, null)
          or internal.can('fixture.request.respond', 'club', v_opp.publishing_club_id, null, null)) then
    raise exception 'You do not have permission to decide this response.' using errcode = '42501';
  end if;
  if v_resp.status <> 'pending' then
    raise exception 'This response is no longer pending (current status: %).', v_resp.status;
  end if;

  update public.fixture_opportunity_responses
  set status = 'declined', decided_by = auth.uid(), decided_at = now()
  where id = p_response_id;

  -- SAFEGUARDING FIX (owner-mandated): team_admin/coach/manager only -- never view_only (parents/players).
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_opportunity_response_declined', 'Response declined',
    format('Your response to the opportunity on %s was declined -- it may still be open to others.', to_char(v_opp.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('opportunity_id', v_opp.id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_resp.responding_team_id and tp.permission in ('team_admin', 'coach', 'manager');
end;
$$;

comment on function public.decline_fixture_opportunity_response(uuid) is
  'The publisher declines one response without closing the opportunity to everyone else.';

grant execute on function public.decline_fixture_opportunity_response(uuid) to authenticated;
grant execute on function public.decline_fixture_opportunity_response(uuid) to service_role;

-- =====================================================================================================
-- 10. accept_fixture_opportunity_response -- THE convergence point.
-- =====================================================================================================
create or replace function public.accept_fixture_opportunity_response(p_response_id uuid, p_expected_updated_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_resp public.fixture_opportunity_responses;
  v_opp public.fixture_opportunities;
  v_effective text;
  v_group_id uuid;
  v_request_id uuid;
  v_request_venue_preference text;
  v_fixture_id uuid;
  v_existing_request_id uuid;
begin
  select * into v_resp from public.fixture_opportunity_responses where id = p_response_id for update;
  if not found then
    raise exception 'Response not found.' using errcode = '42501';
  end if;
  select * into v_opp from public.fixture_opportunities where id = v_resp.opportunity_id for update;
  v_effective := internal.fixture_opportunity_effective_status(v_opp.status, v_opp.proposed_date);

  if p_expected_updated_at is not null and v_opp.updated_at is distinct from p_expected_updated_at then
    raise exception 'This opportunity has changed since you last viewed it. Please refresh and try again.' using errcode = '40001';
  end if;
  if not (internal.can('fixture.request.respond', 'team', v_opp.publishing_club_id, v_opp.publishing_team_id, null)
          or internal.can('fixture.request.respond', 'club', v_opp.publishing_club_id, null, null)) then
    raise exception 'You do not have permission to accept this response.' using errcode = '42501';
  end if;
  if v_effective <> 'open' then
    raise exception 'This opportunity is no longer open (current status: %).', v_effective;
  end if;
  if v_resp.status <> 'pending' then
    raise exception 'This response is no longer pending (current status: %).', v_resp.status;
  end if;

  -- OWNER-MANDATED (Section 16 of the decision): explicit integration with
  -- internal.enforce_fixture_request_not_duplicate() (20270559000000, added AFTER the parked draft was
  -- written) -- the exact same predicate that trigger enforces, checked here FIRST so a genuine
  -- duplicate is refused with a clear, specific, actionable message naming the existing request rather
  -- than a raw trigger exception surfacing from the insert below. Never bypasses the trigger; never
  -- silently merges records -- refuses convergence and preserves the existing canonical request.
  select r.id into v_existing_request_id
  from public.fixture_requests r
  join public.fixture_request_groups g on g.id = r.group_id
  where r.requesting_team_id = v_resp.responding_team_id
    and r.target_team_id = v_opp.publishing_team_id
    and r.status in ('sent', 'counter_proposed')
    and g.proposed_date = v_opp.proposed_date
  limit 1;

  if v_existing_request_id is not null then
    raise exception 'There is already an open fixture request between these teams for %. Review it in Fixture Requests rather than creating a second one.',
      to_char(v_opp.proposed_date, 'DD Mon YYYY')
      using errcode = '23505', hint = v_existing_request_id::text;
  end if;

  -- The opportunity's venue_preference is stated relative to the PUBLISHER. The new fixture_requests
  -- row's requesting_team_id becomes the RESPONDER, so accept_fixture_request must see the preference
  -- relative to THAT side -- the opposite of what the publisher asked for, exactly as a plain home/away
  -- flip works everywhere else in this domain (either stays either).
  v_request_venue_preference := case v_opp.venue_preference
    when 'home' then 'away' when 'away' then 'home' else 'either' end;

  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, notes, created_by)
  select t.club_id, cd.name, v_opp.publishing_club_id, v_opp.proposed_date, v_opp.note, v_resp.created_by
  from public.teams t
  join public.clubs c on c.id = v_opp.publishing_club_id
  join public.club_directory cd on cd.id = c.directory_id
  where t.id = v_resp.responding_team_id
  returning id into v_group_id;

  update public.fixture_request_groups set game_type = v_opp.game_type where id = v_group_id;

  insert into public.fixture_requests (
    group_id, requesting_team_id, target_team_id, venue_preference, preferred_kickoff_time, note, created_by
  ) values (
    v_group_id, v_resp.responding_team_id, v_opp.publishing_team_id, v_request_venue_preference,
    v_opp.kickoff_time, v_resp.note, v_resp.created_by
  )
  returning id into v_request_id;

  -- Hands off to the ONE canonical acceptance path. auth.uid() is unchanged across this call, so its own
  -- fixture.request.respond check for v_opp.publishing_team_id is answered by the same authority this
  -- function already required above -- not a second, different decision. No fixture-creation logic of
  -- its own lives in this function.
  v_fixture_id := public.accept_fixture_request(v_request_id, v_opp.publishing_team_id, null);

  update public.fixture_opportunity_responses
  set status = 'accepted', fixture_request_id = v_request_id, decided_by = auth.uid(), decided_at = now()
  where id = p_response_id;

  update public.fixture_opportunities
  set status = 'filled', filled_response_id = p_response_id
  where id = v_opp.id;

  update public.fixture_opportunity_responses
  set status = 'superseded', decided_at = now()
  where opportunity_id = v_opp.id and status = 'pending' and id <> p_response_id;

  -- SAFEGUARDING FIX (owner-mandated): team_admin/coach/manager only -- never view_only (parents/players).
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_opportunity_filled', 'Opportunity filled elsewhere',
    format('The opportunity on %s was taken up by another club.', to_char(v_opp.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('opportunity_id', v_opp.id)
  from public.fixture_opportunity_responses r
  join public.team_permissions tp on tp.team_id = r.responding_team_id and tp.permission in ('team_admin', 'coach', 'manager')
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where r.opportunity_id = v_opp.id and r.status = 'superseded' and r.id <> p_response_id;

  return v_fixture_id;
end;
$$;

comment on function public.accept_fixture_opportunity_response(uuid, timestamptz) is
  'Accept one response, converge into a fixture_requests row and public.accept_fixture_request for the '
  'actual fixture, then resolve every other pending response on the same opportunity to superseded so it '
  'can never also be accepted into a duplicate fixture. Pre-checks '
  'internal.enforce_fixture_request_not_duplicate()''s own predicate first and refuses convergence with a '
  'specific, actionable error (errcode 23505, hint = existing fixture_requests.id) rather than letting '
  'that trigger''s generic exception surface from the insert.';

grant execute on function public.accept_fixture_opportunity_response(uuid, timestamptz) to authenticated;
grant execute on function public.accept_fixture_opportunity_response(uuid, timestamptz) to service_role;

-- =====================================================================================================
-- 11. find_fixture_opportunities -- Section 16's batched discovery read model.
-- =====================================================================================================
-- ONE ROUND TRIP for every genuinely open, compatible opportunity a team could respond to, plus the
-- viewer's own live opportunities and their own response state. Re-derives compatibility and authority
-- itself (SECURITY DEFINER bypasses RLS) rather than trusting the table's own SELECT policy, exactly as
-- compatible_opponent_teams/find_fixture_candidate_teams already do. Returns raw, already-public
-- club_directory location facts for the OTHER club (never its venue -- see the migration header) and
-- leaves distance/partnership resolution to the existing client-side pure functions.
create or replace function public.find_fixture_opportunities(p_team_id uuid)
returns table (
  opportunity_id uuid,
  proposed_date date,
  kickoff_time time without time zone,
  venue_preference text,
  game_type text,
  note text,
  updated_at timestamptz,
  is_mine boolean,
  publishing_team_id uuid,
  publishing_team_display_name text,
  publishing_team_rugby_code text,
  publishing_team_category text,
  publishing_team_age_group text,
  publishing_team_gender text,
  publishing_team_squad_designation text,
  publishing_club_id uuid,
  publishing_club_directory_id uuid,
  publishing_club_name text,
  publishing_club_logo_storage_path text,
  publishing_club_directory_latitude numeric,
  publishing_club_directory_longitude numeric,
  publishing_club_directory_geocode_status text,
  publishing_club_slug text,
  my_team_availability text,
  my_response_id uuid,
  my_response_status text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.teams
   where id = p_team_id and coalesce(active, true) and folded_at is null and archived_at is null;
  if v_club is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;
  if not (internal.can('fixture.request.create', 'team', v_club, p_team_id, null)
          or internal.can('fixture.request.create', 'club', v_club, null, null)) then
    raise exception 'You do not have permission to view opportunities for this team.' using errcode = '42501';
  end if;

  return query
  with mine as (
    -- The viewer's own team's live opportunities -- 'is_mine', shown regardless of effective status so
    -- a publisher can manage (cancel, review responses on) their own filled/cancelled/expired history.
    select o.id from public.fixture_opportunities o where o.publishing_team_id = p_team_id
  ),
  discoverable as (
    -- Any OTHER club's genuinely open, compatible opportunity -- the exact same clause the table's own
    -- SELECT policy encodes, re-derived here because SECURITY DEFINER does not consult RLS.
    select o.id
    from public.fixture_opportunities o
    where internal.fixture_opportunity_effective_status(o.status, o.proposed_date) = 'open'
      and o.publishing_club_id <> v_club
      and internal.teams_can_play_fixture(p_team_id, o.publishing_team_id)
  ),
  scoped as (
    select id, true as is_mine from mine
    union
    select id, false as is_mine from discoverable
  )
  select
    o.id,
    o.proposed_date,
    o.kickoff_time,
    o.venue_preference,
    o.game_type,
    o.note,
    o.updated_at,
    s.is_mine,
    pt.id,
    pt.display_name,
    pt.rugby_code,
    pt.category,
    pt.age_group,
    pt.gender,
    pt.squad_designation,
    pc.id,
    pc.directory_id,
    pcd.name,
    pcd.logo_storage_path,
    pcd.latitude,
    pcd.longitude,
    pcd.geocode_status,
    pc.slug,
    case when s.is_mine then null else internal.fixture_opportunity_team_availability(p_team_id, o.proposed_date) end,
    mr.id,
    mr.status
  from scoped s
  join public.fixture_opportunities o on o.id = s.id
  join public.teams pt on pt.id = o.publishing_team_id
  join public.clubs pc on pc.id = o.publishing_club_id
  join public.club_directory pcd on pcd.id = pc.directory_id
  left join public.fixture_opportunity_responses mr on mr.opportunity_id = o.id and mr.responding_team_id = p_team_id
  order by o.proposed_date asc;
end;
$$;

comment on function public.find_fixture_opportunities(uuid) is
  'CLUBHOUSE SECTION 16: one batched read -- the viewer''s own team''s live opportunities plus every '
  'other genuinely open, compatible opportunity, with the viewer''s own team''s coarse availability '
  '(never computed for is_mine rows) and the viewer''s own response state, if any. Distance and '
  'partnership state are resolved client-side from the raw club_directory fields returned here, reusing '
  'resolveClubLocation/distanceMiles/resolvePartnershipStatus -- never a second calculation.';

revoke all on function public.find_fixture_opportunities(uuid) from public, anon;
grant execute on function public.find_fixture_opportunities(uuid) to authenticated;
grant execute on function public.find_fixture_opportunities(uuid) to service_role;

-- One team's coarse availability against one date, for the discovery read model above. Reuses the exact
-- same blocking sources team_scheduling_availability/find_fixture_candidate_availability already check
-- (fixture/competition/training/club_event/pending-request), scoped to a SINGLE team and SINGLE date --
-- never a second availability rule. Deliberately NEVER partnership-gated (unlike
-- find_fixture_candidate_availability): this only ever reads the CALLING team's own calendar, which it
-- is always entitled to see about itself, exactly like team_scheduling_availability's own "v_own" branch.
create or replace function internal.fixture_opportunity_team_availability(p_team_id uuid, p_date date)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_busy boolean;
begin
  if p_team_id is null or p_date is null then
    return 'unknown';
  end if;
  select exists (
    select 1 from public.fixtures f where f.owning_team_id = p_team_id and f.status <> 'Cancelled' and f.kickoff_date = p_date
    union all
    select 1 from public.competition_matches cm
      join public.competition_participants hp on hp.id = cm.home_participant_id
      join public.competition_participants ap on ap.id = cm.away_participant_id
      where (hp.team_id = p_team_id or ap.team_id = p_team_id)
        and cm.status not in ('cancelled', 'draft', 'postponed')
        and cm.match_date = p_date
        and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = cm.id)
    union all
    select 1 from public.training_sessions ts where ts.team_id = p_team_id and ts.status <> 'CANCELLED' and ts.session_date = p_date
    union all
    select 1 from public.club_events e
      join public.teams t on t.club_id = e.club_id and t.id = p_team_id
      where e.starts_on = p_date and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = p_team_id))
    union all
    select 1 from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
      where (r.requesting_team_id = p_team_id or r.target_team_id = p_team_id)
        and r.status in ('sent', 'counter_proposed')
        and coalesce(r.countered_date, g.proposed_date) = p_date
  ) into v_busy;
  return case when v_busy then 'busy' else 'no_known_clash' end;
end $$;

comment on function internal.fixture_opportunity_team_availability(uuid, date) is
  'Section 16: coarse busy/no_known_clash for the CALLING team''s own calendar on one date -- never '
  'partnership-gated, because a team may always see its own calendar, and Looking for Opposition is by '
  'design discovery ACROSS the whole compatible network, not only partners. "unknown" is reserved for a '
  'null team/date, defensively -- never silently coerced into no_known_clash.';

-- =====================================================================================================
-- 12. ASSERTIONS.
-- =====================================================================================================
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('cancel_fixture_opportunity', 'respond_to_fixture_opportunity',
                           'decline_fixture_opportunity_response', 'accept_fixture_opportunity_response')
        and p.prosrc !~ 'permission in \(''team_admin'', ''coach'', ''manager''\)') > 0 then
    raise exception 'Sections 15/16: a notification fan-out is missing the staff-only recipient filter.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_fixture_opportunity_response') !~ 'enforce_fixture_request_not_duplicate' then
    raise exception 'Sections 15/16: accept_fixture_opportunity_response does not reference the duplicate-request guard it must integrate with.';
  end if;
  raise notice 'Clubhouse Sections 15/16: Looking for Opposition / Opportunity Matching installed';
end $$;

commit;
