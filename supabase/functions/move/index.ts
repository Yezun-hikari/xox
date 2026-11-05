// POST { matchId, index } -> { state, events }
import { applyMove, type MoveResult } from '../_shared/rules.ts';
import { check, HttpError, serve, TURN_MS } from '../_server/http.ts';
import { finish, loadActiveMatch } from '../_server/match.ts';

serve(async ({ userId, body, db }) => {
  const { index } = body;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 15) throw new HttpError(400, 'invalid');
  const { m, me } = await loadActiveMatch(db, body.matchId, userId);
  if (m.state.turn !== me) throw new HttpError(409, 'not_your_turn');

  let res: MoveResult;
  try {
    res = applyMove(m.state, index);
  } catch {
    throw new HttpError(400, 'illegal_move');
  }

  if (res.state.winner) {
    await finish(db, m, res.state.winner === 'X' ? m.x_id : m.o_id, res.state, true);
  } else {
    // optimistic concurrency: only applies if nobody wrote the match since we read it
    const rows = check(
      await db
        .from('matches')
        .update({ state: res.state, turn_deadline: new Date(Date.now() + TURN_MS).toISOString() })
        .eq('id', m.id)
        .eq('status', 'active')
        .eq('updated_at', m.updated_at)
        .select('id'),
    ) as unknown[];
    if (rows.length !== 1) throw new HttpError(409, 'conflict');
  }
  return { state: res.state, events: res.events };
});
