-- Side Project 1 integration -- caught by running the Side Project's own
-- permanent gocardless_sibling_discount_regression.sql regression suite
-- (scenario 13/14) against this (Main) database.
--
-- internal.calculate_member_price was granted EXECUTE to `authenticated`
-- directly. It takes p_payer_user_id and p_player_id as explicit
-- parameters (not derived from auth.uid()), so any authenticated user
-- could call it directly with ANOTHER person's payer_user_id/player_id
-- to probe their sibling ordinal and pricing -- an information-disclosure
-- surface that was never actually needed: claim_responsible_payer and
-- preview_first_payment are both SECURITY DEFINER and execute with the
-- function OWNER's privileges for every internal call they make,
-- including this one -- the caller's own grant on this internal function
-- was never required for either of them to work.
-- `from authenticated` alone is a no-op here: Postgres grants EXECUTE to
-- the PUBLIC pseudo-role by default on every new function, and every
-- real role (including authenticated) implicitly inherits whatever
-- PUBLIC can do -- `public` must be named explicitly too.
revoke all on function internal.calculate_member_price(uuid, uuid, uuid, date) from public, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'internal.calculate_member_price(uuid, uuid, uuid, date)', 'EXECUTE') then
    raise exception 'Security regression: internal.calculate_member_price is still executable by authenticated after the lockdown fix.';
  end if;
end $$;
