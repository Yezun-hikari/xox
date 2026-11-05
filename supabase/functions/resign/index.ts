// POST { matchId } -> { status: 'finished', winnerId, eloDelta } (opponent wins)
import { serve } from '../_server/http.ts';
import { finish, loadActiveMatch } from '../_server/match.ts';

serve(async ({ userId, body, db }) => {
  const { m, opponentId } = await loadActiveMatch(db, body.matchId, userId);
  const eloDelta = await finish(db, m, opponentId, null, false);
  return { status: 'finished', winnerId: opponentId, eloDelta };
});
