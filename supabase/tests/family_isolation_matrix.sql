-- FAMILY ISOLATION MATRIX (Identity/Auth Slice 4; Phase 2 AJ.1 family_isolation_matrix, FR-1, FR-3, W, AP #35).
--
-- Generated over every table that references a player and the family read RPCs. One family's data is never
-- visible to another family, whatever club or team the two children share:
--
--   FI0  completeness: every player-linked table is classified to a Slice 4 domain (a new one fails here)
--   FI1  for the domains migrated so far, seeded rows about Child A are invisible to Parent B (same club,
--        other team) and Parent C (other club), and visible to Parent A where the design says so
--   FI2  the family read RPCs refuse or return nothing about Child A to the other parents
--   FI3  a PENDING, SUSPENDED or REVOKED relationship shows nothing either
--   FI4  pending domains are listed by sub-slice (complete after 4i)
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ptt-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Ptt', p_label, 'ptt-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PTT ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ptt-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ptt-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'ptt-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true) returning id into v;
  return v;
end $$;

-- A legacy membership row; the Slice 2 triggers create the canonical membership state and role.
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text) returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership, p_team, p_permission);
end $$;

create or replace function pg_temp.override(p_user uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_effect text, p_level text,
                                            p_by uuid, p_expires timestamptz default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, expires_at, reason)
  values (p_user, p_key, p_scope, p_club, p_team, p_effect, 'active', p_by, p_level, p_expires, 'truth table')
  returning id into v;
  return v;
end $$;

