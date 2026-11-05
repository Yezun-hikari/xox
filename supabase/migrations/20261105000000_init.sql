-- xox / Yezun games: core schema.
-- Security model (see docs/ARCHITECTURE.md):
--   * RLS on every table, clients may only SELECT their own rows / matches they play in.
--   * Clients get NO write privileges. All writes go through Edge Functions (service_role)
--     or the security definer functions below, which are not executable by anon/authenticated.
--   * Every row hangs off auth.users with ON DELETE CASCADE, so deleting a user deletes their data.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 3 and 16),
  created_at timestamptz not null default now()
);
create unique index profiles_nickname_ci on public.profiles (lower(nickname));

create table public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9_-]{1,32}$'),
  elo int not null default 1000,
  games int not null default 0,
  wins int not null default 0,
  primary key (user_id, game)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game ~ '^[a-z0-9_-]{1,32}$'),
  x_id uuid not null references auth.users (id) on delete cascade,
  o_id uuid not null references auth.users (id) on delete cascade,
  x_nick text not null,
  o_nick text not null,
  x_elo int not null,
  o_elo int not null,
  state jsonb not null,
  status text not null default 'active' check (status in ('active', 'finished')),
  winner_id uuid references auth.users (id) on delete cascade,
  elo_delta int,
  turn_deadline timestamptz not null default now() + interval '60 seconds',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  check (x_id <> o_id),
  check (winner_id is null or winner_id in (x_id, o_id))
);
create index matches_x_active on public.matches (x_id) where status = 'active';
create index matches_o_active on public.matches (o_id) where status = 'active';

create table public.queue (
  user_id uuid primary key references auth.users (id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9_-]{1,32}$'),
  elo int not null,
  nickname text not null,
  joined_at timestamptz not null default now(),
  match_id uuid references public.matches (id) on delete set null
);
create index queue_waiting on public.queue (game, elo) where match_id is null;

-- updated_at is the optimistic-concurrency token for matches: always set by the DB, unique per write.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- privileges + RLS

alter table public.profiles enable row level security;
alter table public.ratings  enable row level security;
alter table public.queue    enable row level security;
alter table public.matches  enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated by default: take it back.
revoke all on public.profiles, public.ratings, public.queue, public.matches from public, anon, authenticated;
grant select on public.profiles, public.ratings, public.queue, public.matches to authenticated;
grant all on public.profiles, public.ratings, public.queue, public.matches to service_role;

-- SELECT-only policies. No insert/update/delete policies exist on purpose.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy ratings_select_own on public.ratings
  for select to authenticated using (user_id = (select auth.uid()));
create policy queue_select_own on public.queue
  for select to authenticated using (user_id = (select auth.uid()));
create policy matches_select_participant on public.matches
  for select to authenticated using ((select auth.uid()) in (x_id, o_id));

-- Realtime (postgres_changes honours RLS + the SELECT grant above).
alter publication supabase_realtime add table public.queue, public.matches;

-- ---------------------------------------------------------------- functions

