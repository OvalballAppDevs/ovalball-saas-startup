-- A player's regulatory playing pathway, held on the player.
--
-- WHAT THE UAT EXPOSED
--
-- Ben Whitaker, Union, regulatory age U11, was told:
--
--   "This player's regulatory age is U11, but Union rugby offers no
--    operational team at that age grade for this player."
--
-- Union plainly runs U11. The resolver had been given 'boys' and asked for a
-- BOYS U11 identity, which does not exist -- U6 to U11 are Mixed identities
-- with no boys/girls branch at all. And the 'boys' did not come from Ben. It
-- came from his TEAM, whose gender column is NULL, defaulted to 'boys' by
-- resolve_normal_operational_identity.
--
-- So the regulatory allocation for a child was being derived from the team
-- they happened to be in, and where that team said nothing, from a guess. Both
-- halves are wrong, and the second is the more serious: it is a silent default
-- about a child's sex.
--
-- WHY A NEW COLUMN WAS REQUIRED
--
-- The audit found NO player-level attribute of this kind anywhere. Every
-- gender concept in the schema sits on TEAMS (teams.gender,
-- canonical_team_types.gender, team_season_identity.gender) and describes a
-- team identity, not a person. There was nothing to reuse, so this adds one
-- column and no more.
--
-- WHAT IT IS, AND IS NOT
--
-- playing_pathway is the governing-body pathway a player is registered into.
-- It reuses the vocabulary the regulatory layer already uses --
-- regulatory_fact_applicability.gender_pathway is MALE / FEMALE / MIXED / OPEN
-- -- restricted to the two values that can describe a PERSON.
--
-- MIXED and OPEN are deliberately excluded. They describe a TEAM or a
-- competition, never a player: an eight-year-old plays in a Mixed team, they
-- are not "mixed". Requiring a fake Mixed value on a person to make mini-rugby
-- resolve would be inventing data to satisfy a resolver.
--
-- NULL means UNKNOWN. It does not mean male, and it does not mean mixed. Where
-- the answer genuinely changes the allocation the resolver now fails closed
-- with CLASSIFICATION_REQUIRED rather than guessing; where it genuinely does
-- not, no one is asked for it.

alter table public.players
  add column if not exists playing_pathway text;

alter table public.players
  drop constraint if exists players_playing_pathway_check;
alter table public.players
  add constraint players_playing_pathway_check
  check (playing_pathway is null or playing_pathway in ('MALE', 'FEMALE'));

comment on column public.players.playing_pathway is
  'The governing-body playing pathway this player is registered into: MALE or FEMALE, matching the regulatory vocabulary in regulatory_fact_applicability.gender_pathway. NULL means unknown, never male and never mixed. MIXED and OPEN are excluded deliberately: they describe a team or competition, not a person. This is a protected player attribute -- consumers should read the resulting eligibility or allocation, not this field.';

-- ============================================================
-- The allocation vocabulary gains the missing-input case.
-- ============================================================
--
-- Shaped exactly like DOB_REQUIRED, which already means "a required player
-- attribute is missing, so no allocation can be made". This is the same event
-- for a different attribute, so it reuses that pattern rather than inventing a
-- second way to say it.

alter table public.age_grade_rollover_player_proposals
  drop constraint if exists rollover_player_proposal_allocation_status_check;
alter table public.age_grade_rollover_player_proposals
  add constraint rollover_player_proposal_allocation_status_check
  check (allocation_status in ('NORMAL_PLACEMENT', 'NEEDS_ATTENTION', 'DOB_REQUIRED', 'CLUB_HOLDING', 'CLASSIFICATION_REQUIRED'));

-- ============================================================
-- The resolver asks the canonical directory, not a hardcoded band.
-- ============================================================

-- Dropped and recreated rather than replaced: the fourth parameter stops being
-- a team's gender and becomes the PLAYER's pathway, and the name has to say so.
drop function if exists public.resolve_normal_operational_identity(text, uuid, date, text);

create function public.resolve_normal_operational_identity(
  p_rugby_code text, p_season_id uuid, p_date_of_birth date, p_playing_pathway text
) returns table (
  regulatory_age_label text, regulatory_status text, canonical_team_type_id uuid,
  canonical_key text, canonical_label text, allocation_status text, reason text
)
language plpgsql stable
as $function$
declare
  r record;
  v_pathway text := nullif(upper(nullif(p_playing_pathway, '')), '');
  v_gender text;
  v_id uuid; v_key text; v_label text; v_age_group text;
  v_top integer;
