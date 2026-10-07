-- =====================================================================================================
-- A DEVICE TOKEN IS NEVER READ BACK BY A BROWSER ROLE.
--
-- Found by the Slice 10 retirement guard during the notification correctness pass: it holds a hard zero
-- on any browser-reachable column named like a token or a secret, and `push_device_tokens.token` had a
-- SELECT grant for `authenticated` (20270706000000). RLS kept it to the caller's own rows, but nothing
-- needs to read it at all: the phone registers and removes its token only through
-- register_push_device_token / unregister_push_device_token, and delivery reads it server-side. So the
-- table becomes RPC-only, like its writes already were.
-- =====================================================================================================

revoke select on public.push_device_tokens from authenticated;
