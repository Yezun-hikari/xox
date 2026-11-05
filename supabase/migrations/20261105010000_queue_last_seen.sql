-- Stale queue fix: players who close the tab must not stay matchable forever.
-- Clients re-send matchmake 'join' every ~8 s while waiting; each join refreshes last_seen.
-- Waiting entries not seen for more than 20 s are deleted before pairing.

alter table public.queue add column last_seen timestamptz not null default now();

create or replace function public.matchmake(p_user_id uuid, p_game text, p_state jsonb)
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

  -- drop waiting players whose client stopped sending heartbeats (tab closed, offline)
  delete from public.queue
   where game = p_game and match_id is null and last_seen < now() - interval '20 seconds';

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
          last_seen = now(),
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

-- create or replace keeps the existing grants, restated here for clarity
revoke execute on function public.matchmake(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.matchmake(uuid, text, jsonb) to service_role;