begin
  select * into r from public.resolve_player_regulatory_age(p_rugby_code, p_season_id, p_date_of_birth);

  -- An adult is not an unsolved youth-pathway problem.
  if r.status = 'ADULT' then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLUB_HOLDING'::text,
      format('This player is past every age grade in the %s youth pathway. They move to the club''s holding list as a free agent, keeping their place at the club, and an authorised person can assign them to an adult team through the ordinary placement workflow. Ovalball does not put a player into adult rugby automatically.',
        case p_rugby_code when 'union' then 'Union' else 'League' end);
    return;
  end if;

  if r.status <> 'RESOLVED' then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      case r.status when 'DOB_REQUIRED' then 'DOB_REQUIRED' else 'NEEDS_ATTENTION' end, r.reason;
    return;
  end if;

  -- MIXED FIRST, and established from the canonical directory rather than a
  -- hardcoded age band. If this code offers a Mixed identity at this age
  -- grade, that IS the normal identity and the player's pathway does not
  -- change it -- so nobody is asked for information the decision does not use.
  -- Asking the directory keeps this code-specific: League is answered by
  -- League's own offering, never by Union's.
  select v.id, v.key, v.label into v_id, v_key, v_label
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code and v.is_offered and v.category = 'youth'
    and v.age_group = r.regulatory_age_label and v.gender = 'mixed';

  if v_id is not null then
    return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
      format('%s is played as Mixed rugby in %s, so this player''s normal team is the %s side whatever pathway they are registered in.',
        r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end, v_label);
    return;
  end if;

  -- Past the top of BOTH pathways the answer is the same either way, so there
  -- is nothing to ask. A Union player at U19 has left the youth game whether
  -- they are registered male or female; demanding a classification to tell
  -- them so would be blocking work that changes nothing. League differs -- its
  -- male pathway runs a year longer -- which is why this is read from the
  -- directory per code rather than assumed.
  if r.regulatory_age_number > greatest(
       coalesce(internal.highest_youth_age_offered(p_rugby_code, 'boys'), 0),
       coalesce(internal.highest_youth_age_offered(p_rugby_code, 'girls'), 0)) then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLUB_HOLDING'::text,
      format('This player is %s and has come to the end of the %s youth pathway. They move to the club''s holding list as a free agent, keeping their place at the club, and an authorised person can assign them to an adult team through the ordinary placement workflow. Ovalball does not put a player into adult rugby automatically.',
        r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end);
    return;
  end if;

  -- Past the Mixed band the pathway genuinely decides the branch, so a missing
  -- one fails closed. No default, in either direction.
  if v_pathway is null then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLASSIFICATION_REQUIRED'::text,
      format('From %s the boys'' and girls'' pathways are separate age grades, so Ovalball needs to know which pathway this player is registered in before it can say which team they belong in. It must never be assumed, and it must never be inferred from the team they happen to be in now.',
        r.regulatory_age_label);
    return;
  end if;

  v_gender := case v_pathway when 'MALE' then 'boys' when 'FEMALE' then 'girls' end;
  if v_gender is null then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLASSIFICATION_REQUIRED'::text,
      format('%s is not a playing pathway Ovalball recognises.', p_playing_pathway);
    return;
  end if;

  -- EXACT match on the branch the pathway names.
  select v.id, v.key, v.label into v_id, v_key, v_label
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code and v.is_offered and v.category = 'youth'
    and v.age_group = r.regulatory_age_label
    and v.gender = v_gender;

  if v_id is not null then
    return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
      format('Regulatory age %s maps directly onto the %s identity this club can run.', r.regulatory_age_label, v_label);
    return;
  end if;

  -- Union girls play in dual bands (U12/U11, U14/U13, U16/U15, U18/U17), so an
  -- odd regulatory age resolves onto the band above it. Reg 15.6.
  if p_rugby_code = 'union' and v_gender = 'girls' and r.regulatory_age_number between 11 and 17 then
    v_age_group := 'U' || (r.regulatory_age_number + (r.regulatory_age_number % 2))::text;
    select v.id, v.key, v.label into v_id, v_key, v_label
    from public.canonical_team_types_by_code v
    where v.rugby_code = p_rugby_code and v.is_offered and v.category = 'youth'
      and v.age_group = v_age_group and v.gender = 'girls';
    if v_id is not null then
      return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
        format('Union girls play in dual age bands (RFU Regulation 15.6), so a %s player is a %s player: regulatory age %s, band %s.',
          r.regulatory_age_label, v_label, r.regulatory_age_label, v_age_group);
      return;
    end if;
  end if;

  -- PATHWAY TERMINATED: aged past the last youth grade this code and pathway
  -- offers. The ordinary end of a rugby childhood, not a problem to solve.
  v_top := internal.highest_youth_age_offered(p_rugby_code, v_gender);
  if v_top is not null and r.regulatory_age_number > v_top then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLUB_HOLDING'::text,
      format('This player is %s and has come to the end of the %s youth pathway, which runs to U%s. They move to the club''s holding list as a free agent, keeping their place at the club, and an authorised person can assign them to an adult team through the ordinary placement workflow. Ovalball does not put a player into adult rugby automatically.',
        r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end, v_top);
    return;
  end if;

  -- A grade genuinely missing from the middle of the pathway -- the League
  -- Girls U17 case. Eligibility to play up is NOT automatic placement.
  return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
    'NEEDS_ATTENTION'::text,
    format('This player''s regulatory age is %s, but %s rugby offers no operational team at that age grade for this player. A placement decision is required -- Ovalball will not manufacture an identity the competition does not run, nor silently place the player in a different age grade.',
      r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end);
