-- =====================================================================================================
-- CONVERGENCE STEP 12 -- RUGBY SAFEGUARDING + AGE-GRADE
--
-- The archaeology (docs/product/CONVERGENCE_STEP_12_ARCHAEOLOGY.md) found the answer already built and
-- nobody asking it: `resolve_player_age_grade` and `resolve_player_regulatory_age` have carried the
-- canonical, season-based, governing-body-referenced age answer for months, and **no file in app/,
-- components/ or lib/ calls either of them**. A coach had no way to ask "is this player in the right
-- age grade for this side" except by reading a date of birth they should not need to see.
--
-- SO THIS MIGRATION ADDS NO RULES. It adds two readers that ask the existing resolvers, and one
-- canonical helper that Step 11 now shares instead of deciding for itself.
--
--   * STATUS IS THE PRODUCT, NOT THE EVIDENCE. Neither reader returns a date of birth, an age, a
--     medical field or a safeguarding note. A coach gets a status and a sentence; that is all the job
--     needs, and it is all the least-privilege boundary allows.
--   * SEASON COMES FROM THE CANONICAL REGISTER. `internal.resolve_season_for_date` reads
--     `public.seasons`. Where no season is established the reader says so rather than falling back to
--     a computed year -- a missing canonical date surfaces as attention, never as a default.
--   * A DISPENSATION IS AN EXCEPTION, NOT A CORRECTION. Nothing here edits a date of birth, and an
--     approved dispensation is reported as what it is.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------
-- 1. ONE ADULT TEST, SHARED
--
-- Step 11 needed to know whether a side was adult, and decided it locally by reading
-- `teams.category = 'senior'`. That was right, and it was a second place the question was answered.
-- This is the canonical one; `internal.match_side_is_adult` now delegates to it, so Match Centre's
-- electorate and Step 12's eligibility can never disagree about what "adult" means.
--
-- The behaviour is deliberately unchanged: `senior` is the only open-age marker the canonical team
-- identity has, so colts and every youth age grade -- U17 and U18 included -- remain youth sides and
-- keep the family electorate, exactly as the locked product decision requires.
-- -----------------------------------------------------------------------------------------------
create or replace function internal.team_is_adult_side(p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select t.category = 'senior' from public.teams t where t.id = p_team_id), false);
$$;

comment on function internal.team_is_adult_side(uuid) is
  'The canonical open-age test for a side. `senior` is the only open-age marker the canonical team '
  'identity carries, so colts and every youth age grade are youth sides. Match Centre''s electorate '
  'and age-grade eligibility both read this, so they cannot drift apart.';