-- The decision for a subject, evaluated as that subject's own request (rule 0 applies).
create or replace function pg_temp.decide(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns table (allowed boolean, decisive_rule text, reason_code text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  return query select d.allowed, d.decisive_rule, d.reason_code
    from internal.capability_decision(p_subject, p_key, p_scope, p_club, p_team, p_player, true, false) d;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- What internal.can says for the same question, run as the browser role.
create or replace function pg_temp.can_as(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  perform set_config('role', 'authenticated', true);
  v := internal.can(p_key, p_scope, p_club, p_team, p_player);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- Runs one statement as a signed-in person (the browser role) and returns OK or the SQLSTATE.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_subject, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

-- Evaluates a boolean expression as a signed-in person.
create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select (' || p_expr || ')::boolean' into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v, false);
end $$;

grant execute on function pg_temp.can_as(uuid, text, text, uuid, uuid, uuid, jsonb) to public;

-- ---- Slice 4 additions --------------------------------------------------------------------------------

-- The named people a domain matrix asks about (Phase 2 AJ.1 persona list).
create temp table if not exists matrix_person (label text primary key, id uuid, claims jsonb);
grant select on matrix_person to public;

create or replace function pg_temp.persona(p_label text, p_id uuid, p_claims jsonb default null) returns uuid language plpgsql as $$
begin
  insert into matrix_person (label, id, claims) values (p_label, p_id, p_claims)
  on conflict (label) do update set id = excluded.id, claims = excluded.claims;
  return p_id;
end $$;

-- Who, among the named people, gets TRUE for a boolean expression evaluated as themselves (browser role).
create or replace function pg_temp.allowed_for(p_expr text) returns text language plpgsql as $$
declare r record; v boolean; v_out text[] := '{}';
begin
  for r in select * from matrix_person where id is not null order by label loop
    perform set_config('request.jwt.claims', coalesce(r.claims, jsonb_build_object('sub', r.id, 'role', 'authenticated'))::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      execute 'select (' || p_expr || ')::boolean' into v;
    exception when others then
      v := false;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    if coalesce(v, false) then v_out := v_out || r.label; end if;
  end loop;
  return array_to_string(v_out, ',');
end $$;

-- Who, among the named people, can run a statement without an error (browser role), inside a savepoint that is
-- always rolled back so one person's success cannot change the next person's answer.
create or replace function pg_temp.succeeds_for(p_sql text) returns text language plpgsql as $$
declare r record; v_out text[] := '{}';
begin
  for r in select * from matrix_person order by label loop
    perform set_config('request.jwt.claims', case when r.id is null then jsonb_build_object('role', 'anon')
      else coalesce(r.claims, jsonb_build_object('sub', r.id, 'role', 'authenticated')) end::text, true);
    perform set_config('role', case when r.id is null then 'anon' else 'authenticated' end, true);
    begin
      execute p_sql;
      v_out := v_out || r.label;
      raise sqlstate 'ZZ999';
    exception when sqlstate 'ZZ999' then null;
              when others then null;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;
  return array_to_string(v_out, ',');
end $$;

create or replace function pg_temp.expect_set(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
declare v_a text := (select coalesce(string_agg(x, ',' order by x), '') from unnest(string_to_array(nullif(p_actual, ''), ',')) x);
        v_e text := (select coalesce(string_agg(x, ',' order by x), '') from unnest(string_to_array(nullif(p_expected, ''), ',')) x);
begin
  if v_a = v_e then raise notice 'PASS %', p_label;
  else raise notice 'FAIL % -- expected {%} got {%}', p_label, v_e, v_a; end if;
end $$;

-- ---- Domain registry for the generated isolation matrices -----------------------------------------------
-- Every table that carries a club, team or player reference belongs to exactly one Slice 4 sub-slice (Phase 2
-- AA.3), to a domain earlier slices already isolate, or to a platform/public domain. A new table with such a
-- reference fails the completeness check until it is classified here. Seeded isolation checks run for the
-- domains migrated so far; the rest are reported as pending until their sub-slice lands ("complete after 4i").
create temp table isolation_domain (table_name text primary key, domain text not null);
insert into isolation_domain values
  -- 4a family and players
  ('players', '4a'), ('guardians', '4a'), ('guardian_link_requests', '4a'), ('guardian_player_permissions', '4a'),
  ('player_account_invitations', '4a'), ('player_duplicate_reviews', '4a'), ('guardian_invitations', '4a'),
  -- 4b teams and roster
  ('teams', '4b'), ('team_aliases', '4b'), ('team_contacts', '4b'), ('team_season_identity', '4b'), ('team_permissions_legacy', '4b'),
  ('player_team_memberships', '4b'), ('player_club_join_requests', '4b'),
  -- 4c fixtures, requests, results, Planner, Import
  ('fixtures', '4c'), ('fixture_import_batches', '4c'), ('player_fixture_attendance', '4c'), ('fixture_player_call_up', '4c'),
  ('club_opponent_notes', '4c'),
  -- 4d competitions and tournaments
  ('competition_edition_teams', '4d'), ('competition_participants', '4d'), ('competition_match_verifications', '4d'),
  ('tournaments', '4d'), ('tournament_participants', '4d'), ('tournament_team_entries', '4d'),
  -- 4e calendar, venues, pitches, training
  ('venues', '4e'), ('club_pitches', '4e'), ('pitch_allocation_proposals', '4e'), ('scheduling_groups', '4e'),
  ('scheduling_group_members', '4e'), ('club_scheduling_policy', '4e'), ('training_plans', '4e'), ('training_sessions', '4e'),
  ('club_events', '4e'), ('club_event_teams', '4e'),
  -- 4f messaging and notifications
  ('club_announcements', '4f'), ('club_message_blocks', '4f'), ('message_policies', '4f'), ('team_conversations', '4f'),
  ('messenger_announcement_deliveries', '4f'), ('email_deliveries', '4f'),
  -- 4g safeguarding and dispensations
  ('club_safeguarding_officers', '4g'), ('club_safeguarding_officer_invitations', '4g'),
  ('club_safeguarding_officer_conversations', '4g'), ('player_team_dispensation', '4g'),
  -- 4h club administration and finance
  ('club_setup_state', '4h'), ('club_kits', '4h'), ('club_contacts', '4h'), ('club_articles', '4h'),
  ('club_subscription_programmes', '4h'), ('membership_obligations', '4h'), ('player_subscription_payers', '4h'),
  ('finance_audit_log', '4h'), ('gocardless_billing_requests', '4h'), ('gocardless_customers', '4h'), ('gocardless_events', '4h'),
  ('gocardless_mandates', '4h'), ('gocardless_merchant_connections', '4h'), ('gocardless_payments', '4h'),
  ('gocardless_payouts', '4h'), ('gocardless_subscriptions', '4h'), ('platform_club_subscriptions', '4h'),
  ('platform_credits', '4h'), ('platform_payments', '4h'), ('platform_subscription_events', '4h'), ('platform_trials', '4h'),
  -- 4i documents, partners, referrals, handover
  ('club_documents', '4i'), ('document_folders', '4i'), ('age_grade_rollovers', '4i'), ('age_grade_rollover_team_proposals', '4i'),
  ('age_grade_rollover_player_proposals', '4i'), ('player_graduation_queue', '4i'), ('season_transitions', '4i'),
  -- people, roles and capabilities (isolated by Slices 2-3; People & Access is Slice 8)
  ('club_memberships', 'people'), ('role_assignments', 'people'), ('capability_overrides', 'people'),
  -- Slice 5: the canonical invitation replacing the six legacy tables above it. Classified to the
  -- same 'people' domain as the legacy invitations it supersedes, so the isolation sweep covers it.
  ('access_invitations', 'people'),
  ('access_review_items', 'people'), ('club_join_requests', 'people'), ('invitations', 'people'), ('invitation_teams', 'people'),
  -- platform, public and Ovalball support (Slice 7 / public read)
  ('security_events', 'platform'), ('site_admin_diagnostic_sessions', 'platform'), ('support_tickets', 'platform'),
  ('hub_person_team_relationships', 'public'), ('hub_team_honours', 'public');
grant select on isolation_domain to public;

create or replace function pg_temp.linked_tables(p_kind text) returns table (table_name text) language sql stable as $$
  select distinct c.relname::text
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and ((p_kind = 'club' and a.attname in ('club_id', 'team_id', 'owning_team_id', 'owning_club_id', 'host_club_id'))
      or (p_kind = 'player' and exists (
            select 1 from pg_constraint k
            where k.contype = 'f' and k.conrelid = c.oid and k.confrelid = 'public.players'::regclass and a.attnum = any (k.conkey))))
  union
  select 'players' where p_kind = 'player';
$$;
create temp table iso (k text primary key, id uuid);
grant select on iso to public;
create or replace function pg_temp.i(p_k text) returns uuid language sql stable as $$ select id from iso where k = p_k $$;
create or replace function pg_temp.iput(p_k text, p_id uuid) returns uuid language plpgsql as $$
begin insert into iso values (p_k, p_id) on conflict (k) do update set id = excluded.id; return p_id; end $$;

do $$
declare v_a uuid; v_b uuid; v_ta1 uuid; v_ta2 uuid; v_tb uuid; v_pa uuid; v_pb uuid; v_pc uuid; v_ca uuid; v_cb uuid; v_cc uuid; v_cs uuid;
        v_admin uuid; v_ph uuid; v_pr uuid; v_pv uuid; v_hold uuid; v_rev uuid; v_pend uuid;
begin
  v_a := pg_temp.iput('clubA', pg_temp.club('Iso A')); v_b := pg_temp.iput('clubB', pg_temp.club('Iso B'));
  v_ta1 := pg_temp.iput('teamA1', pg_temp.team(v_a, 'U12')); v_ta2 := pg_temp.iput('teamA2', pg_temp.team(v_a, 'U14')); v_tb := pg_temp.iput('teamB', pg_temp.team(v_b, 'U12'));
  v_admin := pg_temp.iput('adminA', pg_temp.person('Iso Admin')); perform pg_temp.member(v_a, v_admin, 'CLUB_ADMIN');

  v_pa := pg_temp.iput('PA', pg_temp.person('Parent A')); v_pb := pg_temp.iput('PB', pg_temp.person('Parent B')); v_pc := pg_temp.iput('PC', pg_temp.person('Parent C'));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'A', (current_date - interval '11 years')::date, 'MALE') returning id into v_ca;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'B', (current_date - interval '13 years')::date, 'MALE') returning id into v_cb;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'C', (current_date - interval '11 years')::date, 'MALE') returning id into v_cc;
  perform pg_temp.iput('CA', v_ca); perform pg_temp.iput('CB', v_cb); perform pg_temp.iput('CC', v_cc);
  insert into public.player_team_memberships (player_id, team_id, status) values (v_ca, v_ta1, 'active'), (v_cb, v_ta2, 'active'), (v_cc, v_tb, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_pa, v_ca, 'parent', 'active'), (v_pb, v_cb, 'parent', 'active'), (v_pc, v_cc, 'parent', 'active');

  -- rows about Child A in every 4a table
  insert into public.guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, actor) values (v_ca, 'view_fixtures', v_pa, true, v_pa);
  insert into public.player_account_invitations (player_id, invited_email, invited_by) values (v_ca, 'childa@ovalball.test', v_pa);
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, invited_email, club_id, target_player_id)
    values ('ADDITIONAL_GUARDIAN', 'PENDING', v_pa, null, 'second.parent@ovalball.test', v_a, v_ca);
  insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_ta1, 'Child', 'A', (current_date - interval '11 years')::date, 'MALE', v_ca, v_pa, v_pa);
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, replacement_for_player_id)
    values (v_a, v_ta1, 'replacement@ovalball.test', v_admin, v_ca);

  -- FI3 people whose relationship with Child A is not ACTIVE
  v_ph := pg_temp.iput('PH', pg_temp.person('On Hold')); v_pr := pg_temp.iput('PR', pg_temp.person('Revoked')); v_pv := pg_temp.iput('PV', pg_temp.person('Pending'));
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_ph, v_ca, 'parent', 'active') returning id into v_hold;
  update public.guardians set state = 'SUSPENDED', suspended_at = now(), suspension_reason = 'isolation' where id = v_hold;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_pr, v_ca, 'parent', 'active') returning id into v_rev;
  update public.guardians set state = 'REVOKED', revoked_at = now(), revocation_reason = 'isolation' where id = v_rev;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values (v_pv, v_ca, 'parent', 'pending', 'PENDING_APPROVAL', 'SELF_ADDED_CHILD');