end;
$function$;

comment on function public.resolve_normal_operational_identity(text, uuid, date, text) is
  'The canonical team identity a player normally belongs in. Takes the PLAYER''s regulatory playing pathway, never a team''s gender. Where the code offers a Mixed identity at that age grade the pathway is not consulted; beyond it, a missing pathway fails closed as CLASSIFICATION_REQUIRED rather than defaulting.';

-- ============================================================
-- The handover reads the PLAYER, not the team they sit in.
-- ============================================================

create or replace function internal.generate_rollover_player_proposals_core(p_rollover_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  m record;
  v_reg record;
  v_norm record;
  v_move record;
  v_disp record;
  v_proposed_team uuid;
  v_proposed_type uuid;
  v_review text;
  v_reason text;
  v_disp_outcome text;
  v_move_req text;
  v_count integer := 0;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then raise exception 'Rollover not found.'; end if;

  for m in
    select ptm.id as membership_id, ptm.player_id, ptm.team_id,
           p.date_of_birth, p.playing_pathway, t.rugby_code, t.active as team_active,
           t.display_name as team_name,
           tp.proposed_age_group, tp.proposed_to_canonical_team_type_id,
           tp.requires_manual_choice, tp.decision as team_decision
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    join public.players p on p.id = ptm.player_id
    left join public.age_grade_rollover_team_proposals tp
      on tp.rollover_id = r.id and tp.team_id = ptm.team_id
    where t.club_id = r.club_id and t.rugby_code = r.rugby_code
      and ptm.status = 'active' and t.category = 'youth'
      and (t.active or tp.decision = 'folded')
  loop
    v_proposed_team := null; v_proposed_type := m.proposed_to_canonical_team_type_id;
    v_review := 'READY'; v_reason := null; v_disp_outcome := null; v_move_req := null;

    -- DOB and playing pathway are read here and nowhere else. Neither is
    -- carried into the row that gets written: consumers receive the decision.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.playing_pathway);

    v_proposed_team := internal.resolve_normal_placement_team(
      r.id, m.team_id, v_norm.canonical_team_type_id);

    select * into v_disp
    from public.player_team_dispensation d
    where d.player_id = m.player_id and d.status = 'approved'
      and d.season_id is distinct from r.to_season_id
    order by d.created_at desc
    limit 1;

    if v_disp.id is not null then
      if v_norm.allocation_status = 'NORMAL_PLACEMENT'
         and v_norm.canonical_team_type_id is not null
         and v_proposed_team is not null then
        v_disp_outcome := 'NO_LONGER_REQUIRED';
      else
        v_disp_outcome := 'EXPIRES_AT_SEASON_BOUNDARY';
      end if;
    end if;

    if v_proposed_team is not null and v_proposed_team is distinct from m.team_id then
      select * into v_move from internal.resolve_player_movement_eligibility(
        r.rugby_code, current_date, m.date_of_birth, m.team_id, v_proposed_team);
      v_move_req := v_move.requirement;
    end if;

    if v_norm.allocation_status = 'DOB_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'This player has no recorded date of birth, so their age grade for the target season cannot be established. It must never be inferred from the team they currently play for. Obtain the date of birth through the normal protected profile process.';
    elsif v_norm.allocation_status = 'CLASSIFICATION_REQUIRED' then
      -- Missing player information, not a rugby problem. Says what is needed
      -- and why, without stating or implying anything about the child.
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_norm.reason, 'Playing information is needed to confirm next-season placement.');
    elsif m.team_decision = 'folded' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('%s is not continuing next season, so this player needs a new place. Their normal age grade for the target season is %s.',
                         m.team_name, coalesce(v_norm.canonical_label, v_reg.regulatory_age_label, 'unresolved'));
    elsif v_norm.allocation_status = 'CLUB_HOLDING' then
      v_review := 'READY';
      v_reason := v_norm.reason;
    elsif v_norm.allocation_status = 'NEEDS_ATTENTION' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := v_norm.reason;
    elsif v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('This club does not currently run %s, which is where this player would normally go next season. The club can add that team, or place the player somewhere else.',
                         coalesce(v_norm.canonical_label, 'that team'));
    elsif v_move_req in ('not_permitted','external_approval_required') then
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_move.reason, 'This placement needs approval beyond the club.');
    elsif m.requires_manual_choice then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'The team itself has no automatic successor for the target season, so this player''s placement follows that review rather than rolling forward on its own.';
    else
      v_review := 'READY';
    end if;

    insert into public.age_grade_rollover_player_proposals (
      rollover_id, player_id, current_team_id, current_membership_id,
      proposed_team_id, proposed_canonical_team_type_id,
      regulatory_age_label, regulatory_status, normal_canonical_team_type_id,
      allocation_status, movement_requirement, dispensation_id, dispensation_outcome,
      review_state, reason
    ) values (
      r.id, m.player_id, m.team_id, m.membership_id,
      v_proposed_team, coalesce(v_proposed_type, v_norm.canonical_team_type_id),
      v_reg.regulatory_age_label, v_reg.status, v_norm.canonical_team_type_id,
      v_norm.allocation_status, v_move_req, v_disp.id, v_disp_outcome,
      v_review, v_reason
    )
    on conflict (rollover_id, player_id, current_team_id) do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$function$;

