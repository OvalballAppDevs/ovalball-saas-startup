-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE E: `gocardless_payment_failed` could never be paired to
-- the live attention projection -- its payload carried obligation_id, not the player_id the family
-- money row (packages/contracts/src/attention/family.ts, family_subscription:<playerId>) is keyed
-- by. Proves the producer (apply_payment_status_transition, 20270712000000) now carries player_id,
-- and that the rest of its behaviour -- the audit log row and the obligation status transition --
-- is unchanged.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_payment_failed_notification_pairing.sql
--
-- Self-contained and rolled back.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

do $$
declare
  v_payer uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_dir uuid := gen_random_uuid();
  v_player uuid := gen_random_uuid();
  v_programme uuid;
  v_pricing uuid;
  v_subscriber uuid;
  v_obligation uuid;
  v_gc_payment_id text := 'PM_TEST_' || substr(gen_random_uuid()::text, 1, 8);
  v_data jsonb;
  v_obligation_status text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_payer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gc-payer-' || v_payer::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email) values (v_payer, 'GC', 'Payer', 'gc-payer-' || v_payer::text || '@ovalball.test');

  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir, 'GC Pairing Test Club', 'union', 'England', 'England', 'manual', 'gc pairing test club ' || v_dir::text, 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club, v_dir, 'gc-pairing-' || substr(v_club::text, 1, 8), 'active');
  insert into public.players (id, first_name, surname, date_of_birth, created_by, playing_pathway)
  values (v_player, 'GC', 'Player', '2015-01-01', v_payer, 'MALE');

  insert into public.club_subscription_programmes (id, club_id, enabled, created_by)
  values (gen_random_uuid(), v_club, true, v_payer) returning id into v_programme;
  insert into public.club_subscription_pricing (id, programme_id, amount_minor, effective_from, created_by)
  values (gen_random_uuid(), v_programme, 1500, current_date - 30, v_payer) returning id into v_pricing;
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (gen_random_uuid(), v_player, v_programme, v_payer, 'guardian', 'active', v_payer) returning id into v_subscriber;
  insert into public.membership_obligations (id, programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (gen_random_uuid(), v_programme, v_club, v_player, v_subscriber, v_pricing, date_trunc('month', current_date)::date, 1500, current_date, 'SUBMITTED')
  returning id into v_obligation;
  insert into public.gocardless_payments (id, club_id, obligation_id, gc_payment_id, gross_amount_minor, status)
  values (gen_random_uuid(), v_club, v_obligation, v_gc_payment_id, 1500, 'submitted');

  perform public.apply_payment_status_transition(v_gc_payment_id, 'failed', 'mandate_cancelled');

  select n.data into v_data from public.notifications n
  where n.user_id = v_payer and n.type = 'gocardless_payment_failed'
  order by n.created_at desc limit 1;

  perform pg_temp.check(v_data is not null, '1: the notification was created');
  perform pg_temp.check((v_data->>'player_id')::uuid = v_player, '2: its payload carries player_id, not just obligation_id');
  perform pg_temp.check((v_data->>'obligation_id')::uuid = v_obligation, '3: obligation_id is still carried too (unchanged)');

  select status into v_obligation_status from public.membership_obligations where id = v_obligation;
  perform pg_temp.check(v_obligation_status = 'FAILED', '4: the obligation status transition is unchanged');

  perform pg_temp.check(
    exists (select 1 from public.finance_audit_log where target_id = (select id from public.gocardless_payments where gc_payment_id = v_gc_payment_id) and action = 'payment_status_transition'),
    '5: the audit log write is unchanged');
end $$;

rollback;
