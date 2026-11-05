// POST { action: 'join' | 'leave', game } -> { status: 'waiting' } | { status: 'matched', matchId } | { status: 'left' }
import { newGame } from '../_shared/rules.ts';
import { check, HttpError, serve } from '../_server/http.ts';

const GAMES = ['xox'];

serve(async ({ userId, body, db }) => {
  const { action, game } = body;
  if (typeof game !== 'string' || !GAMES.includes(game)) throw new HttpError(400, 'invalid');

  if (action === 'join') {
    // X always starts; the SQL function assigns the X seat randomly.
    const res = check(await db.rpc('matchmake', { p_user_id: userId, p_game: game, p_state: newGame('X') })) as
      | { status: 'waiting' }
      | { status: 'matched'; matchId: string }
      | { error: string };
    if ('error' in res) throw new HttpError(400, res.error);
    return res;
  }

  if (action === 'leave') {
    const rows = check(await db.from('queue').delete().eq('user_id', userId).select('match_id')) as { match_id: string | null }[];
    const matchId = rows[0]?.match_id;
    if (matchId) {
      // paired just before leaving: the match exists, so tell the client instead of silently abandoning it
      const m = check(await db.from('matches').select('status').eq('id', matchId).maybeSingle()) as { status: string } | null;
      if (m?.status === 'active') return { status: 'matched', matchId };
    }
    return { status: 'left' };
  }

  throw new HttpError(400, 'invalid');
});
