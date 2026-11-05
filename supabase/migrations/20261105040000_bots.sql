-- Rated games against a server-side bot.
-- The bot is ONE fixed, unusable auth user (no password, banned) so matches keep their foreign keys.
-- Its Elo is per match (matches.x_elo / o_elo) and is never stored in `ratings`: only the human's rating changes.

alter table public.matches add column is_bot boolean not null default false;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'b07b07b0-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'bot@users.yezun-games.invalid', '', now(), '2999-01-01',
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), false
) on conflict (id) do nothing;

-- finish_match: same as before, plus the bot branch (bot side uses the match's stored Elo, no rating row for the bot).
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
      update public.ratings set elo = elo - delta, games = games + 1
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
    update public.ratings set elo = elo - delta, games = games + 1
      where user_id = loser and game = m.game;
  end if;

  update public.matches
     set status = 'finished', winner_id = p_winner_id, elo_delta = delta,
         state = coalesce(p_state, state)
   where id = p_match_id;
  return delta;
end $$;

-- Starts (or resumes) a rated bot match for p_user_id. The Edge Function picks the bot's name, Elo and seat.
-- Returns {status:'matched', matchId} | {error:'no_nickname'} | {error:'rate_limited'}.
create function public.start_bot_match(
  p_user_id uuid, p_game text, p_state jsonb, p_bot_nick text, p_bot_elo int, p_bot_is_x boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bot constant uuid := 'b07b07b0-0000-4000-8000-000000000001';
  nick text;
  my_elo int;
  mid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('bot:' || p_user_id::text));
  select nickname into nick from public.profiles where id = p_user_id;
  if nick is null then return jsonb_build_object('error', 'no_nickname'); end if;

  -- already in a running match (human or bot): resume it
  select id into mid from public.matches
   where game = p_game and status = 'active' and p_user_id in (x_id, o_id) limit 1;
  if mid is not null then
    delete from public.queue where user_id = p_user_id;
    return jsonb_build_object('status', 'matched', 'matchId', mid);
  end if;

  -- farming brake: one new bot match per minute
  if exists (select 1 from public.matches
              where is_bot and game = p_game and p_user_id in (x_id, o_id)
                and created_at > now() - interval '60 seconds') then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.ratings (user_id, game) values (p_user_id, p_game) on conflict do nothing;
  select elo into my_elo from public.ratings where user_id = p_user_id and game = p_game;
  delete from public.queue where user_id = p_user_id;

  insert into public.matches (game, x_id, o_id, x_nick, o_nick, x_elo, o_elo, state, is_bot)
  values (
    p_game,
    case when p_bot_is_x then bot else p_user_id end,
    case when p_bot_is_x then p_user_id else bot end,
    case when p_bot_is_x then p_bot_nick else nick end,
    case when p_bot_is_x then nick else p_bot_nick end,
    case when p_bot_is_x then p_bot_elo else my_elo end,
    case when p_bot_is_x then my_elo else p_bot_elo end,
    p_state, true
  ) returning id into mid;
  return jsonb_build_object('status', 'matched', 'matchId', mid);
end $$;

revoke execute on function public.start_bot_match(uuid, text, jsonb, text, int, boolean) from public, anon, authenticated;
grant execute on function public.start_bot_match(uuid, text, jsonb, text, int, boolean) to service_role;

-- Guest purge: an abandoned bot match must not keep a stale guest alive (cascade removes the match with the user).
create or replace function public.purge_stale_guests() returns int
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
                      where m.status = 'active' and not m.is_bot and u.id in (m.x_id, m.o_id));
  get diagnostics n = row_count;
  return n;
end $$;