-- Applies Elo (K = 32) and finishes the match atomically. Returns elo_delta. Idempotent: returns null if the match is
-- not active anymore, or if p_expected_updated_at is given and does not match (concurrent write).
-- p_state optionally stores the final game state in the same transaction.
create function public.finish_match(
  p_match_id uuid,
  p_winner_id uuid,
  p_state jsonb default null,
  p_expected_updated_at timestamptz default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  loser uuid;
  rw int;
  rl int;
  delta int;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'active' then return null; end if;
  if p_expected_updated_at is not null and m.updated_at <> p_expected_updated_at then return null; end if;
  if p_winner_id not in (m.x_id, m.o_id) then raise exception 'winner is not a participant'; end if;
  loser := case when p_winner_id = m.x_id then m.o_id else m.x_id end;

  insert into public.ratings (user_id, game) values (m.x_id, m.game), (m.o_id, m.game)
    on conflict do nothing;
  -- lock both rating rows in a fixed order to avoid deadlocks
  perform 1 from public.ratings where game = m.game and user_id in (m.x_id, m.o_id)
    order by user_id for update;
  select elo into rw from public.ratings where user_id = p_winner_id and game = m.game;
  select elo into rl from public.ratings where user_id = loser and game = m.game;

  delta := round(32 * (1 - 1 / (1 + power(10::numeric, (rl - rw) / 400.0))));

  update public.ratings set elo = elo + delta, games = games + 1, wins = wins + 1
    where user_id = p_winner_id and game = m.game;
  update public.ratings set elo = elo - delta, games = games + 1
    where user_id = loser and game = m.game;

  update public.matches
     set status = 'finished', winner_id = p_winner_id, elo_delta = delta,
         state = coalesce(p_state, state)
   where id = p_match_id;
  return delta;
end $$;

-- Race-safe matchmaking for p_user_id in p_game. p_state is the initial GameState (built by the
-- Edge Function with rules.ts; X always starts there, the X seat is assigned randomly here).
-- Returns {status:'waiting'} | {status:'matched', matchId} | {error:'no_nickname'}.
create function public.matchmake(p_user_id uuid, p_game text, p_state jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  nick text;
  my_elo int;
  opp public.queue;
  mid uuid;
begin
  -- serialise matchmaking per game: two simultaneous joiners can never both end up waiting
  perform pg_advisory_xact_lock(hashtext('matchmake:' || p_game));

  select nickname into nick from public.profiles where id = p_user_id;
  if nick is null then return jsonb_build_object('error', 'no_nickname'); end if;

  -- already playing? resume that match
  select id into mid from public.matches
   where game = p_game and status = 'active' and p_user_id in (x_id, o_id)
   order by created_at desc limit 1;
  if mid is not null then
    delete from public.queue where user_id = p_user_id;
    return jsonb_build_object('status', 'matched', 'matchId', mid);
  end if;

  insert into public.ratings (user_id, game) values (p_user_id, p_game) on conflict do nothing;
  select elo into my_elo from public.ratings where user_id = p_user_id and game = p_game;

  select * into opp from public.queue
   where game = p_game and match_id is null and user_id <> p_user_id
   order by abs(elo - my_elo), joined_at
   limit 1
   for update skip locked;

  if opp.user_id is null then
    insert into public.queue (user_id, game, elo, nickname)
    values (p_user_id, p_game, my_elo, nick)
    on conflict (user_id) do update
      set game = excluded.game, elo = excluded.elo, nickname = excluded.nickname, match_id = null,
          joined_at = case when public.queue.match_id is null and public.queue.game = excluded.game
                           then public.queue.joined_at else now() end;
    return jsonb_build_object('status', 'waiting');
  end if;

  if random() < 0.5 then
    insert into public.matches (game, x_id, o_id, x_nick, o_nick, x_elo, o_elo, state)
    values (p_game, p_user_id, opp.user_id, nick, opp.nickname, my_elo, opp.elo, p_state)
    returning id into mid;
  else
    insert into public.matches (game, x_id, o_id, x_nick, o_nick, x_elo, o_elo, state)
    values (p_game, opp.user_id, p_user_id, opp.nickname, nick, opp.elo, my_elo, p_state)
    returning id into mid;
  end if;

  -- the waiting player learns the match via Realtime on their own queue row
  update public.queue set match_id = mid where user_id = opp.user_id;
  delete from public.queue where user_id = p_user_id;
  return jsonb_build_object('status', 'matched', 'matchId', mid);
end $$;

-- Keepalive for the free tier. Exposes nothing.
create function public.ping() returns int language sql stable set search_path = '' as $$ select 1 $$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated by default: take it back.
revoke execute on function public.finish_match(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.matchmake(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.ping() from public, authenticated;
grant execute on function public.finish_match(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.matchmake(uuid, text, jsonb) to service_role;
grant execute on function public.ping() to anon, service_role;
