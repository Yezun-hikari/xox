-- Security hardening (review 2026-11-05).

-- 1) Realtime sends DELETE events of published tables to EVERY subscriber, without RLS (Postgres cannot check
--    a deleted row). The payload is the replica identity = primary key. queue's key was user_id, so any signed-in
--    guest subscribing to public.queue saw the auth user id of every player leaving the queue (activity tracking).
--    Give queue a meaningless surrogate key; user_id stays unique (matchmake's ON CONFLICT (user_id) still works).
--    matches DELETE events only carry the random match id.
alter table public.queue drop constraint queue_pkey;
alter table public.queue add column id uuid not null default gen_random_uuid();
alter table public.queue add primary key (id);
alter table public.queue add constraint queue_user_id_key unique (user_id);

-- 2) Supabase's default privileges grant ALL on every future table/sequence/function in public to anon and
--    authenticated. This project is shared by several games: a later migration that forgets its revoke (or RLS)
--    would expose data. New objects now start closed; grant explicitly what a client needs.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
