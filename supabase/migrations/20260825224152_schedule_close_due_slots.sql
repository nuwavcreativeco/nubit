-- close_due_slots() existed but nothing called it, so slots stayed 'open'
-- forever past closes_at. Run it every minute.
create extension if not exists pg_cron;

select cron.schedule('close-due-slots', '* * * * *', $$select public.close_due_slots();$$);
