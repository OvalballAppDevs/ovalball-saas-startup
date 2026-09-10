-- =====================================================================
-- TWO THE AUDIT MISSED
--
-- The previous migration registered twenty-five emitted-but-unregistered
-- notification types, found by reading the emitting code by hand, and then
-- added a foreign key so an unregistered type could never be stored again.
--
-- The structural guard written straight afterwards
-- (scripts/verify-notification-catalogue.mjs) resolves every emitter
-- mechanically -- including the ones that assemble their type in a plpgsql
-- variable, and the ones that hand it to a fan-out helper as a parameter,
-- which is precisely where reading by hand goes wrong. It found two more:
--
--   training_attendance_reminder   public.send_training_communication
--                                  assigns it to v_type in the
--                                  ATTENDANCE_REMINDER branch, so no literal
--                                  ever appears beside the insert.
--
--   directory_request_submitted    passed as p_type into
--                                  internal.notify_site_admins_of_new_request,
--                                  so the literal sits in a caller three
--                                  hundred lines away from the insert.
--
-- Both are live, shipping paths. With the foreign key in place and neither
-- type registered, a coach pressing "Send Attendance Reminder" and a club
-- submitting a directory request would each have hit a constraint violation.
-- The guard turned a latent gap into a caught one before it ran.
--
-- The lesson is in the second column of that list: a hand audit reads what is
-- written next to the insert, and both of these types are written somewhere
-- else. That is why the check is mechanical from here on.
-- =====================================================================

insert into public.notification_types (type_key, topic_key) values
  -- Asking a family whether their player can make training is the same
  -- conversation as telling them it is cancelled, so it belongs to the same
  -- preference. Filing it anywhere else would let somebody switch off
  -- training news and still be chased for a response to it.
  ('training_attendance_reminder', 'calendar_training_updates'),

  -- A Site Admin being told a club has asked to be added to the Directory.
  -- The same topic as club_claim_submitted, which is the same event wearing
  -- different clothes: somebody outside asking to be let in.
  ('directory_request_submitted',  'access_invitations')
on conflict (type_key) do nothing;
