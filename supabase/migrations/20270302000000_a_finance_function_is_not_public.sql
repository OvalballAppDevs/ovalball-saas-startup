-- A signed-out caller should be refused before the function runs, not inside it.
--
-- cancel_club_platform_subscription and record_payment_refund are both
-- SECURITY DEFINER, and both are correct: each resolves the club, checks
-- internal.has_capability(...) or internal.is_site_admin(), and raises 42501
-- otherwise. Neither has an authorization defect and neither's logic is
-- touched here.
--
-- What they had was a grant nobody chose. PostgreSQL grants EXECUTE on a new
-- function to PUBLIC by default, so both showed `=X/postgres` in their ACL and
-- were therefore callable by `anon` -- one of them explicitly so. An anonymous
-- call was always rejected, but it was rejected by the function's own check
-- after entering a definer-rights function that can cancel a subscription or
-- write a refund. The privilege layer should be saying no first.
--
-- These two are named because they are the ones that move money. The default
-- PUBLIC grant is a repository-wide pattern rather than a mistake unique to
-- them, and narrowing it everywhere is a separate, larger piece of work -- it
-- would change the reachable surface of hundreds of functions at once and
-- deserves its own slice rather than riding along with a release fix.

revoke execute on function public.cancel_club_platform_subscription(uuid, text) from public;
revoke execute on function public.cancel_club_platform_subscription(uuid, text) from anon;
grant  execute on function public.cancel_club_platform_subscription(uuid, text) to authenticated, service_role;

revoke execute on function public.record_payment_refund(uuid, integer, text) from public;
revoke execute on function public.record_payment_refund(uuid, integer, text) from anon;
grant  execute on function public.record_payment_refund(uuid, integer, text) to authenticated, service_role;

-- Prove it at the privilege layer, in the migration: anon must be unable to
-- execute, and the roles that legitimately call these must still be able to.
do $$
declare
  v_cancel oid;
  v_refund oid;
begin
  select p.oid into v_cancel from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_club_platform_subscription';
  select p.oid into v_refund from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment_refund';

  if v_cancel is null or v_refund is null then
    raise exception 'Expected both finance functions to exist.';
  end if;

  if has_function_privilege('anon', v_cancel, 'EXECUTE') then
    raise exception 'anon can still execute cancel_club_platform_subscription.';
  end if;
  if has_function_privilege('anon', v_refund, 'EXECUTE') then
    raise exception 'anon can still execute record_payment_refund.';
  end if;

  if not has_function_privilege('authenticated', v_cancel, 'EXECUTE')
     or not has_function_privilege('service_role', v_cancel, 'EXECUTE') then
    raise exception 'cancel_club_platform_subscription is no longer reachable by a legitimate caller.';
  end if;
  if not has_function_privilege('authenticated', v_refund, 'EXECUTE')
     or not has_function_privilege('service_role', v_refund, 'EXECUTE') then
    raise exception 'record_payment_refund is no longer reachable by a legitimate caller.';
  end if;

  raise notice 'Finance functions: anon refused at the privilege layer; authenticated and service_role retained.';
end $$;
