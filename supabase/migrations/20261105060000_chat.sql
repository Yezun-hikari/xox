-- Moderated chat between the two human players of a match.
-- Only the two participants can ever read a message (RLS). Writes go only through the chat-send Edge Function, which
-- moderates the text and calls send_match_message. Not added to the Realtime publication: clients poll.

create table public.match_messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index match_messages_match_id on public.match_messages (match_id, id);

alter table public.match_messages enable row level security;

-- service_role is left out on purpose: the backend writes through the function below and has no reason to read chats.
revoke all on public.match_messages from public, anon, authenticated, service_role;
grant select on public.match_messages to authenticated;

create policy match_messages_select_participant on public.match_messages
  for select to authenticated using (
    exists (select 1 from public.matches m where m.id = match_id and (select auth.uid()) in (m.x_id, m.o_id))
  );

-- Rate limit + insert per sender and match: at most 5 messages in 10 s, at least 500 ms apart.
-- The lock makes the check race-free. Returns the message, or {error:'rate_limited'}.
create function public.send_match_message(p_match_id uuid, p_sender_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  msg public.match_messages;
begin
  perform pg_advisory_xact_lock(hashtext('chat:' || p_sender_id::text || ':' || p_match_id::text));

  -- clock_timestamp, not now(): now() is from before the lock wait
  if exists (select 1 from public.match_messages
              where match_id = p_match_id and sender_id = p_sender_id
                and created_at > clock_timestamp() - interval '500 milliseconds')
     or (select count(*) from public.match_messages
          where match_id = p_match_id and sender_id = p_sender_id
            and created_at > clock_timestamp() - interval '10 seconds') >= 5 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.match_messages (match_id, sender_id, body, created_at)
  values (p_match_id, p_sender_id, p_body, clock_timestamp())
  returning * into msg;
  return jsonb_build_object('id', msg.id, 'sender_id', msg.sender_id, 'body', msg.body, 'created_at', msg.created_at);
end $$;

revoke execute on function public.send_match_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_match_message(uuid, uuid, text) to service_role;

-- Retention: messages live at most 24 h (plus up to one hour until the next run). pg_cron ships with hosted Supabase
-- and the local image. If it is missing, skip scheduling instead of failing: then enable pg_cron
-- (Dashboard → Database → Extensions) and re-run the block below in the SQL editor.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-old-chat-messages', '23 * * * *',
      'delete from public.match_messages where created_at < now() - interval ''24 hours''');
  else
    raise notice 'pg_cron not available: purge-old-chat-messages not scheduled';
  end if;
end $$;
