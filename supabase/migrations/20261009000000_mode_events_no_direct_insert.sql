-- Commercial Platform, Phase M -- closing a gap the RLS sweep found.
--
-- `platform_mode_events` had an INSERT policy gated on
-- `site.system.beta.manage`. At the time it was written (Phase C) that was
-- harmless: the table was the whole model, and a trigger derived
-- `previous_mode` so a direct insert could not forge a transition.
--
-- Phase D changed that. `public.set_platform_mode` now also pauses or
-- resumes every club's trial clock, and a direct INSERT skips it. The
-- result would be a platform that says it is in Beta while every trial
-- clock keeps running down — a club losing days it was promised it would
-- keep, with the mode history looking entirely correct.
--
-- The fix is to remove the policy. `set_platform_mode` is SECURITY DEFINER,
-- so it still writes; nothing else can. This is the same rule every other
-- money table already follows: the row is a consequence of a function, not
-- something a client writes.

drop policy if exists platform_mode_events_insert on public.platform_mode_events;

comment on table public.platform_mode_events is
  'Append-only history of Ovalball''s operating mode. No write policy of any kind: the only way in is public.set_platform_mode, which also pauses or resumes every club''s trial clock. A direct INSERT would change the mode without stopping those clocks.';
