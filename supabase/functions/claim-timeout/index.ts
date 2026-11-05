// POST { matchId } -> { status: 'finished', winnerId, eloDelta } if the opponent let their turn time run out
import { HttpError, serve } from '../_server/http.ts';
import { finish, loadActiveMatch } from '../_server/match.ts';

serve(async ({ userId, body, db }) => {
  const { m, me } = await loadActiveMatch(db, body.matchId, userId);
  if (m.state.turn === me) throw new HttpError(409, 'not_opponent_turn');
  if (Date.now() <= Date.parse(m.turn_deadline)) throw new HttpError(409, 'not_expired');
  // expectUnchanged: a move that lands concurrently wins the race and this claim fails with conflict
  const eloDelta = await finish(db, m, userId, null, true);
  return { status: 'finished', winnerId: userId, eloDelta };
});