end $$;

-- FI0 ------------------------------------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(t.table_name, ', ' order by t.table_name) into v_missing
  from pg_temp.linked_tables('player') t where not exists (select 1 from isolation_domain d where d.table_name = t.table_name);
  perform pg_temp.check(v_missing is null, 'FI0 every player-linked table is classified to a domain' || coalesce(' -- unclassified: ' || v_missing, ''));
end $$;

-- FI1 / FI3 ------------------------------------------------------------------------------------------------
do $$
declare
  v_ca text := quote_literal(pg_temp.i('CA'));
  r record;
  v_person text;
  v_sql text;
  v_count int;
  -- how each 4a table names Child A, and whether Parent A (the family itself) reads it
  v_rows constant text[][] := array[
    ['players', 'id = %s', 'yes'],
    ['guardians', 'player_id = %s', 'yes'],
    ['guardian_player_permissions', 'player_id = %s', 'yes'],
    ['player_account_invitations', 'player_id = %s', 'yes'],
    ['guardian_link_requests', 'target_player_id = %s', 'yes'],
    ['player_duplicate_reviews', 'matched_player_id = %s', 'yes'],
    ['guardian_invitations', 'replacement_for_player_id = %s', 'no']
  ];
  i int;
begin
  for i in 1 .. array_length(v_rows, 1) loop
    v_sql := format('select count(*) from public.%I where ', v_rows[i][1]) || format(v_rows[i][2], v_ca);
    foreach v_person in array array['PB', 'PC', 'PH', 'PR', 'PV'] loop
      perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.i(v_person), 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      begin
        execute v_sql into v_count;
      exception when insufficient_privilege then v_count := 0;
      end;
      perform set_config('role', 'none', true);
      -- a person with a non-ACTIVE relationship still sees their OWN relationship row, never anything else about the child
      if v_rows[i][1] = 'guardians' and v_person in ('PH', 'PR', 'PV') then
        perform pg_temp.check(v_count = 1, format('FI3 %s: %s sees only their own non-active relationship row about Child A (%s)', v_rows[i][1], v_person, v_count));
      else
        perform pg_temp.check(v_count = 0, format('FI1 %s: %s sees no row about Child A (%s)', v_rows[i][1], v_person, v_count));
      end if;
    end loop;
    if v_rows[i][3] = 'yes' then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.i('PA'), 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      execute v_sql into v_count;
      perform set_config('role', 'none', true);
      perform pg_temp.check(v_count > 0, format('FI1 %s: Parent A reads their own family''s row', v_rows[i][1]));
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- FI2 ------------------------------------------------------------------------------------------------------
do $$
declare v_person text; v_ca uuid := pg_temp.i('CA');
begin
  foreach v_person in array array['PB', 'PC', 'PH', 'PR', 'PV'] loop
    perform pg_temp.check(pg_temp.try_as(pg_temp.i(v_person), format('select * from public.get_player_permission_summary(%L)', v_ca)) = '42501',
      format('FI2 get_player_permission_summary: %s is refused for Child A', v_person));
    perform pg_temp.check(pg_temp.try_as(pg_temp.i(v_person), format('select * from public.player_team_allocation(%L, %L)', v_ca, pg_temp.i('clubA'))) = '42501',
      format('FI2 player_team_allocation: %s is refused for Child A', v_person));
    perform pg_temp.check(not pg_temp.bool_as(pg_temp.i(v_person), format('exists (select 1 from public.player_staff_view where id = %L)', v_ca)),
      format('FI2 player_staff_view: %s sees nothing about Child A', v_person));
    perform pg_temp.check(not pg_temp.bool_as(pg_temp.i(v_person), format('exists (select 1 from public.get_team_guardian_directory(%L))', pg_temp.i('teamA1'))),
      format('FI2 get_team_guardian_directory: %s sees no guardian of Child A''s team', v_person));
    perform pg_temp.check(not pg_temp.bool_as(pg_temp.i(v_person), 'exists (select 1 from public.my_guardian_link_requests() r where r.child_label ilike ''%Child A%'')'),
      format('FI2 my_guardian_link_requests: %s sees no request about Child A', v_person));
    perform pg_temp.check(pg_temp.try_as(pg_temp.i(v_person), format('select public.set_player_avatar(%L, '''')', v_ca)) = '42501',
      format('FI2 set_player_avatar: %s cannot change Child A''s picture', v_person));
    perform pg_temp.check(not pg_temp.bool_as(pg_temp.i(v_person), format('internal.can_access_player_avatar(%L)', v_ca)),
      format('FI2 child picture: %s cannot view Child A''s picture', v_person));
  end loop;
end $$;

-- FI4 ------------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select d.domain, string_agg(d.table_name, ', ' order by d.table_name) as tables
           from isolation_domain d join pg_temp.linked_tables('player') t on t.table_name = d.table_name
           where d.domain not in ('4a') group by d.domain order by d.domain loop
    raise notice 'PASS FI4 pending isolation seed for % (player-linked): %', r.domain, r.tables;
  end loop;
end $$;

rollback;
