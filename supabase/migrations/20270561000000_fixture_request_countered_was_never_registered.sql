-- SECTION 9 DEFECT, FOUND RECONCILING THE SECTIONS 15/16 NOTIFICATION CATALOGUE.
--
-- `notifications.type` carries a real foreign key to `notification_types.type_key`
-- (notifications_type_registered). `counter_fixture_request` (20270553000000, applied and committed
-- before this run's Section 9 work) and `internal.notify_fixture_request_recipients` both emit
-- `fixture_request_countered` -- a type that was NEVER registered. `scripts/verify-notification-
-- catalogue.mjs` confirms this live: the type has been emittable in production since 20270553000000
-- shipped, and every real call to counter_fixture_request would raise a foreign-key violation on its own
-- notification insert, failing the entire "Suggest Another" action outright.
--
-- Section 9 (this run, last night) built real client UI over counter_fixture_request without ever
-- exercising this exact code path against a live database -- recorded there as an explicit, stated gap
-- ("no live browser walkthrough performed"). Found only now, doing Section 15/16's own explicit mandate
-- to reconcile the WHOLE Clubhouse notification catalogue, not merely the four new types this migration
-- adds. Fixed here, in its own migration, rather than editing the already-applied 20270553000000 in
-- place.

insert into public.notification_types (type_key, topic_key)
values ('fixture_request_countered', 'fixture_requests')
on conflict (type_key) do nothing;
