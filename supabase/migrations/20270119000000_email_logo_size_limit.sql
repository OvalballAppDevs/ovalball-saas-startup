-- Room for a real logo lockup: the email brand upload limit goes to 1.5 MiB.
--
-- The original 1 MiB was set against a plain square mark. A full lockup --
-- wordmark and tagline, at a resolution that still looks sharp on a retina
-- screen -- does not reliably fit in that, and an operator hitting the ceiling
-- has no way to raise it themselves.
--
-- A NEW MIGRATION RATHER THAN AN EDIT to the one that created the bucket.
-- That migration has already run here, and editing it in place would leave
-- every database that had applied it silently on the old limit, with the file
-- claiming otherwise. The ledger keys on version, so a change to an applied
-- migration is a change nothing will ever re-run.

update storage.buckets
set file_size_limit = 1572864
where id = 'email-brand';

-- Verification. A migration that silently did nothing would leave exactly the
-- state it was written to fix -- and this one's whole purpose is a number.
do $$
declare
  v_limit bigint;
begin
  select file_size_limit into v_limit from storage.buckets where id = 'email-brand';

  if v_limit is distinct from 1572864 then
    raise exception 'The email-brand upload limit is %, expected 1572864.', coalesce(v_limit::text, 'unset');
  end if;
end $$;
