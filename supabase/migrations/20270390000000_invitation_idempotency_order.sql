-- =====================================================================================================
-- SLICE 5 (9/n) -- D-S5-AUTO-3: "you have already accepted this" is answered before the state checks
--
-- A one-time invitation is REDEEMED after use, so the terminal-state check fired before the
-- per-person idempotency check and the person who had just accepted it was told, generically, that
-- the invitation could not be used. That is confusing for them and useless for support: the commonest
-- cause of a second click is a slow page or a back button.
--
-- Answering "you already accepted this" first is safe. It tells that person only what they already
-- did -- they are proven to be the redeemer by their own row in invitation_redemptions -- and it
-- reveals nothing to anyone else, because the lookup is keyed on (invitation, user) and a stranger
-- has no row. Everybody else still gets the one generic sentence.
--
-- Alternative rejected: leaving the order alone and having the server action guess from the refusal
-- (it cannot; the refusal is deliberately identical for every cause).
-- =====================================================================================================
do $$
declare v text; v_block text; v_anchor text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';

  v_block := E'  -- Step 11 (multi-use idempotency). A second redemption by the same person returns what they already\n'
          || E'  -- have rather than making a second request.\n'
          || E'  select r.id into v_existing from public.invitation_redemptions r\n'
          || E'   where r.invitation_id = v.id and r.user_id = v_actor;\n'
          || E'  if v_existing is not null then\n'
          || E'    return jsonb_build_object(''outcome'',''ALREADY_REDEEMED'',''invitation_id'',v.id,''kind'',v.kind);\n'
          || E'  end if;\n\n';

  if position(v_block in v) = 0 then
    raise exception 'Slice 5: could not find the idempotency block to move.';
  end if;
  v := replace(v, v_block, '');

  -- Put it immediately after the row is found and locked, before any terminal-state refusal.
  v_anchor := E'  -- Step 5. Missing, revoked, expired or used all give the SAME answer:';
  if position(v_anchor in v) = 0 then
    raise exception 'Slice 5: could not find the state-check anchor.';
  end if;
  v := replace(v, v_anchor, v_block || v_anchor);

  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if position('ALREADY_REDEEMED' in v) > position('Missing, revoked, expired or used' in v) then
    raise exception 'Slice 5: the idempotency answer still comes after the terminal-state refusal.';
  end if;
end $$;
