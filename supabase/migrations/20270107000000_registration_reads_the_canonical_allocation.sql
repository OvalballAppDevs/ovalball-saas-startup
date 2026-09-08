-- What a parent needs to see, answered by the allocation chain that already
-- exists.
--
-- Ovalball can already answer "which team does this player belong in": a
-- canonical season from internal.resolve_season_for_date, a regulatory age
-- from resolve_player_regulatory_age, and a canonical identity from
-- resolve_normal_operational_identity, which knows about Mixed minis, the
-- Union girls dual bands, the end of the youth pathway and the League grades
-- that do not exist. None of that is repeated here.
--
-- Two things that chain does NOT answer, and which the registration screen
-- cannot invent for itself:
--
--   1. WHAT THE TEAM IS CALLED. The resolver returns the directory label --
--      "Girls U12" -- which is the compact rugby identifier. A parent should
--      read "Under 12 Girls". Both forms come from
--      internal.canonical_team_presentation, the one naming rule.
--
--   2. WHETHER THIS CLUB ACTUALLY RUNS IT. The canonical identity is a fact
--      about the player; whether Rothwell RUFC fields an Under 12 Girls side
--      is a fact about the club. Conflating them is how a girl gets offered
--      the boys' team, so they are returned as separate answers and the
--      caller is never given a near-enough substitute.
--
-- Deliberately NOT here: any age arithmetic, any girls banding, any
-- Union/League mapping, any season maths. If one appeared it would be a second
-- authority, and the first one it disagreed with would be right.

create or replace function internal.allocation_presentation(
  p_canonical_team_type_id uuid,
  p_rugby_code text
) returns table(compact_label text, display_label text)
language sql
stable
as $function$
  select pres.compact, pres.display
  from public.canonical_team_types ctt
  cross join lateral internal.canonical_team_presentation(
    ctt.category, ctt.age_group, ctt.gender, ctt.fixed_squad_designation, p_rugby_code) pres
  where ctt.id = p_canonical_team_type_id;
$function$;

comment on function internal.allocation_presentation(uuid, text) is
  'The two names for an allocated identity, from the one naming rule: the compact rugby identifier and the display name a person reads.';

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------
--
-- The same three relationships add_child_for_guardian requires. Without this,
-- the preview would be an open oracle: anybody signed in could ask "what team
-- would a girl born on this date be put in at that club", which is a question
-- about a real child if you already suspect the answer.

create or replace function internal.may_ask_club_allocation(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    exists (
      select 1 from public.guardian_invitations gi
      where gi.club_id = p_club_id and gi.accepted_by = auth.uid() and gi.status = 'accepted'
    )
    or exists (
      select 1
      from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id
      join public.teams t on t.id = ptm.team_id
      where g.guardian_user_id = auth.uid() and t.club_id = p_club_id
    )
    or exists (
      select 1 from public.club_memberships cm
      where cm.user_id = auth.uid() and cm.club_id = p_club_id and cm.status = 'active'
    )
  );
$function$;

comment on function internal.may_ask_club_allocation(uuid) is
  'The same relationship add_child_for_guardian requires before a person may add a child to a club. Applied to the allocation preview too, so it never becomes an oracle answering questions about other people''s children.';

-- ---------------------------------------------------------------------------
-- The preview, before a player exists
-- ---------------------------------------------------------------------------
--
-- Nothing is written. This is what lets registration SHOW the parent the
-- answer and ask them to confirm it, instead of creating a child and telling
-- them afterwards where it went.
--
-- It is a preview and never an authority: add_child_for_guardian re-runs the
-- whole chain from the values it is given at the moment it writes, so a stale
-- or tampered preview cannot place anybody anywhere.

