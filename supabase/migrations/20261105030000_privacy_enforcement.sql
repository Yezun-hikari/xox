-- Privacy enforcement (review 2026-11-05).

-- 1) No real email may ever be stored. Accounts use the synthetic address <username>@users.yezun-games.invalid
--    (see src/auth). Anonymous users have no email. Rejects anything else at the database level, so a client
--    calling signUp/updateUser with a real address directly fails (GoTrue answers with a 500).
--    email_change holds a pending (unconfirmed) new address: same rule, GoTrue uses '' for "none".
create function public.enforce_synthetic_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.email is not null and new.email !~ '^[a-z0-9_]{3,20}@users\.yezun-games\.invalid$' then
    raise exception 'only synthetic emails are allowed' using errcode = 'check_violation';
  end if;
  if coalesce(new.email_change, '') <> '' and new.email_change !~ '^[a-z0-9_]{3,20}@users\.yezun-games\.invalid$' then
    raise exception 'only synthetic emails are allowed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_synthetic_email() from public, anon, authenticated;

create trigger enforce_synthetic_email before insert or update of email, email_change on auth.users
  for each row execute function public.enforce_synthetic_email();

-- 2) Guest data retention: anonymous users inactive for 30 days are deleted with all their data (cascade).
--    Activity = sign-in, user update, or a token refresh (auth.sessions.updated_at). Guests in a running match
--    are kept. Runs daily via pg_cron.
create function public.purge_stale_guests() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from auth.users u
   where u.is_anonymous
     and greatest(u.created_at, u.last_sign_in_at, u.updated_at) < now() - interval '30 days'
     and not exists (select 1 from auth.sessions s
                      where s.user_id = u.id and s.updated_at >= now() - interval '30 days')
     and not exists (select 1 from public.matches m
                      where m.status = 'active' and u.id in (m.x_id, m.o_id));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_stale_guests() from public, anon, authenticated;

-- pg_cron ships with hosted Supabase and the local image. If it is missing, skip scheduling instead of failing:
-- then enable pg_cron (Dashboard → Database → Extensions) and re-run the block below in the SQL editor.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-stale-guests', '17 3 * * *', 'select public.purge_stale_guests()');
  else
    raise notice 'pg_cron not available: purge-stale-guests not scheduled';
  end if;
end $$;
