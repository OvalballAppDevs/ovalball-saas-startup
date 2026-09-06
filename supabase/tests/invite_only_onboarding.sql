-- Phase B -- invite-only onboarding.
--
-- The invariant: authentication never grants a club or team relationship.
-- A guardian must have an authorised context at a club before they can add
-- a child to it, and existing guardians must not be disrupted by that rule.

begin;

do $$
declare
  v_club_a uuid;
  v_club_b uuid;
  v_dir_a uuid;
  v_dir_b uuid;
  v_team_a uuid;
  v_stranger uuid := gen_random_uuid();
  v_invited uuid := gen_random_uuid();
  v_existing uuid := gen_random_uuid();
  v_player uuid;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_stranger, 'stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_invited,  'invited@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_existing, 'existing@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- clubs derive their name from club_directory; directory_id is required.
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Invite Test Club A', 'union', 'England', 'England', 'manual', 'verified', 'invite-test-club-a')
  returning id into v_dir_a;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Invite Test Club B', 'union', 'England', 'England', 'manual', 'verified', 'invite-test-club-b')
  returning id into v_dir_b;

  insert into public.clubs (directory_id, slug, status)
  values (v_dir_a, 'invite-test-club-a', 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir_b, 'invite-test-club-b', 'active') returning id into v_club_b;

  -- gender left null: 'mixed' is only valid for U6-U11 (teams_gender_category_check).
  insert into public.teams (club_id, display_name, slug, category, age_group, rugby_code, active)
  values (v_club_a, 'Invite Test U12', 'invite-test-u12', 'youth', 'U12', 'union', true)
  returning id into v_team_a;

  -- ---------- 1. a stranger cannot add a child at a club ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  begin
    perform public.add_child_for_guardian('Strange', 'Child', (current_date - interval '11 years')::date, v_club_a, 'union');
    raise notice 'FAIL 1: a stranger added a child at a club they have no relationship with';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%invitation from this club%' then
      raise notice 'PASS 1: stranger rejected -- %', v_err;
    else
      raise notice 'FAIL 1: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 2. an accepted guardian invitation grants the context ----------
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, status, accepted_by, accepted_at)
  values (v_club_a, v_team_a, 'invited@ovalball-test.invalid', v_existing, 'accepted', v_invited, now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_invited, 'role','authenticated')::text, true);
  begin
    perform public.add_child_for_guardian('Invited', 'Child', (current_date - interval '11 years')::date, v_club_a, 'union');
    raise notice 'PASS 2: an invited guardian can add a child at the inviting club';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    raise notice 'FAIL 2: invited guardian was blocked -- %', v_err;
  end;

  -- ---------- 3. that invitation does NOT unlock a different club ----------
  begin
    perform public.add_child_for_guardian('Wrong', 'Club', (current_date - interval '11 years')::date, v_club_b, 'union');
    raise notice 'FAIL 3: an invitation to club A let a guardian add a child at club B';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%invitation from this club%' then
      raise notice 'PASS 3: club A invitation does not unlock club B';
    else
      raise notice 'FAIL 3: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 4. an existing guardian is not disrupted (adding a 2nd child) ----------
  insert into public.players (first_name, surname, date_of_birth)
  values ('Existing', 'Child', (current_date - interval '12 years')::date) returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
  values (v_existing, v_player, 'parent', 'active');
  insert into public.player_team_memberships (player_id, team_id, status)
  values (v_player, v_team_a, 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', v_existing, 'role','authenticated')::text, true);
  begin
    perform public.add_child_for_guardian('Second', 'Child', (current_date - interval '9 years')::date, v_club_a, 'union');
    raise notice 'PASS 4: an existing guardian at the club can still add another child';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    raise notice 'FAIL 4: existing guardian was disrupted -- %', v_err;
  end;

  -- ---------- 5. team membership is never self-granted as active ----------
  select not exists (
    select 1
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    where p.surname in ('Child')
      and p.first_name in ('Invited','Second')
      and ptm.status = 'active'
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 5: self-service add-child never produces an active team membership';
  else
    raise notice 'FAIL 5: an active team membership was self-granted';
  end if;

  -- ---------- 6. club_memberships still has no self-serve INSERT ----------
  select not exists (
    select 1 from pg_policy
    where polrelid = 'public.club_memberships'::regclass
      and polcmd = 'a'
      and pg_get_expr(polwithcheck, polrelid) like '%auth.uid()%'
      and pg_get_expr(polwithcheck, polrelid) not like '%is_site_admin%'
      and pg_get_expr(polwithcheck, polrelid) not like '%club_admin%'
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 6: club_memberships has no self-grant INSERT policy';
  else
    raise notice 'FAIL 6: a self-grant INSERT policy exists on club_memberships';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
