-- Phase F0 -- referral attribution and reconciliation integrity.
--
-- Covers the three defects the Site Admin Dashboard audit found (R-0
-- dropped capabilities, R-1 application-layer attribution, R-2 missing
-- expiry/acceptance semantics), the safe historical repair path, the
-- data-health detectors, and the authorization boundary around both.
--
-- Wrapped in begin/rollback: this suite leaves the database exactly as it
-- found it.

begin;

do $$
declare
  v_owner    uuid := gen_random_uuid();   -- Full Site Admin
  v_viewer   uuid := gen_random_uuid();   -- Site Admin, view_commercial only
  v_admin_a  uuid := gen_random_uuid();   -- Club Admin, referring club A
  v_secretary uuid := gen_random_uuid();  -- Fixture Secretary at club A
  v_admin_d  uuid := gen_random_uuid();   -- Club Admin, unrelated club D
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid; v_dir_e uuid; v_dir_f uuid;
  v_club_a uuid; v_club_b uuid; v_club_d uuid;
  v_inv uuid; v_inv_dupe uuid; v_inv_expired uuid; v_inv_hist uuid;
  v_inv_amb1 uuid; v_inv_amb2 uuid;
  v_club_hist uuid; v_club_amb uuid; v_club_exp uuid;
  v_claim uuid;
  v_ref uuid; v_ref2 uuid;
  v_count int; v_int int; v_text text; v_text2 text; v_err text;
  v_ok boolean;
  v_before int; v_after int;
  v_key text;
  v_missing text;
  v_baseline_rewards int;
  v_baseline_qualified int;