create or replace function public.preview_player_allocation(
  p_club_id uuid,
  p_date_of_birth date,
  p_playing_pathway text,
  -- Optional, and only so the confirmation can say the player's name back
  -- properly. It goes through internal.normalise_person_name -- the ONE
  -- normaliser -- rather than being title-cased in the browser, because a
  -- parent who types "callum" should be shown the same "Callum" the database
  -- will store, and a second formatter is how those two drift apart.
  p_first_name text default null
) returns table(
  normalised_first_name text,
  rugby_code text,
  season_id uuid,
  season_name text,
  regulatory_age_label text,
  allocation_status text,
  reason text,
  canonical_team_type_id uuid,
  compact_label text,
  display_label text,
  -- The club's own answer, kept separate from the identity on purpose.
  club_runs_team boolean,
  operational_team_id uuid,
  operational_team_name text,
  -- More than one active side at the identity (an A and a B) is a squad
  -- decision for the club, not something to put to a parent at registration.
  operational_team_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
  v_season_id uuid;
  v_season_name text;
  r record;
  v_compact text; v_display text;
  v_count integer := 0;
  v_team_id uuid;
  v_team_name text;
  v_name text;
begin
  v_name := nullif(internal.normalise_person_name(trim(coalesce(p_first_name, ''))), '');
  if not internal.may_ask_club_allocation(p_club_id) then
    raise exception 'You need an invitation from this club before you can register a player with it.'
      using errcode = '42501';
  end if;
  if p_date_of_birth is null then
    raise exception 'A date of birth is needed before Ovalball can work out an age group.'
      using errcode = '23514';
  end if;

  select cd.rugby_code into v_code
  from public.clubs c
  join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id and c.status = 'active';
  if v_code is null then
    raise exception 'Club not found.';
  end if;

  -- The canonical season register is the only season authority. A missing
  -- season is surfaced, never worked around with a date calculation.
  v_season_id := internal.resolve_season_for_date(v_code, current_date);
  if v_season_id is null then
    return query select v_name, v_code, null::uuid, null::text, null::text, 'SEASON_UNAVAILABLE'::text,
      'Ovalball does not currently have a season set up for this rugby code, so it cannot work out an age group yet. Your club can sort this out.'::text,
      null::uuid, null::text, null::text, false, null::uuid, null::text, 0;
    return;
  end if;
  select s.name into v_season_name from public.seasons s where s.id = v_season_id;

  select * into r from public.resolve_normal_operational_identity(
    v_code, v_season_id, p_date_of_birth, nullif(upper(nullif(p_playing_pathway, '')), ''));

  if r.canonical_team_type_id is not null then
    select ap.compact_label, ap.display_label into v_compact, v_display
    from internal.allocation_presentation(r.canonical_team_type_id, v_code) ap;

    select count(*) into v_count
    from public.teams t
    where t.club_id = p_club_id and t.active
      and t.canonical_team_type_id = r.canonical_team_type_id;

    if v_count = 1 then
      select t.id, t.display_name into v_team_id, v_team_name
      from public.teams t
      where t.club_id = p_club_id and t.active
        and t.canonical_team_type_id = r.canonical_team_type_id;
    end if;
  end if;

  return query select
    v_name, v_code, v_season_id, v_season_name,
    r.regulatory_age_label, r.allocation_status, r.reason,
    r.canonical_team_type_id, v_compact, v_display,
    v_count > 0, v_team_id, v_team_name, v_count;
end;
$function$;

comment on function public.preview_player_allocation(uuid, date, text, text) is
  'The registration screen''s read: the canonical allocation for a date of birth and pathway at one club, in the words a parent reads, plus whether that club actually runs the team. Writes nothing and decides nothing -- add_child_for_guardian re-runs the same chain at the moment it writes.';

revoke all on function public.preview_player_allocation(uuid, date, text, text) from public;
grant execute on function public.preview_player_allocation(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The same answer for a player who already exists
-- ---------------------------------------------------------------------------
--
-- THE PLAYER RECORD IS THE AUTHORITY. This takes a player_id and reads that
-- player's own stored date of birth and pathway -- never values handed in from
-- a browser -- which is what makes it safe to use on a dashboard, on a profile
-- page, and after a correction.

create or replace function public.player_team_allocation(
  p_player_id uuid,
  p_club_id uuid
) returns table(
  rugby_code text,
  season_id uuid,
  season_name text,
  regulatory_age_label text,
  allocation_status text,
  reason text,
  canonical_team_type_id uuid,
  compact_label text,
  display_label text,
  club_runs_team boolean,
  operational_team_id uuid,
  operational_team_name text,
  operational_team_count integer,
  -- What the player's place at this club actually is right now, so a screen
  -- never has to guess between "resolved" and "approved".
  membership_status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dob date;
  v_pathway text;
  v_membership text;
  p record;
begin
  -- A player's date of birth and pathway are protected information. Only the
  -- people the safeguarding model already trusts with the profile may ask what
  -- it resolves to.
  if not internal.may_complete_player_profile(p_player_id) and not internal.may_ask_club_allocation(p_club_id) then
    raise exception 'Not authorized to view this player''s allocation.' using errcode = '42501';
  end if;

  select pl.date_of_birth, pl.playing_pathway into v_dob, v_pathway
  from public.players pl where pl.id = p_player_id;
  if not found then
    raise exception 'Player not found.';
  end if;

  if v_dob is null then
    return query select null::text, null::uuid, null::text, null::text, 'DOB_REQUIRED'::text,
      'This player''s date of birth has not been recorded yet, and it is what decides their age group.'::text,
      null::uuid, null::text, null::text, false, null::uuid, null::text, 0, null::text;
    return;
  end if;

  select ptm.status into v_membership
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and t.club_id = p_club_id
  order by (ptm.status = 'active') desc, (ptm.status = 'pending') desc, ptm.joined_at desc
  limit 1;

  for p in select * from public.preview_player_allocation(p_club_id, v_dob, v_pathway, null) loop
    return query select p.rugby_code, p.season_id, p.season_name, p.regulatory_age_label,
      p.allocation_status, p.reason, p.canonical_team_type_id, p.compact_label, p.display_label,
      p.club_runs_team, p.operational_team_id, p.operational_team_name, p.operational_team_count,
      v_membership;
  end loop;
end;
$function$;

comment on function public.player_team_allocation(uuid, uuid) is
  'The canonical allocation for a player who already exists, read from THEIR OWN stored date of birth and pathway rather than anything a browser sends, plus their real membership state at that club so a screen never confuses "resolved" with "approved".';

revoke all on function public.player_team_allocation(uuid, uuid) from public;
grant execute on function public.player_team_allocation(uuid, uuid) to authenticated;