-- ============================================================
-- Changing the pathway changes what is true, so review follows.
-- ============================================================
--
-- A later correction to a player's pathway can change which age grade they
-- belong in. Undecided proposals are recomputed; a placement someone has
-- already decided or applied is left alone, and no membership moves on its
-- own. Historical fixtures and memberships are untouched -- this only affects
-- proposals for a season that has not happened yet.

create or replace function internal.player_pathway_refreshes_proposals()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rollover uuid;
begin
  if new.playing_pathway is distinct from old.playing_pathway then
    for v_rollover in
      select distinct pp.rollover_id
      from public.age_grade_rollover_player_proposals pp
      where pp.player_id = new.id
        and pp.selected_team_id is null
        and pp.placement_applied_at is null
    loop
      perform internal.refresh_rollover_player_proposals(v_rollover);
    end loop;
  end if;
  return null;
end;
$function$;

drop trigger if exists player_pathway_refreshes_proposals on public.players;
create trigger player_pathway_refreshes_proposals
  after update of playing_pathway on public.players
  for each row execute function internal.player_pathway_refreshes_proposals();

do $$
declare v_union uuid; v_alloc text; v_label text;
begin
  -- This one reads the function's own source, not the season register, so it
  -- holds on any database and runs first, unconditionally.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'generate_rollover_player_proposals_core') ~ 't\.gender' then
    raise exception 'The handover still reads a player''s classification from their team.';
  end if;

  -- The two pathway checks below ask the resolver to place a player in a REAL
  -- season, so they need a canonical season to ask about. Where the Seasons
  -- register has not been populated yet there is none, and the resolver
  -- correctly answers NEEDS_ATTENTION -- which this assertion would otherwise
  -- read as the pathway logic being broken when it is doing exactly the right
  -- thing. Inventing a season here to keep the check green would put a second
  -- answer to "which season is this" into the product, which is the one thing
  -- the canonical register exists to prevent.
  --
  -- So the checks run in full wherever a canonical season exists, and say so
  -- where the register is empty. Both states are held permanently by
  -- supabase/tests/season_register_boot_invariants.sql.
  select id into v_union from public.seasons
  where rugby_code = 'union' and not is_regression_fixture order by starts_on limit 1;

  if v_union is null then
    raise notice 'No canonical Union season is registered yet; the playing-pathway resolution checks in this migration were not evaluated. They are covered permanently by supabase/tests/season_register_boot_invariants.sql.';
    return;
  end if;

  -- The Ben case: U11, Union, no pathway recorded.
  select allocation_status, canonical_label into v_alloc, v_label
  from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '10 years')::date, null);
  if v_alloc <> 'NORMAL_PLACEMENT' then
    raise exception 'A mini-rugby age still fails without a pathway (got %).', v_alloc;
  end if;

  -- Past the Mixed band, a missing pathway must fail closed rather than default.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '13 years')::date, null);
  if v_alloc <> 'CLASSIFICATION_REQUIRED' then
    raise exception 'A missing pathway past the Mixed band did not fail closed (got %).', v_alloc;
  end if;
