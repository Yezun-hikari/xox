// POST { matchId, text } -> { message: { id, sender_id, body, created_at } }
// Errors: invalid | not_found | chat_closed | empty | too_long | profane | link | rate_limited. Never log message text.
import { checkChat } from '../_shared/profanity.ts';
import { check, HttpError, serve, UUID } from '../_server/http.ts';

const OPEN_AFTER_FINISH_MS = 10 * 60_000;

serve(async ({ userId, body, db }) => {
  const { matchId, text } = body;
  if (typeof matchId !== 'string' || !UUID.test(matchId) || typeof text !== 'string') throw new HttpError(400, 'invalid');

  const m = check(
    await db.from('matches').select('x_id, o_id, is_bot, status, updated_at').eq('id', matchId).maybeSingle(),
  ) as { x_id: string; o_id: string; is_bot: boolean; status: string; updated_at: string } | null;
  if (!m || (m.x_id !== userId && m.o_id !== userId)) throw new HttpError(404, 'not_found');
  if (m.is_bot) throw new HttpError(400, 'invalid');
  // a finished match is never written again, so updated_at is the moment it finished
  if (m.status !== 'active' && Date.now() - Date.parse(m.updated_at) >= OPEN_AFTER_FINISH_MS) {
    throw new HttpError(409, 'chat_closed');
  }

  const r = checkChat(text);
  if (!r.ok) throw new HttpError(400, r.reason);

  const { data, error } = await db.rpc('send_match_message', { p_match_id: matchId, p_sender_id: userId, p_body: r.text });
  if (error) {
    // not via check(): a Postgres error's details can quote the row, and serve() logs what it catches
    console.error('send_match_message failed', error.code);
    throw new HttpError(500, 'internal');
  }
  if (data.error) throw new HttpError(429, data.error);
  return { message: data };
});