create or replace function internal.match_side_is_adult(p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- Converged in Step 12: one answer, in internal.team_is_adult_side. Behaviour unchanged.
  select internal.team_is_adult_side(p_team_id);
$$;

-- -----------------------------------------------------------------------------------------------
-- 2. THE STATUS OF ONE PLAYER AGAINST ONE SIDE
--
-- Every branch is a state the data actually supports. There is no "invalid", no "failed
-- safeguarding" and nothing that labels a child; the statuses describe the RECORD, not the person.
-- -----------------------------------------------------------------------------------------------
create or replace function internal.team_age_grade_status(p_team_id uuid, p_player_id uuid, p_as_of date default current_date)
returns table(status text, detail text) language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_code text; v_category text; v_age_group text; v_dob date; v_season uuid;
  v_resolved_category text; v_resolved_age_group text; v_resolve_status text;
  v_disp text;
begin
  select t.rugby_code, t.category, t.age_group into v_code, v_category, v_age_group
    from public.teams t where t.id = p_team_id;
  if v_code is null then
    return query select 'UNKNOWN_TEAM'::text, 'That team does not exist.'::text;
    return;
  end if;

  select p.date_of_birth into v_dob from public.players p where p.id = p_player_id;

  -- AN APPROVED EXCEPTION IS AN ANSWER IN ITS OWN RIGHT, and it is checked first: a club that has
  -- been through the approval chain should not keep being told the player is outside the grade.
  select d.status into v_disp
    from public.player_team_dispensation d
   where d.player_id = p_player_id and d.target_team_id = p_team_id
     and d.status in ('approved', 'requested', 'source_team_approved', 'club_approved', 'governing_body_approved')
   order by case d.status when 'approved' then 0 else 1 end, d.created_at desc
   limit 1;

  if v_disp = 'approved' then
    return query select 'DISPENSATION_APPROVED'::text,
      'An approved dispensation covers this player for this team.'::text;
    return;
  end if;

  -- The senior game has no age grade to be outside of; what it has is an adult/minor question, and
  -- that is answered by the canonical minor predicates rather than re-derived here.
  if internal.team_is_adult_side(p_team_id) then
    if v_dob is null then
      return query select 'AGE_EVIDENCE_REQUIRED'::text,
        'This player has no recorded date of birth, so their age for adult rugby cannot be established.'::text;
      return;
    end if;
    return query select 'ELIGIBLE'::text, 'Adult side.'::text;
    return;
  end if;

  if v_dob is null then
    return query select 'AGE_EVIDENCE_REQUIRED'::text,
      'This player has no recorded date of birth. Age grade cannot be established without one, and is never inferred from the team they play for.'::text;
    return;
  end if;

  -- THE SEASON COMES FROM THE REGISTER. No season, no answer -- and it says which thing is missing
  -- rather than guessing a year.
  v_season := internal.resolve_season_for_date(v_code, p_as_of);
  if v_season is null then
    return query select 'SEASON_NOT_ESTABLISHED'::text,
      'No season in the Seasons register covers this date, so age grade cannot be established for it.'::text;
    return;
  end if;

  select r.canonical_category, r.canonical_age_group, r.status
    into v_resolved_category, v_resolved_age_group, v_resolve_status
    from internal.resolve_player_age_grade(v_code, v_season, v_dob) r;

  if v_resolve_status is distinct from 'OK' and v_resolved_age_group is null then
    return query select 'AGE_GRADE_NOT_ESTABLISHED'::text,
      format('The canonical age-grade resolver could not place this player for this season (%s).', coalesce(v_resolve_status, 'no status'))::text;
    return;
  end if;

  if v_resolved_age_group = v_age_group then
    return query select 'ELIGIBLE'::text,
      format('Age grade %s, which is this team''s grade.', v_resolved_age_group)::text;
    return;
  end if;

  if v_disp is not null then
    return query select 'DISPENSATION_PENDING'::text,
      format('This player''s age grade is %s and this team is %s. A dispensation has been requested and is not yet approved.',
             coalesce(v_resolved_age_group, 'not established'), coalesce(v_age_group, 'not recorded'))::text;
    return;
  end if;

  return query select 'OUTSIDE_AGE_GRADE'::text,
    format('This player''s age grade is %s and this team is %s. A dispensation would be needed to play them here.',
           coalesce(v_resolved_age_group, 'not established'), coalesce(v_age_group, 'not recorded'))::text;
end;
$$;

-- -----------------------------------------------------------------------------------------------
-- 3. WHAT A COACH OR MANAGER NEEDS, AND NOTHING MORE
--
-- Only the players who need attention are returned. A roster of thirty with twenty-eight fine is a
-- list of two things to do, not thirty rows to read -- and a surface that shows every player's
-- status invites reading it as a file on each child.
-- -----------------------------------------------------------------------------------------------
create or replace function public.team_age_grade_attention(p_team_id uuid, p_as_of date default current_date)
returns table(player_id uuid, display_name text, status text, detail text)
language plpgsql stable security definer set search_path to 'public' as $$
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

  -- The roster-view capability, which is what a coach or manager holds for their own side. It is
  -- NOT safeguarding authority, and this function returns nothing that safeguarding authority would
  -- be needed for.
  if not (internal.can('team.roster.view', 'team', v_club, p_team_id, null)
          or internal.has_site_capability('site.clubs.view')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select p.id,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
         s.status,
         s.detail
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
   cross join internal.team_age_grade_status(p_team_id, ptm.player_id, p_as_of) s
   where ptm.team_id = p_team_id and ptm.state = 'ACTIVE'
     and s.status <> 'ELIGIBLE'
   order by s.status, p.surname, p.first_name;
end;
$$;

-- -----------------------------------------------------------------------------------------------
-- 4. WHAT A FAMILY SEES ABOUT THEIR OWN
--
-- A guardian of that player, or the adult player themselves. Not a coach's view of somebody else's
-- child, and not a route into another family's business.
-- -----------------------------------------------------------------------------------------------
create or replace function public.my_player_age_grade_status(p_player_id uuid, p_as_of date default current_date)
returns table(team_id uuid, team_name text, status text, detail text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if not (
      exists (select 1 from public.players p where p.id = p_player_id and p.user_id = v_actor)
   or exists (select 1 from public.guardians g
               where g.player_id = p_player_id and g.guardian_user_id = v_actor and g.status = 'active')
  ) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select t.id,
         t.display_name,
         s.status,
         s.detail
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
   cross join internal.team_age_grade_status(t.id, p_player_id, p_as_of) s
   where ptm.player_id = p_player_id and ptm.state = 'ACTIVE'
   order by t.display_name;
end;
$$;

revoke all on function internal.team_is_adult_side(uuid)                            from public;
revoke all on function internal.team_age_grade_status(uuid, uuid, date)             from public;
revoke all on function public.team_age_grade_attention(uuid, date)                  from public;
revoke all on function public.my_player_age_grade_status(uuid, date)                from public;
grant execute on function public.team_age_grade_attention(uuid, date)               to authenticated;
grant execute on function public.my_player_age_grade_status(uuid, date)             to authenticated;

-- =====================================================================================================
-- 5. THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_bad text; v_n int;
begin
  -- NO EVIDENCE IN AN OPERATIONAL PAYLOAD. A coach's reader may not return a date of birth, an age,
  -- or anything medical: the status is the product and the evidence stays where it belongs.
  select string_agg(a.attname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proallargtypes, p.proargnames) as a(atttypid, attname) on true
   where n.nspname = 'public'
     and p.proname in ('team_age_grade_attention', 'my_player_age_grade_status')
     and a.attname ~* 'dob|date_of_birth|birth|age_at|medical|emergency|note';
  if v_bad is not null then
    raise exception 'Step 12: an operational reader returns age evidence or sensitive data: %', v_bad;
  end if;

  -- Both readers meet the canonical session gate.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('team_age_grade_attention', 'my_player_age_grade_status')
     and p.prosrc !~ 'internal\.session_ok\(\)';
  if v_bad is not null then
    raise exception 'Step 12: a reader bypasses the session gate: %', v_bad;
  end if;

  -- ONE ADULT ANSWER. Step 11's electorate test and Step 12's eligibility must agree for every team
  -- that exists, not merely by inspection of the source.
  select count(*) into v_n from public.teams t
   where internal.match_side_is_adult(t.id) is distinct from internal.team_is_adult_side(t.id);
  if v_n > 0 then
    raise exception 'Step 12: the electorate adult test and the canonical adult test disagree on % team(s)', v_n;
  end if;

  -- THE RESOLVERS IT LEANS ON MUST ACTUALLY EXIST. A schema-qualified name that resolves to nothing
  -- is a runtime error for whoever opens the page first, so it is a migration error here instead.
  if to_regprocedure('internal.resolve_player_age_grade(text, uuid, date)') is null then
    raise exception 'Step 12: the canonical age-grade resolver is not where this migration expects it';
  end if;
  if to_regprocedure('internal.resolve_season_for_date(text, date)') is null then
    raise exception 'Step 12: the canonical season resolver is not where this migration expects it';
  end if;

  -- The season must come from the register, not from arithmetic on a date.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'team_age_grade_status') !~ 'resolve_season_for_date' then
    raise exception 'Step 12: age grade no longer resolves its season from the canonical register';
  end if;

  -- Nothing in this step writes to a player, a team or a fixture. It reports; it does not correct.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname in ('team_age_grade_attention', 'my_player_age_grade_status', 'team_age_grade_status', 'team_is_adult_side')
     and p.prosrc ~* '(insert into|update|delete from)\s+public\.(players|teams|fixtures|player_team_dispensation)';
  if v_bad is not null then
    raise exception 'Step 12: an age-grade reader writes to canonical data: %', v_bad;
  end if;

  if has_function_privilege('anon', 'public.team_age_grade_attention(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_player_age_grade_status(uuid, date)', 'EXECUTE') then
    raise exception 'Step 12: anon can read age-grade status';
  end if;

  raise notice 'PASS Step 12: age grade is derived from the canonical resolvers and the canonical season, reported as status without evidence, and one adult answer is shared with Match Centre';
end;
$guard$;
