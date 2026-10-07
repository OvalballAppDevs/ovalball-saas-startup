-- =====================================================================================================
-- A REMINDER TO THE UNANSWERED NEEDS NO WORDS
--
-- 20270729 gave an event's organisers "Remind Awaiting Reply" and added its action, REMIND_AWAITING, to
-- the list of actions a communication may record. It did not add it to the body rule beside that list,
-- which lets a REMINDER go out without a message of its own (the notification says what is being asked)
-- while every MESSAGE must carry words. So the commonest reminder an organiser sends -- to the people who
-- have not answered -- was refused outright, and the Event Centre said "Couldn't load the message".
-- Found in live UAT on the Christmas Party.
-- =====================================================================================================
alter table public.fixture_communications drop constraint if exists fixture_communications_body_shape;
alter table public.fixture_communications add constraint fixture_communications_body_shape
  check (
    (action in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE', 'REMIND_AWAITING')
       and (body is null or length(btrim(body)) > 0))
    or (action not in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE', 'REMIND_AWAITING')
       and body is not null and length(btrim(body)) > 0)
  );
