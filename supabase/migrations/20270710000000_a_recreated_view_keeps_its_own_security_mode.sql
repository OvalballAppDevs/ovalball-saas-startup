-- FIX: `create or replace view` does not preserve a view's prior `security_invoker` setting -- it is
-- a view OPTION, not part of the view's query, and Postgres resets it to the default (owner-rights)
-- on any CREATE OR REPLACE. `notification_topic_settings` was deliberately set to
-- `security_invoker = true` when it was built; M7's `20270706000000` recreated it (to flip
-- `push_ready` from always-false to always-true) via CREATE OR REPLACE VIEW and silently regressed it
-- back to owner-rights. Caught by `supabase/tests/js/perimeter_manifest.test.mts`'s structural guard
-- against exactly this ("no unlisted owner-rights view"), not by inspection.
--
-- The view reads only catalogue/reference tables (notification_topics/notification_types/
-- email_events) with no row-level viewer filtering, so this was not an active data leak -- but it is
-- the same class of mistake the perimeter manifest exists to catch before it becomes one, and the
-- fix is the same going forward: any future CREATE OR REPLACE of this view must re-state
-- security_invoker explicitly, which this migration does with the ALTER VIEW form specifically so it
-- is not dependent on the CREATE statement's own options being remembered correctly next time either.

alter view public.notification_topic_settings set (security_invoker = true);
