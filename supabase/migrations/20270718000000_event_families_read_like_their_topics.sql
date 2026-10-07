-- =====================================================================================================
-- THE EVENT-FAMILY CATALOGUE IS READ THE WAY ITS TOPICS ARE.
--
-- Found by aal_enforcement AE-H3 in the notification correctness pass: notification_events
-- (20270711000000) was granted to anon while carrying the restrictive session_ok_required policy, so
-- it was the one table where the session gate sat on a signed-out-readable table. Its siblings
-- notification_topics and notification_types are signed-in only, and nothing reads event families
-- signed out (they exist only to label a person's own preferences), so it matches them.
-- =====================================================================================================

revoke select on public.notification_events from anon;
