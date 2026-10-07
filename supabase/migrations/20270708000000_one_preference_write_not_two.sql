-- FIX: migration 20270706000000 widened set_notification_preference from 3 to 4 parameters with
-- `create or replace`, which in Postgres creates a SECOND overload rather than replacing the
-- first one when the parameter list changes shape. That left two live overloads --
-- (text, boolean, boolean) and (text, boolean, boolean, boolean) -- and the existing web call site
-- (`packages/contracts/src/notifications/preferences.ts`) passes exactly the three original named
-- arguments, which now matches both: PostgREST would report "function is not unique" on every
-- in-app/email preference toggle. The same migration also never granted EXECUTE on the new
-- 4-argument overload at all, so a caller who DID pass all four got "permission denied" instead.
--
-- This is the same class of bug as the stray save_tournament overload earlier in this programme:
-- a superseded signature left behind instead of dropped. One function, one signature, same as
-- every other canonical RPC.

drop function if exists public.set_notification_preference(text, boolean, boolean);

revoke all on function public.set_notification_preference(text, boolean, boolean, boolean) from public;
grant execute on function public.set_notification_preference(text, boolean, boolean, boolean) to authenticated;
grant execute on function public.set_notification_preference(text, boolean, boolean, boolean) to service_role;
