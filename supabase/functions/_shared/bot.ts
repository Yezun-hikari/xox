// Small game AI for XOX. Pure TS (no imports besides rules.ts): runs in Edge Functions and in vitest.
// Strength follows the bot's Elo: more lookahead and fewer random blunders the higher it is.
import { applyMove, legalMoves, LINES, type GameState, type Player } from './rules.ts';

export const BOT_ELO_MIN = 600;
export const BOT_ELO_MAX = 1400;

const NAMES = ['Robo-Rudi', 'Pixel-Pia', 'Bit-Ben', 'Byte-Bea', 'Turbo-Tim', 'Nano-Nora', 'Gizmo-Gus', 'Chip-Chantal'];

export const botName = (rng: () => number = Math.random): string => `${NAMES[Math.floor(rng() * NAMES.length)]} (Bot)`;

/** Bot Elo near the player's (±100). Clamped, so very strong players cannot farm Elo from a weak bot. */
export function botEloFor(playerElo: number, rng: () => number = Math.random): number {
  const e = Math.round(playerElo + (rng() * 2 - 1) * 100);
  return Math.max(BOT_ELO_MIN, Math.min(BOT_ELO_MAX, e));
}

const other = (p: Player): Player => (p === 'X' ? 'O' : 'X');

/** Position value from `me`'s view: points matter most, open 3-of-4 lines are threats. */
function evaluate(s: GameState, me: Player): number {
  if (s.winner) return s.winner === me ? 10_000 : -10_000;
  let v = (s.score[me] - s.score[other(me)]) * 100;
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const i of line) {
      const c = s.board[i];
      if (c?.p === me) mine++;
      else if (c) theirs++;
    }
    if (theirs === 0) v += [0, 1, 4, 15][mine] ?? 0;
    else if (mine === 0) v -= [0, 1, 4, 15][theirs] ?? 0;
  }
  return v;
}

function search(s: GameState, depth: number, me: Player, alpha: number, beta: number): number {
  const moves = legalMoves(s);
  if (depth === 0 || moves.length === 0) return evaluate(s, me);
  const maximizing = s.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const i of moves) {
    const v = search(applyMove(s, i).state, depth - 1, me, alpha, beta);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** Picks a move for `state.turn`. Throws if there is none (game over). */
export function chooseMove(state: GameState, elo: number, rng: () => number = Math.random): number {
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('no legal move');
  const blunder = Math.max(0.03, Math.min(0.5, (1500 - elo) / 1800));
  if (rng() < blunder) return moves[Math.floor(rng() * moves.length)];
  const depth = elo < 1000 ? 2 : 4; // even depths only: odd ones end on our own move and ignore the reply
  const me = state.turn;
  let bestScore = -Infinity;
  let best: number[] = [];
  for (const i of moves) {
    const v = search(applyMove(state, i).state, depth - 1, me, -Infinity, Infinity);
    if (v > bestScore) [bestScore, best] = [v, [i]];
    else if (v === bestScore) best.push(i);
  }
  return best[Math.floor(rng() * best.length)];
}
