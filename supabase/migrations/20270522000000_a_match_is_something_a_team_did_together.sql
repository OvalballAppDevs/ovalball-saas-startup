-- =====================================================================================================
-- CONVERGENCE STEP 11 -- MATCH CENTRE COMMUNITY + REWARDS
--
-- The archaeology (docs/product/CONVERGENCE_STEP_11_ARCHAEOLOGY.md) found the backlog surviving as
-- vocabulary and nothing else: no poll, vote, nomination, Kudos, award or badge record existed
-- anywhere. Two words were already taken and are deliberately not reused -- `reward` belongs to
-- referral credit, which is money, and `nomination` belongs to safeguarding appointments.
--
-- WHAT THIS BUILDS, AND WHY IT IS THIS SHAPE
--
--   * ONE award engine, not five. The backlog's five award names are five ELECTORATES for one
--     concept, so there is one `match_awards` row per (fixture, team, category) and one vote table.
--   * KUDOS STAYS SEPARATE, because its lifecycle genuinely differs: it has no electorate, no
--     opening, no closing and no single winner. Converging it would have been convergence for the
--     sake of a shared button.
--   * THE ELECTORATE FOLLOWS THE SIDE'S AGE. The recognition that is Parents' Player on a youth
--     side is Players' Player on an adult one -- the same canonical category, a different set of
--     people entitled to vote. U17 and U18 sides keep the parents' electorate deliberately: that is
--     exactly where somebody would be tempted to switch, and the product decision was not to.
--   * NO CURRENCY, NO POINTS, NO GRANTED BADGE. A player's recognition history is DERIVED from
--     award results and kudos that already happened. There is no endpoint that grants a badge,
--     because there is nothing to grant.
--   * NOTHING HERE CAN TOUCH THE RUGBY. No function in this migration writes to `fixtures`.
--     Score, winner, status and competition result stay with the workflow that already owns them.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------
-- 1. THE CANONICAL CATALOGUE
--
-- Site-owned. A club does not invent categories, because a category carries an electorate and an
-- electorate is an authority decision. What a club MAY do is switch one on for a team and call it
-- what that club calls it -- see `team_award_category_settings`, which is presentation only.
-- -----------------------------------------------------------------------------------------------
create table if not exists public.match_award_categories (
  category_key   text primary key,
  electorate     text not null check (electorate in ('FAMILY_OR_SELF', 'TEAM_COACHES', 'OPPOSITION_COACHES')),
  -- Two names for one category: the youth form and the adult form. For most categories they are
  -- the same string, and that is fine -- it keeps the age question in one place instead of a
  -- special case at the call site.
  name_youth     text not null,
  name_adult     text not null,
  description    text not null,
  sort_order     int  not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.match_award_categories is
  'The canonical match award catalogue. A category carries its electorate, so it is site-owned: a club '
  'switches one on and may display its own name for it, but never defines who is entitled to vote.';

insert into public.match_award_categories (category_key, electorate, name_youth, name_adult, description, sort_order) values
  ('FAMILY_OR_SELF_PLAYER', 'FAMILY_OR_SELF', 'Parents'' Player', 'Players'' Player',
   'Chosen by the people who were there for the side -- the parents and guardians of a youth side, the players themselves in adult rugby.', 1),
  ('COACHES_PLAYER', 'TEAM_COACHES', 'Coaches'' Player', 'Coaches'' Player',
   'The coaches'' own pick from their side.', 2),
  ('OPPOSITION_PLAYER', 'OPPOSITION_COACHES', 'Opposition Player', 'Opposition Player',
   'Chosen by the other side''s coaches, which is why it only exists when the opposition is on Ovalball.', 3),
  -- THE BEAST, HANDLED CAREFULLY. The backlog asked for a work-ethic award and called it Beast. The
  -- name is rugby culture and it stays for adults; a children's side is offered Work Rate instead,
  -- and a club that calls it something else can say so in its own display override.
  ('WORK_ETHIC', 'TEAM_COACHES', 'Work Rate', 'Beast',
   'Recognition for the shift nobody sees on the scoreboard.', 4)
on conflict (category_key) do nothing;

-- -----------------------------------------------------------------------------------------------
-- 2. PER-TEAM SETTINGS -- A TOGGLE, AND A NAME THAT IS PRESENTATION ONLY
--
-- `display_name_override` never rewrites the canonical category, its key or its electorate, and
-- NOTHING resolves authority from it. It exists because clubs have their own names for the same
-- award, and telling a club its own award is called something else is not the product's job.
-- -----------------------------------------------------------------------------------------------
create table if not exists public.team_award_category_settings (
  team_id               uuid not null references public.teams(id) on delete cascade,
  category_key          text not null references public.match_award_categories(category_key),
  enabled               boolean not null default false,
  display_name_override text check (display_name_override is null or char_length(btrim(display_name_override)) between 1 and 60),
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  primary key (team_id, category_key)
);

comment on column public.team_award_category_settings.display_name_override is
  'Presentation only. The canonical category name and electorate are unchanged; nothing authorises, '
  'filters or resolves off this string.';

-- -----------------------------------------------------------------------------------------------
-- 3. AN AWARD IS A DECISION WITH A LIFECYCLE
-- -----------------------------------------------------------------------------------------------
create table if not exists public.match_awards (
  id               uuid primary key default gen_random_uuid(),
  fixture_id       uuid not null references public.fixtures(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  category_key     text not null references public.match_award_categories(category_key),
  status           text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  outcome          text check (outcome in ('WINNER', 'TIE', 'NO_VOTES')),
  winner_player_id uuid references public.players(id),
  opened_by        uuid not null references auth.users(id),
  opened_at        timestamptz not null default now(),
  closed_by        uuid references auth.users(id),
  closed_at        timestamptz,
  unique (fixture_id, team_id, category_key),
  -- A closed award has said what happened; an open one has not.
  constraint match_awards_outcome_matches_status check (
    (status = 'OPEN'  and outcome is null and winner_player_id is null and closed_at is null)
    or
    (status = 'CLOSED' and outcome is not null and (outcome <> 'WINNER' or winner_player_id is not null))
  )
);

create index if not exists match_awards_fixture_idx on public.match_awards (fixture_id);
create index if not exists match_awards_winner_idx  on public.match_awards (winner_player_id) where winner_player_id is not null;

create table if not exists public.match_award_votes (
  id          uuid primary key default gen_random_uuid(),
  award_id    uuid not null references public.match_awards(id) on delete cascade,
  voter_user_id uuid not null references auth.users(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ONE HUMAN, ONE VOTE, ENFORCED BY THE DATABASE. Not by the browser, not by a check in a server
  -- action: a unique constraint is the only thing a double click, two tabs and a replayed request
  -- all lose to.
  unique (award_id, voter_user_id)
);

create index if not exists match_award_votes_award_idx on public.match_award_votes (award_id);

-- -----------------------------------------------------------------------------------------------
-- 4. KUDOS -- A FIXED, POSITIVE VOCABULARY
--
-- There is no free text anywhere in this table, on purpose. Nothing abusive can be written about a
-- child because there is nowhere to write it, which is a better answer than moderating it after.
-- -----------------------------------------------------------------------------------------------
create table if not exists public.match_kudos_kinds (
  kudos_key  text primary key,
  label      text not null,
  sort_order int  not null,
  active     boolean not null default true
);

insert into public.match_kudos_kinds (kudos_key, label, sort_order) values
  ('WORK_RATE',   'Never stopped working', 1),
  ('TEAM_FIRST',  'Played for the team',   2),
  ('BRAVE',       'Brave defence',         3),
  ('SKILL',       'Great skill',           4),
  ('SUPPORT',     'Backed up a team-mate', 5),
  ('ATTITUDE',    'Great attitude',        6)
on conflict (kudos_key) do nothing;

create table if not exists public.match_kudos (
  id                  uuid primary key default gen_random_uuid(),
  fixture_id          uuid not null references public.fixtures(id) on delete cascade,
  team_id             uuid not null references public.teams(id) on delete cascade,
  recipient_player_id uuid not null references public.players(id) on delete cascade,
  given_by_user_id    uuid not null references auth.users(id) on delete cascade,
  kudos_key           text not null references public.match_kudos_kinds(kudos_key),
  removed_by          uuid references auth.users(id),
  removed_at          timestamptz,
  created_at          timestamptz not null default now(),
  -- One person recognises one player once per match. Changing your mind means changing the kind,
  -- not stacking another one on.
  unique (fixture_id, given_by_user_id, recipient_player_id)
);

create index if not exists match_kudos_fixture_idx   on public.match_kudos (fixture_id) where removed_at is null;
create index if not exists match_kudos_recipient_idx on public.match_kudos (recipient_player_id) where removed_at is null;

-- -----------------------------------------------------------------------------------------------
-- 5. THE WRITE-UP ALREADY HAD A HOME; IT JUST HAD NO MATCH
--
-- `club_articles` has carried a MATCH_REPORT category, a team, a visibility, a publishing workflow
-- and a hero image since the Club Digital Home. What it never had was the fixture the report is
-- about. One nullable column, and no second article model.
-- -----------------------------------------------------------------------------------------------
alter table public.club_articles
  add column if not exists fixture_id uuid references public.fixtures(id) on delete set null;

create index if not exists club_articles_fixture_idx on public.club_articles (fixture_id) where fixture_id is not null;

comment on column public.club_articles.fixture_id is
  'The match this article is about, for MATCH_REPORT articles. Nullable because most articles are not '
  'match reports; the article keeps its own visibility and publishing rules either way.';

alter table public.match_award_categories        enable row level security;
alter table public.team_award_category_settings  enable row level security;
alter table public.match_awards                  enable row level security;
alter table public.match_award_votes             enable row level security;
alter table public.match_kudos_kinds             enable row level security;
alter table public.match_kudos                   enable row level security;

-- Catalogues are reference data: everybody signed in may read them.
drop policy if exists match_award_categories_read on public.match_award_categories;
create policy match_award_categories_read on public.match_award_categories
  for select to authenticated using (internal.session_ok());

drop policy if exists match_kudos_kinds_read on public.match_kudos_kinds;
create policy match_kudos_kinds_read on public.match_kudos_kinds
  for select to authenticated using (internal.session_ok());

-- A team's settings are readable by anyone who may see the team at all.
drop policy if exists team_award_category_settings_read on public.team_award_category_settings;
create policy team_award_category_settings_read on public.team_award_category_settings
  for select to authenticated using (
    internal.session_ok()
    and exists (
      select 1 from public.teams t
      where t.id = team_award_category_settings.team_id
        and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
    )
  );

drop policy if exists match_awards_read on public.match_awards;
create policy match_awards_read on public.match_awards
  for select to authenticated using (
    internal.session_ok()
    and exists (
      select 1 from public.teams t
      where t.id = match_awards.team_id
        and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
    )
  );

drop policy if exists match_kudos_read on public.match_kudos;
create policy match_kudos_read on public.match_kudos
  for select to authenticated using (
    internal.session_ok()
    and removed_at is null
    and exists (
      select 1 from public.teams t
      where t.id = match_kudos.team_id
        and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
    )
  );

-- `match_award_votes` DELIBERATELY HAS NO SELECT POLICY.
--
-- The ballot is secret to participants and known to the server. Eligibility and one-vote-per-person
-- are enforced against the real voter id, and an administrator can be held to an audit trail -- but
-- no browser session reads who voted for whom, including the staff who see the totals. Hiding the
-- column in React would have been the other way round, and the wrong way round.

-- =====================================================================================================
-- 6. WHO MAY DO WHAT -- all server-derived, none of it inferred from a badge
-- =====================================================================================================

-- An adult side is an open-age side. Colts and every youth age grade -- U17 and U18 included, on
-- purpose -- keep the family electorate.
create or replace function internal.match_side_is_adult(p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select t.category = 'senior' from public.teams t where t.id = p_team_id), false);
$$;

create or replace function internal.match_other_side(p_fixture_id uuid, p_team_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select case
           when f.owning_team_id = p_team_id then f.opponent_team_id
           when f.opponent_team_id = p_team_id then f.owning_team_id
           else null
         end
    from public.fixtures f where f.id = p_fixture_id;
$$;

-- A COACH IS A COACH. Step 11 does not promote a Team Manager into one: the canonical role
-- assignment says who coaches this team, and a revoked assignment or a suspended membership is not
-- a coach any more.
create or replace function internal.is_active_team_coach(p_team_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
      from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id
     where ra.team_id = p_team_id
       and ra.role_key = 'COACH'
       and ra.state = 'ACTIVE'
       and cm.state = 'ACTIVE'
       and cm.user_id = p_user
  );
$$;

-- The people a side may give its award to: the side's own active roster.
create or replace function internal.match_award_candidates(p_team_id uuid)
returns table(player_id uuid) language sql stable security definer set search_path to 'public' as $$
  select ptm.player_id
    from public.player_team_memberships ptm
   where ptm.team_id = p_team_id and ptm.state = 'ACTIVE';
$$;

create or replace function internal.can_administer_match_community(p_fixture_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- The SAME authority Match Centre already calls `can_manage_fixture`. No new capability is
  -- invented here, and no dangling one is activated -- see the report on `team.community.manage`.
  select exists (
    select 1 from public.fixtures f
     where f.id = p_fixture_id
       and ((f.owning_team_id   = p_team_id and internal.can_manage_fixture_side(f.owning_team_id,   f.owning_scheduling_group_id))
         or (f.opponent_team_id = p_team_id and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)))
  );
$$;

create or replace function internal.match_award_can_vote(p_award_id uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_team uuid; v_fixture uuid; v_electorate text; v_other uuid;
begin
  select a.team_id, a.fixture_id, c.electorate
    into v_team, v_fixture, v_electorate
    from public.match_awards a
    join public.match_award_categories c on c.category_key = a.category_key
   where a.id = p_award_id;

  if v_team is null or p_user is null then
    return false;
  end if;

  if v_electorate = 'FAMILY_OR_SELF' then
    if internal.match_side_is_adult(v_team) then
      -- Adult rugby: the players themselves.
      return exists (
        select 1 from public.players p
          join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.team_id = v_team and ptm.state = 'ACTIVE'
         where p.user_id = p_user
      );
    end if;
    -- Youth rugby: the guardians of the side's players. A child is not canvassed for votes.
    return exists (
      select 1 from public.guardians g
        join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.team_id = v_team and ptm.state = 'ACTIVE'
       where g.guardian_user_id = p_user and g.status = 'active'
    );
  end if;

  if v_electorate = 'TEAM_COACHES' then
    return internal.is_active_team_coach(v_team, p_user);
  end if;

  if v_electorate = 'OPPOSITION_COACHES' then
    v_other := internal.match_other_side(v_fixture, v_team);
    -- No opposition team on Ovalball means no opposition actor. Knowing the fixture's address is
    -- not authority, so this simply has nobody entitled to vote.
    if v_other is null then
      return false;
    end if;
    return internal.is_active_team_coach(v_other, p_user);
  end if;

  return false;
end;
$$;

-- The name a team sees for a category: its own override if it set one, otherwise the canonical
-- name for that side's age. The override is a string on the way out and nothing else.
create or replace function internal.match_award_display_name(p_category_key text, p_team_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
           (select nullif(btrim(s.display_name_override), '')
              from public.team_award_category_settings s
             where s.team_id = p_team_id and s.category_key = p_category_key),
           case when internal.match_side_is_adult(p_team_id) then c.name_adult else c.name_youth end
         )
    from public.match_award_categories c
   where c.category_key = p_category_key;
$$;

create or replace function internal.match_can_give_kudos(p_team_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
      select 1 from public.players p
        join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'
       where p.user_id = p_user)
      or exists (
      select 1 from public.guardians g
        join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'
       where g.guardian_user_id = p_user and g.status = 'active')
      or exists (
      select 1 from public.role_assignments ra
        join public.club_memberships cm on cm.id = ra.membership_id
       where ra.team_id = p_team_id and ra.state = 'ACTIVE' and cm.state = 'ACTIVE' and cm.user_id = p_user);
$$;

-- =====================================================================================================
-- 7. THE BROWSER-FACING SURFACE
--
-- Every mutation below opens with the canonical session gate, because Slice 6b.2a's closure says a
-- browser-callable definer mutation must, and because a replayed request from a dead session is
-- exactly the shape a duplicate vote would arrive in.
-- =====================================================================================================

create or replace function public.get_match_community(p_fixture_id uuid)
returns table(
  award_id uuid, team_id uuid, category_key text, display_name text, electorate text,
  status text, outcome text, winner_player_id uuid, winner_name text,
  can_vote boolean, my_vote_player_id uuid, can_manage boolean, total_votes int
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  return query
  select a.id,
         a.team_id,
         a.category_key,
         internal.match_award_display_name(a.category_key, a.team_id),
         c.electorate,
         a.status,
         a.outcome,
         a.winner_player_id,
         nullif(btrim(concat_ws(' ', w.first_name, w.surname)), ''),
         (a.status = 'OPEN' and internal.match_award_can_vote(a.id, v_actor)),
         (select v.player_id from public.match_award_votes v where v.award_id = a.id and v.voter_user_id = v_actor),
         internal.can_administer_match_community(a.fixture_id, a.team_id),
         -- TOTALS ARE STAFF-ONLY, AND ONLY ONCE IT IS OVER. The team is told who won; it is never
         -- told by how much, because that is a ranking of children with the order left implicit.
         case when a.status = 'CLOSED' and internal.can_administer_match_community(a.fixture_id, a.team_id)
              then (select count(*)::int from public.match_award_votes v where v.award_id = a.id)
              else null end
    from public.match_awards a
    join public.match_award_categories c on c.category_key = a.category_key
    join public.teams t on t.id = a.team_id
    left join public.players w on w.id = a.winner_player_id
   where a.fixture_id = p_fixture_id
     and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
   order by c.sort_order;
end;
$$;

create or replace function public.open_match_award(p_fixture_id uuid, p_team_id uuid, p_category_key text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_id uuid; v_status text; v_electorate text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_administer_match_community(p_fixture_id, p_team_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  select f.status into v_status from public.fixtures f where f.id = p_fixture_id;
  -- RECOGNITION IS FOR A MATCH THAT HAPPENED. There is no live state in Ovalball and none is
  -- invented here; a match that has not been played has nothing to recognise yet.
  if v_status is distinct from 'Completed' then
    raise exception 'This match has not been played yet.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.team_award_category_settings s
                  where s.team_id = p_team_id and s.category_key = p_category_key and s.enabled) then
    raise exception 'This team does not run that award.' using errcode = 'P0001';
  end if;

  select c.electorate into v_electorate from public.match_award_categories c
   where c.category_key = p_category_key and c.active;
  if v_electorate is null then
    raise exception 'Unknown award.' using errcode = 'P0002';
  end if;
  if v_electorate = 'OPPOSITION_COACHES' and internal.match_other_side(p_fixture_id, p_team_id) is null then
    raise exception 'The opposition is not on Ovalball, so nobody is entitled to choose this award.' using errcode = 'P0001';
  end if;

  insert into public.match_awards (fixture_id, team_id, category_key, opened_by)
  values (p_fixture_id, p_team_id, p_category_key, v_actor)
  on conflict (fixture_id, team_id, category_key) do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_id from public.match_awards a
     where a.fixture_id = p_fixture_id and a.team_id = p_team_id and a.category_key = p_category_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.cast_match_award_vote(p_award_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_team uuid; v_fixture uuid; v_status text; v_fixture_status text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select a.team_id, a.fixture_id, a.status into v_team, v_fixture, v_status
    from public.match_awards a where a.id = p_award_id;
  if v_team is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Voting has closed.' using errcode = 'P0001';
  end if;

  select f.status into v_fixture_status from public.fixtures f where f.id = v_fixture;
  -- A MATCH THAT STOPPED BEING A PLAYED MATCH STOPS TAKING VOTES. Cancelling a fixture after an
  -- award opened is rare and must fail closed rather than quietly keep collecting.
  if v_fixture_status is distinct from 'Completed' then
    raise exception 'This match is no longer a played match.' using errcode = 'P0001';
  end if;

  if not internal.match_award_can_vote(p_award_id, v_actor) then
    raise exception 'You are not entitled to choose this award.' using errcode = '42501';
  end if;
  if not exists (select 1 from internal.match_award_candidates(v_team) c where c.player_id = p_player_id) then
    raise exception 'That player did not play for this side.' using errcode = 'P0001';
  end if;

  insert into public.match_award_votes (award_id, voter_user_id, player_id)
  values (p_award_id, v_actor, p_player_id)
  on conflict (award_id, voter_user_id)
  do update set player_id = excluded.player_id, updated_at = now();
end;
$$;

create or replace function public.withdraw_match_award_vote(p_award_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_status text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select a.status into v_status from public.match_awards a where a.id = p_award_id;
  if v_status is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Voting has closed.' using errcode = 'P0001';
  end if;
  delete from public.match_award_votes v where v.award_id = p_award_id and v.voter_user_id = v_actor;
end;
$$;

create or replace function public.close_match_award(p_award_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_fixture uuid; v_team uuid; v_status text; v_top int; v_leaders int; v_winner uuid; v_outcome text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- The row is locked so that two authorised administrators closing at the same moment produce one
  -- decision rather than two, and so a vote cast mid-close is either in or out, never half in.
  select a.fixture_id, a.team_id, a.status into v_fixture, v_team, v_status
    from public.match_awards a where a.id = p_award_id for update;
  if v_fixture is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if not internal.can_administer_match_community(v_fixture, v_team) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if v_status = 'CLOSED' then
    return (select a.outcome from public.match_awards a where a.id = p_award_id);
  end if;

  select max(cnt) into v_top from (
    select count(*) as cnt from public.match_award_votes v where v.award_id = p_award_id group by v.player_id
  ) tally;

  if v_top is null then
    v_outcome := 'NO_VOTES';
    v_winner := null;
  else
    select count(*) into v_leaders from (
      select v.player_id from public.match_award_votes v where v.award_id = p_award_id
       group by v.player_id having count(*) = v_top
    ) leaders;
    if v_leaders > 1 then
      -- A TIE IS AN ANSWER. Breaking it by a rule nobody agreed -- earliest vote, alphabetical --
      -- would invent a winner the votes did not choose.
      v_outcome := 'TIE';
      v_winner := null;
    else
      v_outcome := 'WINNER';
      select v.player_id into v_winner from public.match_award_votes v where v.award_id = p_award_id
       group by v.player_id having count(*) = v_top;
    end if;
  end if;

  update public.match_awards
     set status = 'CLOSED', outcome = v_outcome, winner_player_id = v_winner,
         closed_by = v_actor, closed_at = now()
   where id = p_award_id;

  return v_outcome;
end;
$$;

create or replace function public.give_match_kudos(p_fixture_id uuid, p_team_id uuid, p_recipient_player_id uuid, p_kudos_key text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_fixture_status text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select f.status into v_fixture_status from public.fixtures f where f.id = p_fixture_id;
  if v_fixture_status is null then
    raise exception 'Match not found.' using errcode = 'P0002';
  end if;
  if v_fixture_status is distinct from 'Completed' then
    raise exception 'This match has not been played yet.' using errcode = 'P0001';
  end if;

  if not internal.match_can_give_kudos(p_team_id, v_actor) then
    raise exception 'You are not part of this team.' using errcode = '42501';
  end if;
  if not exists (select 1 from internal.match_award_candidates(p_team_id) c where c.player_id = p_recipient_player_id) then
    raise exception 'That player did not play for this side.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.match_kudos_kinds k where k.kudos_key = p_kudos_key and k.active) then
    raise exception 'Unknown recognition.' using errcode = 'P0002';
  end if;
  -- Recognition is something you give somebody else.
  if exists (select 1 from public.players p where p.id = p_recipient_player_id and p.user_id = v_actor) then
    raise exception 'You cannot give this to yourself.' using errcode = 'P0001';
  end if;

  insert into public.match_kudos (fixture_id, team_id, recipient_player_id, given_by_user_id, kudos_key)
  values (p_fixture_id, p_team_id, p_recipient_player_id, v_actor, p_kudos_key)
  on conflict (fixture_id, given_by_user_id, recipient_player_id)
  do update set kudos_key = excluded.kudos_key, removed_at = null, removed_by = null;
end;
$$;

-- TAKING YOUR OWN BACK.
--
-- Addressed the same way the surface shows it -- this match, this player -- because a giver has no
-- row id in front of them either. Their own recognition is deleted outright rather than marked
-- removed: there is no moderation history to keep about somebody withdrawing their own thank-you.
create or replace function public.withdraw_match_kudos(p_fixture_id uuid, p_recipient_player_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_removed int;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  delete from public.match_kudos
   where fixture_id = p_fixture_id
     and recipient_player_id = p_recipient_player_id
     and given_by_user_id = v_actor;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- MODERATION ACTS ON WHAT STAFF CAN ACTUALLY SEE.
--
-- The kudos surface is aggregated and gives no voter away, so it shows "Ava -- Brave defence x3" and
-- not three attributable rows. Removal therefore takes the same shape: staff remove that recognition
-- for that player on that match, and every row behind it is marked removed with who removed it. A
-- per-row moderation call would have needed the page to name the givers first.
create or replace function public.remove_match_kudos(
  p_fixture_id uuid, p_team_id uuid, p_recipient_player_id uuid, p_kudos_key text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_removed int;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_administer_match_community(p_fixture_id, p_team_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  -- SOFT, SO THE HISTORY SURVIVES WHAT THE PAGE STOPS SHOWING.
  update public.match_kudos
     set removed_at = now(), removed_by = v_actor
   where fixture_id = p_fixture_id
     and team_id = p_team_id
     and recipient_player_id = p_recipient_player_id
     and kudos_key = p_kudos_key
     and removed_at is null;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create or replace function public.get_match_kudos(p_fixture_id uuid)
returns table(team_id uuid, player_id uuid, player_name text, kudos_key text, label text, given_count int, mine boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  return query
  select k.team_id,
         k.recipient_player_id,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
         k.kudos_key,
         kk.label,
         count(*)::int,
         bool_or(k.given_by_user_id = v_actor)
    from public.match_kudos k
    join public.players p on p.id = k.recipient_player_id
    join public.match_kudos_kinds kk on kk.kudos_key = k.kudos_key
    join public.teams t on t.id = k.team_id
   where k.fixture_id = p_fixture_id
     and k.removed_at is null
     and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
   group by k.team_id, k.recipient_player_id, p.first_name, p.surname, k.kudos_key, kk.label, kk.sort_order
   order by kk.sort_order;
end;
$$;

create or replace function public.set_team_award_category(
  p_team_id uuid, p_category_key text, p_enabled boolean, p_display_name_override text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_club uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  -- THE PEOPLE WHO ALREADY SPEAK FOR THE TEAM. `team.community.manage` is the key this ought to be,
  -- and it grants nothing today -- see the report. Activating it would silently change who may
  -- speak as a team in Messenger, which is not Step 11's to change, so this uses the granted
  -- capability that already describes the same people.
  if not (internal.can('team.news.manage', 'team', v_club, p_team_id, null)
          or internal.can('team.news.manage', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.match_award_categories c where c.category_key = p_category_key and c.active) then
    raise exception 'Unknown award.' using errcode = 'P0002';
  end if;

  insert into public.team_award_category_settings (team_id, category_key, enabled, display_name_override, updated_by, updated_at)
  values (p_team_id, p_category_key, p_enabled, nullif(btrim(coalesce(p_display_name_override, '')), ''), v_actor, now())
  on conflict (team_id, category_key)
  do update set enabled = excluded.enabled,
                display_name_override = excluded.display_name_override,
                updated_by = excluded.updated_by,
                updated_at = now();
end;
$$;

-- THE NAMES AN ELIGIBLE PERSON MAY CHOOSE BETWEEN.
--
-- Match Centre's participant list is staff-only, and stays that way: it carries attendance answers
-- and call-up markers. But a parent cannot choose their side's player of the match from a list they
-- are not allowed to see, so this returns NAMES ONLY, and only to somebody who is already entitled
-- to give something to this side -- a voter in its electorate, its staff, or the opposition coaches
-- for the award that is theirs to choose. No eligibility, no list.
create or replace function public.get_match_recognition_squad(p_fixture_id uuid, p_team_id uuid)
returns table(player_id uuid, display_name text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid; v_other uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  v_other := internal.match_other_side(p_fixture_id, p_team_id);

  if not (
      internal.match_can_give_kudos(p_team_id, v_actor)
      or internal.can_administer_match_community(p_fixture_id, p_team_id)
      or (v_other is not null and internal.is_active_team_coach(v_other, v_actor))
  ) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select p.id, nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')
    from internal.match_award_candidates(p_team_id) c
    join public.players p on p.id = c.player_id
   order by p.surname, p.first_name;
end;
$$;

-- WHAT THE STAFF OF A SIDE SEE BEFORE THERE IS ANYTHING TO SEE.
--
-- An award cannot be opened until the team runs it, so staff need the catalogue, the team's own
-- switches and its own names for them -- and they need it on a match where no award row exists yet,
-- which is why this cannot be derived from `get_match_community`. It returns nothing at all to
-- somebody who does not administer that side.
create or replace function public.get_match_community_admin(p_fixture_id uuid)
returns table(
  team_id uuid, category_key text, display_name text, electorate text,
  enabled boolean, display_name_override text, award_id uuid, award_status text, available boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  return query
  select t.id,
         c.category_key,
         internal.match_award_display_name(c.category_key, t.id),
         c.electorate,
         coalesce(s.enabled, false),
         s.display_name_override,
         a.id,
         a.status,
         -- An award whose electorate is the opposition's coaches cannot run against an opponent who
         -- is not on Ovalball: there would be nobody entitled to choose it.
         (c.electorate <> 'OPPOSITION_COACHES' or internal.match_other_side(p_fixture_id, t.id) is not null)
    from public.fixtures f
    join public.teams t on t.id in (f.owning_team_id, f.opponent_team_id)
   cross join public.match_award_categories c
    left join public.team_award_category_settings s on s.team_id = t.id and s.category_key = c.category_key
    left join public.match_awards a on a.fixture_id = f.id and a.team_id = t.id and a.category_key = c.category_key
   where f.id = p_fixture_id
     and c.active
     and internal.can_administer_match_community(f.id, t.id)
   order by t.id, c.sort_order;
end;
$$;

-- =====================================================================================================
-- 8. THE PERIMETER
--
-- A PLAYER'S RECOGNITION HISTORY IS NOT READ HERE. The durable truth is in these tables -- an award
-- row keeps the fixture and the team it was won with, so moving team later neither erases it nor
-- rewrites it -- but the reader that puts it on a person's profile belongs to the Player profile
-- surface, which this step is told not to redesign. Shipping a granted function with no caller would
-- have left the next person to need award history finding it before they found that decision.
-- =====================================================================================================
revoke all on function public.get_match_community(uuid)                       from public;
revoke all on function public.get_match_community_admin(uuid)                 from public;
revoke all on function public.get_match_recognition_squad(uuid, uuid)         from public;
revoke all on function public.get_match_kudos(uuid)                           from public;
revoke all on function public.open_match_award(uuid, uuid, text)              from public;
revoke all on function public.close_match_award(uuid)                         from public;
revoke all on function public.cast_match_award_vote(uuid, uuid)               from public;
revoke all on function public.withdraw_match_award_vote(uuid)                 from public;
revoke all on function public.give_match_kudos(uuid, uuid, uuid, text)        from public;
revoke all on function public.withdraw_match_kudos(uuid, uuid)                from public;
revoke all on function public.remove_match_kudos(uuid, uuid, uuid, text)      from public;
revoke all on function public.set_team_award_category(uuid, text, boolean, text) from public;

grant execute on function public.get_match_community(uuid)                       to authenticated;
grant execute on function public.get_match_community_admin(uuid)                 to authenticated;
grant execute on function public.get_match_recognition_squad(uuid, uuid)         to authenticated;
grant execute on function public.get_match_kudos(uuid)                           to authenticated;
grant execute on function public.open_match_award(uuid, uuid, text)              to authenticated;
grant execute on function public.close_match_award(uuid)                         to authenticated;
grant execute on function public.cast_match_award_vote(uuid, uuid)               to authenticated;
grant execute on function public.withdraw_match_award_vote(uuid)                 to authenticated;
grant execute on function public.give_match_kudos(uuid, uuid, uuid, text)        to authenticated;
grant execute on function public.withdraw_match_kudos(uuid, uuid)                to authenticated;
grant execute on function public.remove_match_kudos(uuid, uuid, uuid, text)      to authenticated;
grant execute on function public.set_team_award_category(uuid, text, boolean, text) to authenticated;

grant select on public.match_award_categories, public.match_kudos_kinds,
                public.team_award_category_settings, public.match_awards, public.match_kudos to authenticated;

-- =====================================================================================================
-- 9. THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_def text; v_bad text;
begin
  -- Nothing in this step may write to the fixture. The rugby is not a poll.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname in ('open_match_award','close_match_award','cast_match_award_vote','withdraw_match_award_vote',
                       'give_match_kudos','withdraw_match_kudos','remove_match_kudos','set_team_award_category')
     and p.prosrc ~* '(insert into|update)\s+public\.fixtures';
  if v_bad is not null then
    raise exception 'Step 11: a community function writes to public.fixtures: %', v_bad;
  end if;

  -- Every browser-callable mutation here meets the canonical session gate.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('open_match_award','close_match_award','cast_match_award_vote','withdraw_match_award_vote',
                       'give_match_kudos','withdraw_match_kudos','remove_match_kudos','set_team_award_category')
     and p.prosrc !~ 'internal\.session_ok\(\)';
  if v_bad is not null then
    raise exception 'Step 11: a community mutation bypasses the session gate: %', v_bad;
  end if;

  -- One vote per person is the database's job, not the browser's.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.match_award_votes'::regclass and c.contype = 'u'
       and pg_get_constraintdef(c.oid) ~ 'award_id' and pg_get_constraintdef(c.oid) ~ 'voter_user_id') then
    raise exception 'Step 11: nothing stops one person voting twice';
  end if;

  -- Kudos has no free text, so there is nothing to moderate after the fact.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'match_kudos'
                and column_name in ('note', 'message', 'body', 'comment')) then
    raise exception 'Step 11: match_kudos grew a free-text field';
  end if;

  -- No currency, no points, no granted badge.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('match_kudos', 'match_awards')
                and column_name ~ 'points|amount|balance|credit|pence') then
    raise exception 'Step 11: a points or currency column appeared in the recognition tables';
  end if;

  -- THE DISPLAY OVERRIDE IS PRESENTATION ONLY.
  --
  -- Three functions may touch it: the one that renders a name, the one that sets it, and the staff
  -- configuration reader that shows staff what they set. Every other function is forbidden it,
  -- because the moment an authority decision reads a club-authored string, a club can rename its
  -- way into somebody else's permissions.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and p.prosrc ~ 'display_name_override'
     and p.proname not in ('match_award_display_name', 'set_team_award_category', 'get_match_community_admin');
  if v_bad is not null then
    raise exception 'Step 11: the display override is read outside presentation: %', v_bad;
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'match_side_is_adult';
  if v_def !~ '''senior''' then
    raise exception 'Step 11: the adult test no longer reads the canonical senior category';
  end if;

  -- No eligibility or administration decision may mention it at all.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal'
     and p.proname in ('match_award_can_vote', 'can_administer_match_community', 'match_can_give_kudos',
                       'is_active_team_coach', 'match_side_is_adult', 'match_award_candidates')
     and p.prosrc ~ 'display_name_override';
  if v_bad is not null then
    raise exception 'Step 11: an authority decision reads the display override: %', v_bad;
  end if;

  if has_function_privilege('anon', 'public.get_match_community(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cast_match_award_vote(uuid, uuid)', 'EXECUTE') then
    raise exception 'Step 11: anon can reach the community surface';
  end if;

  raise notice 'PASS Step 11: recognition is positive, server-decided, one-vote-per-person, and cannot touch the rugby';
end;
$guard$;
