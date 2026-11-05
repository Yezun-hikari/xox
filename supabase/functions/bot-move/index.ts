// POST { matchId } -> { state, events } : plays the bot's move if it is the bot's turn in the caller's bot match
import { chooseMove, styleOf } from '../_shared/bot.ts';
import { applyMove } from '../_shared/rules.ts';
import { check, HttpError, serve, TURN_MS } from '../_server/http.ts';
import { finish, loadActiveMatch } from '../_server/match.ts';

serve(async ({ userId, body, db }) => {
  const { m, me } = await loadActiveMatch(db, body.matchId, userId);
  if (!m.is_bot) throw new HttpError(400, 'invalid');
  if (m.state.turn === me) throw new HttpError(409, 'not_bot_turn');

  const botElo = me === 'X' ? m.o_elo : m.x_elo;
  const botNick = me === 'X' ? m.o_nick : m.x_nick;
  const res = applyMove(m.state, chooseMove(m.state, botElo, Math.random, styleOf(botNick)));
  const botId = me === 'X' ? m.o_id : m.x_id;

  if (res.state.winner) {
    await finish(db, m, botId, res.state, true);
  } else {
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
