-- New players start at 100 Elo (like chess.com). Elo never drops below 0.
alter table public.ratings alter column elo set default 100;
-- accounts that have not played yet start at the new value; played ratings stay as they are
update public.ratings set elo = 100 where games = 0;

create or replace function public.finish_match(
  p_match_id uuid,
  p_winner_id uuid,
  p_state jsonb default null,
  p_expected_updated_at timestamptz default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  bot constant uuid := 'b07b07b0-0000-4000-8000-000000000001';
  m public.matches;
  loser uuid;
  human uuid;
  rw int;
  rl int;
  delta int;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'active' then return null; end if;
  if p_expected_updated_at is not null and m.updated_at <> p_expected_updated_at then return null; end if;
  if p_winner_id not in (m.x_id, m.o_id) then raise exception 'winner is not a participant'; end if;
  loser := case when p_winner_id = m.x_id then m.o_id else m.x_id end;

  if m.is_bot then
    human := case when m.x_id = bot then m.o_id else m.x_id end;
    insert into public.ratings (user_id, game) values (human, m.game) on conflict do nothing;
    perform 1 from public.ratings where game = m.game and user_id = human for update;
    if p_winner_id = human then
      select elo into rw from public.ratings where user_id = human and game = m.game;
      rl := case when m.x_id = bot then m.x_elo else m.o_elo end;
    else
      rw := case when m.x_id = bot then m.x_elo else m.o_elo end;
      select elo into rl from public.ratings where user_id = human and game = m.game;
    end if;
    delta := round(32 * (1 - 1 / (1 + power(10::numeric, (rl - rw) / 400.0))));
    if p_winner_id = human then
      update public.ratings set elo = elo + delta, games = games + 1, wins = wins + 1
        where user_id = human and game = m.game;
    else
      update public.ratings set elo = greatest(elo - delta, 0), games = games + 1
        where user_id = human and game = m.game;
    end if;
  else
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
    update public.ratings set elo = greatest(elo - delta, 0), games = games + 1
      where user_id = loser and game = m.game;
  end if;

  update public.matches
     set status = 'finished', winner_id = p_winner_id, elo_delta = delta,
         state = coalesce(p_state, state)
   where id = p_match_id;
  return delta;
end $$;
