// POST { game } -> { status: 'matched', matchId } : starts (or resumes) a rated game against the bot
import { botEloFor, botName } from '../_shared/bot.ts';
import { newGame } from '../_shared/rules.ts';
import { check, HttpError, serve } from '../_server/http.ts';

const GAMES = ['xox'];

serve(async ({ userId, body, db }) => {
  const { game } = body;
  if (typeof game !== 'string' || !GAMES.includes(game)) throw new HttpError(400, 'invalid');

  const rating = check(await db.from('ratings').select('elo').eq('user_id', userId).eq('game', game).maybeSingle()) as { elo: number } | null;
  const res = check(
    await db.rpc('start_bot_match', {
      p_user_id: userId,
      p_game: game,
      p_state: newGame('X'), // X always starts; the bot gets the X seat half of the time
      p_bot_nick: botName(),
      p_bot_elo: botEloFor(rating?.elo ?? 100),
      p_bot_is_x: Math.random() < 0.5,
    }),
  ) as { status: 'matched'; matchId: string } | { error: string };
  if ('error' in res) throw new HttpError(res.error === 'rate_limited' ? 429 : 400, res.error);
  return res;
});
