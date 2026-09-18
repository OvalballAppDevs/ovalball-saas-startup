-- =====================================================================================================
-- SLICE 6b.2a -- the question underneath the session question
--
-- The 6b.2a contract migration (20270501000000) gave `public.record_email_delivery_result` a session
-- gate, which is what S6-9 required and all S6-9 required. Reviewing that work surfaced a different
-- defect in the same function, and it is worth being precise about the difference: a revoked or
-- suspended caller was already refused after 20270501000000. This is about the caller who is NOT
-- revoked, NOT suspended, and has no business here at all.
--
-- THE DEFECT
--
-- `record_email_delivery_result` is SECURITY DEFINER, so RLS never runs for it. It asked one question
-- -- is somebody signed in -- and then updated `public.email_deliveries` BY PRIMARY KEY. Any live,
-- ordinary, perfectly valid authenticated session that knew a delivery id could rewrite that row:
-- status, provider, provider reference, error code, error message, suppression reason, the attempt
-- counter and both timestamps.
--
-- Nothing leaks and no email is redirected. What breaks is the ledger. `email_deliveries` is what Site
-- Admin reads to answer "did that invitation go out, and what did the provider say" -- so being able to
-- write it means being able to make a failed delivery look sent, a sent one look failed, plant provider
-- text in a field an administrator reads, or inflate the attempt count that retry reasoning rests on.
-- A record that any signed-in person can edit is not a record.
--
-- THE AUTHORITY THAT ALREADY EXISTED, AND WAS NOT BEING USED
--
-- `email_deliveries.initiated_by` is an `auth.users` foreign key, and `public.claim_test_email_send`
-- has always set it from `auth.uid()`. The architecture already said what makes somebody legitimate:
-- THE CLAIM IS THE ESTABLISHING ACT, AND THE CLAIMANT OWNS THE DELIVERY. `lib/email/send.ts` does
-- exactly that in sequence -- claim, attempt, record -- and `claim_email_delivery`'s unique
-- `idempotency_key` is what makes one occurrence one delivery and, incidentally, what stops a claim
-- being taken off somebody.
--
-- So no role, capability or ownership rule is invented here. The two gaps are closed instead:
-- the ordinary claim path never wrote the claimant, and the result path never read it.
--
-- WHY NOT SOLVE THIS WITH EXECUTE PRIVILEGE
--
-- The tempting answer is that this is server-side code and should not be browser-callable at all. It is
-- server-side code -- `lib/email/send.ts` runs in Server Actions and route handlers -- but it reaches
-- the database through the REQUESTING PERSON'S session client, so PostgREST sees an ordinary
-- `authenticated` call and so does Postgres. Server location is not an authorisation boundary when an
-- authenticated browser can invoke the same RPC directly. Revoking EXECUTE from `authenticated` would
-- not harden the path, it would stop every email Ovalball sends. The boundary therefore belongs in the
-- database, bound to the claim.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
-- Retry semantics: the claimant may still record a result more than once and the attempt counter still
-- moves, because that is what the ledger is built on. Provider-message normalisation, suppression
-- reasons, delivery history and every user-visible email flow are untouched. Nothing here is an email
-- architecture change.
--
-- COMPATIBILITY, STATED HONESTLY
--
-- Rows claimed BEFORE this migration have a null `initiated_by` and no result can be recorded against
-- them afterwards. They are historical entries whose results were recorded long ago, so this costs
-- nothing -- except in one window: a delivery claimed in the seconds before the migration whose result
-- is recorded in the seconds after. That request would leave its row `queued` although the email did
-- go out. It is a single in-flight request at deploy time, it loses no email, and the alternative --
-- accepting a null claimant as a legitimate one -- would leave the defect open for every row that
-- already exists. No backfill is possible or attempted: who claimed those rows was never recorded,
-- and inventing an owner for them would be fabricating the very fact this migration exists to bind.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. The ordinary claim now records its claimant -- exactly as claim_test_email_send always has.
--    Server-derived from auth.uid(). There is no argument for it and there must never be one.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.claim_email_delivery(p_event_key text, p_idempotency_key text, p_occurrence_key text, p_recipient_kind text, p_recipient_ref uuid DEFAULT NULL::uuid, p_recipient_email text DEFAULT NULL::text, p_club_id uuid DEFAULT NULL::uuid, p_subject text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Email delivery may only be claimed by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_ref,
    recipient_email, club_id, subject, initiated_by
  )
  values (
    p_event_key, p_idempotency_key, p_occurrence_key, p_recipient_kind, p_recipient_ref,
    p_recipient_email, p_club_id, p_subject, auth.uid()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 2. So does the suppression path, so that "every delivery row knows who created it" is an invariant
--    rather than something true of two paths out of three.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.claim_disabled_email_suppression(p_event_key text, p_occurrence_key text, p_recipient_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'A suppression may only be claimed by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_email, subject, status,
    suppression_reason, initiated_by
  )
  values (
    p_event_key, p_occurrence_key, p_occurrence_key, p_recipient_kind, null, '(email channel disabled)', 'suppressed',
    'This email is currently switched off in Email Configuration.', auth.uid()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 3. And the result may only be recorded by the claimant.
--
-- One refusal for "not yours" and for "no such delivery" alike. A different message for a missing row
-- would turn this function into a way of asking which delivery ids are real, which is a small oracle
-- but an entirely unnecessary one.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.record_email_delivery_result(p_delivery_id uuid, p_status text, p_provider text DEFAULT NULL::text, p_provider_reference text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_suppression_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Email delivery results may only be recorded by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  -- THE CLAIM IS THE AUTHORITY. Completing a delivery is completing YOUR claim on it; the claimant was
  -- recorded server-side when the row was created and nothing the caller passes can influence this.
  if not exists (
    select 1 from public.email_deliveries d
     where d.id = p_delivery_id
       and d.initiated_by = auth.uid()
  ) then
    raise exception 'That delivery is not yours to record a result for.' using errcode = '42501';
  end if;

  update public.email_deliveries
  set status = p_status,
      provider = coalesce(p_provider, provider),
      provider_reference = coalesce(p_provider_reference, provider_reference),
      error_code = p_error_code,
      error_message = p_error_message,
      suppression_reason = p_suppression_reason,
      attempts = attempts + case when p_status in ('sent', 'failed') then 1 else 0 end,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = p_delivery_id
    and initiated_by = auth.uid();
end;
$function$;

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $$
declare v_result text; v_claim text; v_supp text;
begin
  select p.prosrc into v_result from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_email_delivery_result';
  select p.prosrc into v_claim from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='claim_email_delivery';
  select p.prosrc into v_supp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='claim_disabled_email_suppression';

  if v_result !~ 'initiated_by = auth\.uid\(\)' then
    raise exception 'Slice 6b.2a: recording a delivery result is not bound to the claimant';
  end if;
  if v_claim !~ 'initiated_by' or v_supp !~ 'initiated_by' then
    raise exception 'Slice 6b.2a: a claim path still creates a delivery row with no claimant, so the binding the result path reads would be null';
  end if;
  if v_result !~ 'require_live_session' or v_claim !~ 'require_live_session' or v_supp !~ 'require_live_session' then
    raise exception 'Slice 6b.2a: the session gate from 20270501000000 was dropped while rewriting these bodies';
  end if;
  -- The three functions must still be exactly as browser-reachable as they were: this migration is an
  -- authority fix, not a privilege change, and silently revoking EXECUTE would stop every Ovalball email.
  if not has_function_privilege('authenticated', 'public.record_email_delivery_result(uuid,text,text,text,text,text,text)', 'execute') then
    raise exception 'Slice 6b.2a: recording a result is no longer callable by the session that claimed it';
  end if;
  raise notice 'Slice 6b.2a: a delivery result now belongs to the session that claimed the delivery';
end $$;
