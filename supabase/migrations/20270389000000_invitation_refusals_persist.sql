-- =====================================================================================================
-- SLICE 5 (8/n) -- D-S5-AUTO-2: a refused redemption RETURNS, it does not raise
--
-- The defect this fixes is the M-5 lesson again, and it was load-bearing. redeem_invitation logged
-- every attempt into invitation_redemption_attempts and then raised the generic refusal -- and the
-- raise rolled the log entry back. Postgres has no autonomous transactions here, so:
--
--   * the rate limits in O.2 step 3 could never fire, because failures were never recorded;
--   * invitation.identity_mismatch and invitation.issuer_authority_lost were never written, so the
--     two events that exist to show an invitation being probed by the wrong person did not exist.
--
-- An attacker could therefore guess codes without limit and leave no trace, which is precisely what
-- the attempt table was added to prevent.
--
-- Refusals now RETURN {"outcome":"REFUSED","reason":...}. The transaction commits, so the attempt and
-- the event survive. Callers must treat a REFUSED outcome as a failure; the server action does, and
-- the matrix asserts the shape. Genuinely exceptional conditions -- not signed in, nothing supplied --
-- still raise, because there is no attempt to record and nothing to rate limit.
--
-- Alternatives rejected: dblink or pg_background to get an autonomous transaction (adds an extension
-- and a second connection to the most security-sensitive path in the slice); writing the attempt in a
-- BEFORE trigger on a side table (same rollback problem); keeping the raise and accepting no rate
-- limiting (abandons an O.2 requirement).
-- =====================================================================================================
do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';

  -- Each refusal becomes a return of the same generic shape. The reason is machine-readable for the
  -- server action and is NOT shown to the person: they always see the one generic sentence, so a
  -- prober cannot tell a revoked invitation from one that never existed.
  v := replace(v, E'raise exception ''%'', v_generic using errcode = ''P0001'';',
                  E'return jsonb_build_object(''outcome'',''REFUSED'',''message'',v_generic);');
  v := replace(v,
    E'raise exception ''Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.''\n        using errcode = ''23514'', hint = ''AGE_ELIGIBILITY_REQUIRED'';',
    E'return jsonb_build_object(''outcome'',''REFUSED'',''reason'',''AGE_ELIGIBILITY_REQUIRED'',''message'',''Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.'');');
  v := replace(v,
    E'raise exception ''You need to be an active member of that club before you can be its Safeguarding Officer.''\n        using errcode = ''23514'';',
    E'return jsonb_build_object(''outcome'',''REFUSED'',''reason'',''MEMBERSHIP_REQUIRED'',''message'',''You need to be an active member of that club before you can be its Safeguarding Officer.'');');

  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  -- Only the two genuinely exceptional conditions may still raise.
  if (select count(*) from regexp_matches(v, 'raise exception', 'g')) <> 3 then
    raise exception 'Slice 5: redeem_invitation should raise only for a missing session or missing input (found %).',
      (select count(*) from regexp_matches(v, 'raise exception', 'g'));
  end if;
  if v !~ 'You must be signed in' or v !~ 'Give a link or a code' then
    raise exception 'Slice 5: redeem_invitation lost one of its two legitimate raises.';
  end if;
end $$;
