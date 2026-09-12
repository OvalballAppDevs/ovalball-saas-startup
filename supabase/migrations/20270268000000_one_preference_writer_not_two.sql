-- =====================================================================
-- ONE PREFERENCE WRITER, NOT TWO
--
-- 20270263000000 taught set_notification_preference about the email
-- channel by adding a third argument. `create or replace function` cannot
-- replace a function whose SIGNATURE changed, so it did the only thing it
-- could: it created a SECOND function and left the original
-- (text, boolean) in place.
--
-- PostgREST resolves an RPC by the argument names present in the request
-- body, and the two overloads then split the traffic in a way that looks
-- deliberate and is not:
--
--   {topic, email}          -> only the 3-arg form has p_email_enabled,
--                              so email preferences saved correctly.
--
--   {topic, in_app}         -> matches BOTH the old 2-arg form and the new
--                              3-arg form (whose third argument defaults),
--                              so PostgREST could not choose a candidate
--                              and refused the call.
--
-- The visible result was a switch that flipped, reverted a moment later,
-- and never wrote anything: every in-app notification preference has been
-- unsaveable since that migration, while the email switch beside it worked.
-- The optimistic toggle made it look momentarily successful, which is why
-- it survived a browser check that did not read the row back.
--
-- Dropping the superseded overload is the whole fix. The 3-arg form takes
-- the same two arguments the old one did, with the third defaulting to
-- null, so every existing caller keeps working -- there is simply one
-- function to resolve instead of an ambiguous pair.
-- =====================================================================

drop function if exists public.set_notification_preference(text, boolean);

comment on function public.set_notification_preference(text, boolean, boolean) is
  'The ONE writer for a person''s notification preferences. Pass only the channel being changed; the other is left as it was. A mandatory topic cannot have its in-app notifications switched off; email is governed separately by the email event''s own classification. Deliberately not overloaded -- a second signature makes PostgREST unable to resolve an in-app-only call.';
