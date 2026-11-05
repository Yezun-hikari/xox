-- Rating model inspired by Chess.com: Glicko-1 instead of plain Elo.
-- Every rating has a rating deviation (RD, how unsure we are): new players start at 100 with RD 350 and swing a lot in
-- their first games; RD shrinks with games and grows again during inactivity. Ratings never drop below 100.
-- A game with fewer than 2 moves is aborted: finished, no winner, no rating change.

alter table public.ratings alter column elo set default 100;
alter table public.ratings add column rd numeric not null default 350;
alter table public.ratings add column rated_at timestamptz;
-- accounts without games start at the new value; played ratings stay, but never below the floor
update public.ratings set elo = 100 where games = 0;
update public.ratings set elo = 100 where elo < 100;

alter table public.matches add column x_delta int;
alter table public.matches add column o_delta int;

-- One Glicko-1 update for a single game (s: 1 win, 0 loss). rd must already include inactivity growth.
create function public.glicko_update(r int, rd numeric, opp_r int, opp_rd numeric, s int, out new_r int, out new_rd numeric)
language plpgsql immutable set search_path = '' as $$
declare
  q constant float8 := ln(10) / 400;
  g float8 := 1 / sqrt(1 + 3 * q * q * opp_rd::float8 * opp_rd::float8 / (pi() * pi()));
  e float8 := 1 / (1 + power(10::float8, -g * (r - opp_r) / 400));
  inv_d2 float8 := q * q * g * g * e * (1 - e);
  denom float8 := 1 / (rd::float8 * rd::float8) + inv_d2;
begin
  new_r := greatest(100, round(r + q / denom * g * (s - e)));
  new_rd := greatest(45, sqrt(1 / denom))::numeric;
end $$;

-- RD after inactivity: back to the maximum of 350 after roughly a year without games.
create function public.glicko_rd_now(rd numeric, rated_at timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select least(350, sqrt(rd * rd + 329 * coalesce(extract(epoch from now() - rated_at) / 86400, 0)::numeric))
$$;

revoke execute on function public.glicko_update(int, numeric, int, numeric, int) from public, anon, authenticated;
revoke execute on function public.glicko_rd_now(numeric, timestamptz) from public, anon, authenticated;

-- Returns the winner's rating change (the human's loss if the bot won), 0 if aborted, null if not applied.
create or replace function public.finish_match(
  p_match_id uuid,
  p_winner_id uuid,
  p_state jsonb default null,
  p_expected_updated_at timestamptz default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  bot constant uuid := 'b07b07b0-0000-4000-8000-000000000001';
  bot_rd constant numeric := 200; -- a bot's rating is a rough guess, so it counts a bit less than a settled human's
  m public.matches;
  x public.ratings;
  o public.ratings;
  x_rd numeric;
  o_rd numeric;
  nx record;
  no_ record;
  xd int := 0;
  od int := 0;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'active' then return null; end if;
  if p_expected_updated_at is not null and m.updated_at <> p_expected_updated_at then return null; end if;
  if p_winner_id not in (m.x_id, m.o_id) then raise exception 'winner is not a participant'; end if;

  if coalesce((coalesce(p_state, m.state) ->> 'moves')::int, 0) < 2 then
    update public.matches set status = 'finished', winner_id = null, elo_delta = 0, x_delta = 0, o_delta = 0
     where id = p_match_id;
    return 0;
  end if;

  insert into public.ratings (user_id, game)
    select u, m.game from unnest(array[m.x_id, m.o_id]) u where u <> bot
    on conflict do nothing;
  -- lock rating rows in a fixed order to avoid deadlocks
  perform 1 from public.ratings where game = m.game and user_id in (m.x_id, m.o_id) order by user_id for update;
  select * into x from public.ratings where user_id = m.x_id and game = m.game;
  select * into o from public.ratings where user_id = m.o_id and game = m.game;

  -- the bot has no rating row: it plays with the Elo stored in the match
  x_rd := case when m.x_id = bot then bot_rd else public.glicko_rd_now(x.rd, x.rated_at) end;
  o_rd := case when m.o_id = bot then bot_rd else public.glicko_rd_now(o.rd, o.rated_at) end;
  x.elo := case when m.x_id = bot then m.x_elo else x.elo end;
  o.elo := case when m.o_id = bot then m.o_elo else o.elo end;

  select * into nx from public.glicko_update(x.elo, x_rd, o.elo, o_rd, (p_winner_id = m.x_id)::int);
  select * into no_ from public.glicko_update(o.elo, o_rd, x.elo, x_rd, (p_winner_id = m.o_id)::int);

  if m.x_id <> bot then
    xd := nx.new_r - x.elo;
    update public.ratings
       set elo = nx.new_r, rd = nx.new_rd, rated_at = now(), games = games + 1,
           wins = wins + (p_winner_id = m.x_id)::int
     where user_id = m.x_id and game = m.game;
  end if;
  if m.o_id <> bot then
    od := no_.new_r - o.elo;
    update public.ratings
       set elo = no_.new_r, rd = no_.new_rd, rated_at = now(), games = games + 1,
           wins = wins + (p_winner_id = m.o_id)::int
     where user_id = m.o_id and game = m.game;
  end if;

  update public.matches
     set status = 'finished', winner_id = p_winner_id, x_delta = xd, o_delta = od,
         elo_delta = abs(case when p_winner_id = m.x_id then xd else od end),
         state = coalesce(p_state, state)
   where id = p_match_id;
  -- a human win against a bot counts the human's side; a bot win reports the human's loss
  return case
    when m.x_id = bot then abs(od)
    when m.o_id = bot then abs(xd)
    else abs(case when p_winner_id = m.x_id then xd else od end)
  end;
end $$;