end $$;

-- ============================================================
-- Registration asks once, and the server enforces it.
-- ============================================================
--
-- The playing pathway is required when a guardian adds a child, validated
-- server-side rather than by an HTML attribute. It is asked at registration
-- rather than at the U12 boundary because every child reaches that boundary
-- eventually, and at that point Ovalball must not have to guess -- nor infer
-- it from whichever team they happen to have joined.
--
-- The parameter is added with a default so the existing five-argument
-- signature still resolves; passing nothing is then rejected by the check
-- above rather than silently creating an unclassifiable player.
CREATE OR REPLACE FUNCTION public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_candidate_team_count integer;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  -- Required at registration, and enforced here rather than in the browser.
  -- Asked once, now: every child eventually reaches the age where the boys'
  -- and girls' pathways separate, and at that point Ovalball must not have to
  -- guess -- nor infer it from whichever team they happen to have joined.
  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE', 'FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- INVITE-ONLY GUARD (Phase B).
  --
  -- Previously this function guarded only on "is signed in" and "club
  -- exists", then created a players row, a guardians row and a pending
  -- player_team_memberships row at ANY active club. That let an unrelated
  -- signed-in person invent a child at a club they have nothing to do with
  -- and declare themselves its guardian. The pending status meant no team
  -- authority followed, but the identity records were still created.
  --
  -- A guardian must now already have an authorised relationship with THIS
  -- club, by one of three routes:
  --
  --   1. they accepted a guardian invitation from this club
  --      (the canonical way a new parent arrives);
  --   2. they already guardian a player at this club
  --      (an existing parent adding a second child -- this is why existing
  --      users are not disrupted);
  --   3. they hold an active club membership here
  --      (club staff who are also a parent).
  --
  -- Authority is derived server-side from stable IDs. Nothing here trusts a
  -- club id merely because the client sent one.
  if not (
    exists (
      select 1 from public.guardian_invitations gi
      where gi.club_id = p_club_id
        and gi.accepted_by = auth.uid()
        and gi.status = 'accepted'
    )
    or exists (
      select 1
      from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id
      join public.teams t on t.id = ptm.team_id
      where g.guardian_user_id = auth.uid()
        and t.club_id = p_club_id
    )
    or exists (
      select 1 from public.club_memberships cm
      where cm.user_id = auth.uid()
        and cm.club_id = p_club_id
        and cm.status = 'active'
    )
  ) then
    raise exception 'You need an invitation from this club before you can add a child to it.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status in ('pending', 'active')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;
  if v_existing_player_id is not null then
    return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count >= 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  if v_match_count = 1 then
    select ptm.team_id into v_match_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = v_match_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_new_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_new_player_id, 'guardian', auth.uid());

  select count(*) into v_candidate_team_count
  from public.teams t
  where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

  if v_candidate_team_count = 1 then
    select t.id into v_candidate_team_id
    from public.teams t
    where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

    insert into public.player_team_memberships (player_id, team_id, status, created_by)
    values (v_new_player_id, v_candidate_team_id, 'pending', auth.uid());
    v_result := 'created_pending_team';
  else
    v_candidate_team_id := null;
    v_result := 'created_needs_club_review';
  end if;

  return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$function$

;