begin
  select count(*) into v_baseline_rewards from public.platform_credits where source = 'referral_reward';
  select count(*) into v_baseline_qualified from public.platform_referrals where status = 'qualified';
  -- =================== fixtures ===================
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_owner,     'f0owner@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_viewer,    'f0viewer@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_admin_a,   'f0admina@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_secretary, 'f0sec@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_admin_d,   'f0admind@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');
  insert into public.site_admins (user_id, admin_role, status, view_commercial)
  values (v_viewer, 'read_only', 'active', true);

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('F0 Referrer RUFC', 'union','England','England','manual','verified','f0-referrer'),
    ('F0 Referred RUFC', 'union','England','England','manual','verified','f0-referred'),
    ('F0 Expired RUFC',  'union','England','England','manual','verified','f0-expired'),
    ('F0 Unrelated RUFC','union','England','England','manual','verified','f0-unrelated'),
    ('F0 Historic RUFC', 'union','England','England','manual','verified','f0-historic'),
    ('F0 Ambiguous RUFC','union','England','England','manual','verified','f0-ambiguous');

  select id into v_dir_a from public.club_directory where normalized_key='f0-referrer';
  select id into v_dir_b from public.club_directory where normalized_key='f0-referred';
  select id into v_dir_c from public.club_directory where normalized_key='f0-expired';
  select id into v_dir_d from public.club_directory where normalized_key='f0-unrelated';
  select id into v_dir_e from public.club_directory where normalized_key='f0-historic';
  select id into v_dir_f from public.club_directory where normalized_key='f0-ambiguous';

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'f0-referrer', 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_d, 'f0-unrelated', 'active') returning id into v_club_d;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a,   'CLUB_ADMIN', 'active'),
    (v_club_a, v_secretary, 'FIXTURE_SECRETARY', 'active'),
    (v_club_d, v_admin_d,   'CLUB_ADMIN', 'active');

  -- ---------- R-0. every capability a CLUB_ADMIN must hold resolves ----------
  -- The guard against a tenth stale re-declaration of
  -- internal.has_club_role_capability silently disabling a product area.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  v_missing := null;
  foreach v_key in array array[
    'club.referrals.view', 'club.referrals.manage',
    'club.platform_billing.view', 'club.platform_billing.manage',
    'club.training.manage', 'club.teams.manage', 'club.edit_profile',
    'club.gocardless.connect', 'club.subscription.configure'
  ] loop
    if not internal.has_club_role_capability(v_club_a, v_key) then
      v_missing := concat_ws(', ', v_missing, v_key);
    end if;
  end loop;
  if v_missing is null then
    raise notice 'PASS 1 (R-0): every commercial and training capability resolves for a Club Admin';
  else
    raise notice 'FAIL 1 (R-0): Club Admin is missing capabilities: %', v_missing;
  end if;

  -- ---------- A. the normal path creates the referral exactly once ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  v_inv := public.create_partner_invitation(v_club_a, v_dir_b, 'B Secretary', 'b@f0-test.invalid');

  select count(*) into v_count from public.platform_referrals where invitation_id = v_inv;
  select attribution_source into v_text from public.platform_referrals where invitation_id = v_inv;
  if v_count = 1 and v_text = 'invitation' then
    raise notice 'PASS 2 (A): creating an invitation creates exactly one referral, in the same transaction';
  else
    raise notice 'FAIL 2 (A): % referral row(s), source=%', v_count, coalesce(v_text,'<null>');
  end if;

  -- ---------- B. the application retry does not duplicate ----------
  select id into v_ref from public.platform_referrals where invitation_id = v_inv;
  perform public.claim_club_referral(v_inv);
  perform public.claim_club_referral(v_inv);
  select count(*) into v_count from public.platform_referrals where invitation_id = v_inv;
  select id into v_ref2 from public.platform_referrals where invitation_id = v_inv;
  if v_count = 1 and v_ref = v_ref2 then
    raise notice 'PASS 3 (B): the legacy application-layer claim is idempotent and returns the same referral';
  else
    raise notice 'FAIL 3 (B): % rows after retries', v_count;
  end if;

  -- ---------- H. referral uniqueness is structural ----------
  begin
    insert into public.platform_referrals (invitation_id, referring_club_id) values (v_inv, v_club_d);
    raise notice 'FAIL 4 (H): a second referral was accepted for one invitation';
  exception when unique_violation then
    raise notice 'PASS 4 (H): one invitation can carry only one referral';
  end;

  -- ---------- a Fixture Secretary's invitation also attributes ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary, 'role','authenticated')::text, true);
  v_inv_dupe := public.create_partner_invitation(v_club_a, v_dir_c, 'C Secretary', 'c@f0-test.invalid');
  select count(*) into v_count from public.platform_referrals where invitation_id = v_inv_dupe;
  if v_count = 1 then
    raise notice 'PASS 5: an invitation sent by a Fixture Secretary still attributes to their club';
  else
    raise notice 'FAIL 5: % referral rows for a fixture-secretary invitation', v_count;
  end if;

  -- but the explicit claim RPC still requires club.referrals.manage
  begin
    perform public.claim_club_referral(v_inv_dupe);
    raise notice 'FAIL 6: a Fixture Secretary could call claim_club_referral directly';
  exception when insufficient_privilege then
    raise notice 'PASS 6: claim_club_referral still requires club.referrals.manage';
  end;

  -- ---------- C. an invitation live when the club acted stays attributable ----------
  -- Sent 20 days ago with the standard 14-day window, so it lapsed BEFORE
  -- reconciliation runs -- but the club submitted its claim on day 3.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  insert into public.club_ovalball_invitations
    (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, created_at, expires_at)
  values (v_club_a, v_dir_e, 'Historic Secretary', 'hist@f0-test.invalid', v_admin_a,
          now() - interval '20 days', now() - interval '6 days')
  returning id into v_inv_hist;
  perform internal.ensure_club_referral(v_inv_hist, 'invitation', v_admin_a);

  insert into public.clubs (directory_id, slug, status) values (v_dir_e, 'f0-historic', 'active') returning id into v_club_hist;
  perform internal.reconcile_partner_invitations(v_dir_e, v_club_hist, now() - interval '17 days');

  select status into v_text from public.club_ovalball_invitations where id = v_inv_hist;
  select status into v_text2 from public.platform_referrals where invitation_id = v_inv_hist;
  if v_text = 'accepted' and v_text2 = 'registered' then
    raise notice 'PASS 7 (C): an invitation live when the club claimed stays attributable after it lapses';
  else
    raise notice 'FAIL 7 (C): invitation=%, referral=%', v_text, v_text2;
  end if;

  -- and the partnership it should have produced exists
  select count(*) into v_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least(v_club_a, v_club_hist)
    and greatest(requesting_club_id, partner_club_id) = greatest(v_club_a, v_club_hist);
  if v_count = 1 then
    raise notice 'PASS 8 (C): the partnership is created too -- R-2 destroyed both, not just the referral';
  else
    raise notice 'FAIL 8 (C): % partnership rows', v_count;
  end if;

  -- ---------- D. an invitation that lapsed BEFORE the club acted does not ----------
  insert into public.club_ovalball_invitations
    (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, created_at, expires_at)
  values (v_club_d, v_dir_f, 'Late Secretary', 'late@f0-test.invalid', v_admin_d,
          now() - interval '90 days', now() - interval '76 days')
  returning id into v_inv_expired;

  insert into public.clubs (directory_id, slug, status) values (v_dir_f, 'f0-ambiguous', 'active') returning id into v_club_exp;
  -- The club claimed 10 days ago -- long after the invitation had lapsed.
  perform internal.reconcile_partner_invitations(v_dir_f, v_club_exp, now() - interval '10 days');

  select status into v_text from public.club_ovalball_invitations where id = v_inv_expired;
  select status into v_text2 from public.platform_referrals where invitation_id = v_inv_expired;
  if v_text <> 'accepted' and coalesce(v_text2,'none') <> 'registered' then
    raise notice 'PASS 9 (D): an invitation that had already lapsed does not become a successful referral';
  else
    raise notice 'FAIL 9 (D): invitation=%, referral=%', v_text, coalesce(v_text2,'none');
  end if;

  -- ---------- the expiry sweep marks it, and only it ----------
  select internal.expire_due_club_ovalball_invitations() into v_int;
  select status into v_text from public.club_ovalball_invitations where id = v_inv_expired;
  select status into v_text2 from public.club_ovalball_invitations where id = v_inv;
  if v_text = 'expired' and v_text2 = 'pending' then
    raise notice 'PASS 10: the expiry sweep marks lapsed invitations and leaves live ones alone';
  else
    raise notice 'FAIL 10: lapsed=%, live=%', v_text, v_text2;
  end if;

  -- ---------- N. the missing-attribution detector ----------
  -- Simulate exactly the pre-fix damage: an accepted invitation, a real
  -- club, and no referral row.
  insert into public.club_ovalball_invitations
    (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status, accepted_at)
  values (v_club_d, v_dir_b, 'Orphaned Secretary', 'orphan@f0-test.invalid', v_admin_d, 'accepted', now())
  returning id into v_inv_amb1;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'f0-referred', 'active') returning id into v_club_b;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  select missing_attribution into v_int from public.referral_data_health();
  if v_int >= 1 then
    raise notice 'PASS 11 (N): the missing-attribution detector finds an accepted invitation with no referral';
  else
    raise notice 'FAIL 11 (N): detector returned %', v_int;
  end if;

  -- ---------- E. an unambiguous historical gap is repaired ----------
  select count(*) into v_before from public.platform_referrals where invitation_id = v_inv_amb1;
  perform public.reconcile_referral_attribution(false);
  select count(*) into v_after from public.platform_referrals where invitation_id = v_inv_amb1;
  select attribution_source into v_text from public.platform_referrals where invitation_id = v_inv_amb1;
  if v_before = 0 and v_after = 1 and v_text = 'reconciliation' then
    raise notice 'PASS 12 (E): an unambiguous historical gap is repaired and marked as reconciled';
  else
    raise notice 'FAIL 12 (E): before=%, after=%, source=%', v_before, v_after, coalesce(v_text,'<null>');
  end if;

  -- ---------- G. reconciliation is idempotent ----------
  select count(*) into v_before from public.platform_referrals;
  perform public.reconcile_referral_attribution(false);
  perform public.reconcile_referral_attribution(false);
  select count(*) into v_after from public.platform_referrals;
  if v_before = v_after then
    raise notice 'PASS 13 (G): repeated reconciliation creates nothing further';
  else
    raise notice 'FAIL 13 (G): referral count moved from % to %', v_before, v_after;
  end if;

  -- ---------- F. ambiguity is never guessed ----------
  -- A second club also holds an accepted invitation to the same directory
  -- club, and neither has a referral.
  delete from public.platform_referrals where invitation_id = v_inv_amb1;
  insert into public.club_ovalball_invitations
    (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status, accepted_at)
  values (v_club_a, v_dir_b, 'Rival Secretary', 'rival@f0-test.invalid', v_admin_a, 'accepted', now())
  returning id into v_inv_amb2;

  select count(*) into v_count
  from public.reconcile_referral_attribution(false)
  where category = 'requires_review' and finding = 'ambiguous_referrer';
  select count(*) into v_after from public.platform_referrals where invitation_id in (v_inv_amb1, v_inv_amb2);
  if v_count = 2 and v_after = 0 then
    raise notice 'PASS 14 (F): two competing referrers are reported for review, and neither is attributed';
  else
    raise notice 'FAIL 14 (F): % review rows, % referrals created', v_count, v_after;
  end if;
  delete from public.club_ovalball_invitations where id = v_inv_amb2;

  -- ---------- L. the orphan-reward detector ----------
  -- Measured as a delta: this local database may already contain orphan
  -- reward credits of its own, and the assertion must prove the detector
  -- responds to THIS probe rather than to pre-existing noise.
  select reward_without_referral into v_before from public.referral_data_health();
  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club_a, 1500, 'referral_reward', 'F0 orphan probe', 'standard', 1500, 1);
  select reward_without_referral into v_after from public.referral_data_health();
  if v_after = v_before + 1 then
    raise notice 'PASS 15 (L): the orphan-reward detector finds a referral_reward credit no referral owns';
  else
    raise notice 'FAIL 15 (L): detector went from % to %, expected +1', v_before, v_after;
  end if;

  -- and reconciliation reports it without touching it
  select count(*) into v_count from public.reconcile_referral_attribution(false)
  where category = 'unresolvable' and finding = 'reward_credit_without_referral';
  select count(*) into v_after from public.platform_credits where reason = 'F0 orphan probe';
  if v_count >= 1 and v_after = 1 then
    raise notice 'PASS 16: an orphan reward credit is reported as unresolvable and never deleted';
  else
    raise notice 'FAIL 16: % reports, % credit rows remain', v_count, v_after;
  end if;

  -- ---------- M. qualified-without-reward is structurally impossible ----------
  -- The detector exists as defence in depth, but the state it looks for
  -- cannot be reached: platform_referrals_qualified_has_reward already
  -- guarantees that 'qualified' implies a reward credit, a qualifying
  -- payment and a qualified_at. Assert the constraint, not a forgery.
  begin
    update public.platform_referrals
    set status = 'qualified', reward_credit_id = null, qualifying_payment_id = null, qualified_at = now()
    where invitation_id = v_inv;
    raise notice 'FAIL 17 (M): a referral reached qualified with no reward credit';
  exception when check_violation then
    raise notice 'PASS 17 (M): a referral cannot be qualified without a reward credit -- the constraint holds';
  end;

  select qualified_without_reward into v_int from public.referral_data_health();
  if v_int = 0 then
    raise notice 'PASS 18 (M): the qualified-without-reward detector reads zero, as the constraint guarantees';
  else
    raise notice 'FAIL 18 (M): detector returned % despite the check constraint', v_int;
  end if;

  -- status must be ACTION REQUIRED while the orphan reward credit stands
  select status into v_text from public.referral_data_health();
  if v_text = 'ACTION REQUIRED' then
    raise notice 'PASS 19: data health reads ACTION REQUIRED while a money anomaly exists';
  else
    raise notice 'FAIL 19: status = %', v_text;
  end if;

  -- The probe credit cannot be removed, and that is the correct behaviour:
  -- the credit ledger is append-only, which is exactly why reconciliation
  -- reports an orphan reward rather than tidying it away.
  begin
    delete from public.platform_credits where reason = 'F0 orphan probe';
    raise notice 'FAIL 20: a referral reward credit was deleted from the ledger';
  exception when others then
    raise notice 'PASS 20: the credit ledger is append-only -- an orphan reward cannot be deleted away';
  end;

  -- ---------- Q. no token or contact email is ever returned ----------
  select count(*) into v_count
  from public.referral_data_health_detail() d
  where d.detail ilike '%@%' or d.detail ~ '[0-9a-f]{40,}';
  if v_count = 0 then
    raise notice 'PASS 20 (Q): data-health detail leaks no email address and no invitation token';
  else
    raise notice 'FAIL 20 (Q): % detail rows contain an email or token-shaped string', v_count;
  end if;

  -- the function shape itself carries no such column
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'platform_referrals'
    and column_name in ('token', 'contact_email');
  if v_count = 0 then
    raise notice 'PASS 21 (Q): no token or contact email was copied onto the referral record';
  else
    raise notice 'FAIL 21 (Q): referral table gained a token/email column';
  end if;

  -- ---------- O. unauthorized reconciliation is blocked ----------
  -- A Site Admin with view_commercial but not full: site.commercial.manage
  -- is non-delegable, so repair must refuse.
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role','authenticated')::text, true);
  begin
    perform public.reconcile_referral_attribution(true);
    raise notice 'FAIL 22 (O): a non-full Site Admin ran referral reconciliation';
  exception when insufficient_privilege then
    raise notice 'PASS 22 (O): referral reconciliation requires the non-delegable site.commercial.manage';
  end;

  -- but that same admin can read health, because they hold view_commercial
  begin
    select status into v_text from public.referral_data_health();
    raise notice 'PASS 23: a commercial-view Site Admin can read referral data health';
  exception when insufficient_privilege then
    raise notice 'FAIL 23: view_commercial was refused referral data health';
  end;

  -- ---------- P. a Club Admin gets nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  begin
    perform public.referral_data_health();
    raise notice 'FAIL 24 (P): a Club Admin read Site Admin referral health';
  exception when insufficient_privilege then
    raise notice 'PASS 24 (P): a Club Admin cannot read referral data health';
  end;

  begin
    perform public.referral_data_health_detail();
    raise notice 'FAIL 25 (P): a Club Admin read referral health detail';
  exception when insufficient_privilege then
    raise notice 'PASS 25 (P): a Club Admin cannot read referral health detail';
  end;

  begin
    perform public.reconcile_referral_attribution(true);
    raise notice 'FAIL 26 (P): a Club Admin ran referral reconciliation';
  exception when insufficient_privilege then
    raise notice 'PASS 26 (P): a Club Admin cannot run referral reconciliation';
  end;

  -- ---------- I / J. reward still requires a collected payment ----------
  -- Compared against v_baseline_qualified (captured before this suite did
  -- anything), not an absolute zero -- a real, legitimately qualified
  -- referral may already exist in this shared dev database (e.g. Dashboard
  -- R-5 UAT fixtures) with a real collected payment behind it. What this
  -- assertion actually guards is that THIS suite's own scenario never
  -- qualifies a referral through attribution/reconciliation alone.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  select count(*) into v_count from public.platform_referrals where status = 'qualified';
  if v_count = v_baseline_qualified then
    raise notice 'PASS 27 (I/J): nothing in F0 qualified a referral -- attribution never pays a reward';
  else
    raise notice 'FAIL 27 (I/J): qualified count went from % to % -- % referral(s) reached qualified without a collected payment', v_baseline_qualified, v_count, v_count - v_baseline_qualified;
  end if;

  -- Every reward credit now present must be either pre-existing local data
  -- (captured in v_baseline_rewards before this suite did anything) or the
  -- single orphan probe inserted deliberately at assertion 15. Attribution
  -- and reconciliation must have produced none of their own.
  select count(*) into v_count from public.platform_credits where source = 'referral_reward';
  if v_count = v_baseline_rewards + 1 then
    raise notice 'PASS 28 (J): no reward credit was issued by attribution or reconciliation';
  else
    raise notice 'FAIL 28 (J): reward credits went from % to %, expected only the +1 probe', v_baseline_rewards, v_count;
  end if;

  -- Beta is still Beta, and a cycle still cannot open.
  if coalesce(internal.current_platform_mode(), 'beta') = 'beta' then
    raise notice 'PASS 29 (J): the platform is still in Beta -- F0 did not switch it';
  else
    raise notice 'FAIL 29 (J): platform mode is %', internal.current_platform_mode();
  end if;

  -- ---------- no second referral store ----------
  -- BASE TABLE only -- see platform_referrals.sql's identical assertion for
  -- why a read-only reporting VIEW (Dashboard R-5's admin_referral_overview)
  -- must not be counted here.
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public' and table_name like '%referral%' and table_type = 'BASE TABLE';
  if v_count = 1 then
    raise notice 'PASS 30: still exactly one referral table -- no second referral system was created';
  else
    raise notice 'FAIL 30: % referral tables exist', v_count;
  end if;

  -- ---------- audit trail ----------
  select count(*) into v_count from public.audit_log
  where table_name = 'platform_referrals' and action = 'insert';
  if v_count >= 1 then
    raise notice 'PASS 31: referral creation and repair are recorded in audit_log';
  else
    raise notice 'FAIL 31: no audit_log rows for referral inserts';
  end if;

  select count(distinct attribution_source) into v_count from public.platform_referrals;
  if v_count >= 2 then
    raise notice 'PASS 32: automatic and reconciled attribution are distinguishable';
  else
    raise notice 'FAIL 32: only % attribution source(s) present', v_count;
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
