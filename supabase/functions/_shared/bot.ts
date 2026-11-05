// Small game AI for XOX. Pure TS (no imports besides rules.ts): runs in Edge Functions and in vitest.
// Strength follows the bot's Elo: deeper lookahead and fewer oversights the higher it is.
// Mistakes are human: a weak bot overlooks a point or a threat and plays a plausible move, it never plays at random.
import { applyMove, legalMoves, LINES, WIN_SCORE, type GameState, type Player } from './rules.ts';

export const BOT_ELO_MIN = 100;
export const BOT_ELO_MAX = 1400;

const NAMES = ['Robo-Rudi', 'Pixel-Pia', 'Bit-Ben', 'Byte-Bea', 'Turbo-Tim', 'Nano-Nora', 'Gizmo-Gus', 'Chip-Chantal'];

export const botName = (rng: () => number = Math.random): string => `${NAMES[Math.floor(rng() * NAMES.length)]} (Bot)`;

/** Bot Elo near the player's (±100). Clamped, so very strong players cannot farm Elo from a weak bot. */
export function botEloFor(playerElo: number, rng: () => number = Math.random): number {
  const e = Math.round(playerElo + (rng() * 2 - 1) * 100);
  return Math.max(BOT_ELO_MIN, Math.min(BOT_ELO_MAX, e));
}

/** Weights of own vs opponent lines in the evaluation. They sum to 2, so no style just values lines more overall. */
export interface Style {
  attack: number;
  defence: number;
}

export const NEUTRAL_STYLE: Style = { attack: 1, defence: 1 };

/** Own-line weight per bot name; the opponent-line weight is 2 minus this. */
const ATTACK: Record<string, number> = {
  'Robo-Rudi': 1.1,
  'Pixel-Pia': 0.9,
  'Bit-Ben': 1.05,
  'Byte-Bea': 0.95,
  'Turbo-Tim': 1.15,
  'Nano-Nora': 0.85,
  'Gizmo-Gus': 1.08,
  'Chip-Chantal': 0.92,
};

/** Fixed personality of a bot, from its stored nickname (with or without the " (Bot)" suffix). Unknown names are neutral. */
export function styleOf(nick: string): Style {
  const attack = ATTACK[nick.replace(/ \(Bot\)$/, '')];
  return attack === undefined ? NEUTRAL_STYLE : { attack, defence: 2 - attack };
}

const other = (p: Player): Player => (p === 'X' ? 'O' : 'X');

/** 0 at the weakest bot, 1 at the strongest. */
const skill = (elo: number): number => Math.max(0, Math.min(1, (elo - BOT_ELO_MIN) / (BOT_ELO_MAX - BOT_ELO_MIN)));

/** Chances that a bot notices its own point, notices an opponent threat, and skips thinking on a quiet move. */
const seesPoint = (elo: number): number => 0.9 + 0.1 * skill(elo);
const seesThreat = (elo: number): number => 0.6 + 0.35 * skill(elo);
const lapses = (elo: number): number => 0.03 + 0.92 * (1 - skill(elo)) ** 1.5;
/** How vague a bot's feeling for a good move is when it does not search. */
const vagueness = (elo: number): number => 1 + 200 * (1 - skill(elo)) ** 2;

/** Bots from this Elo on search deep enough to weigh a counter-attack against a reflex move. */
const COUNTER_ELO = 800;
/** A counter-attack must beat the reflex move by more than a rounding error, so equal options still block. */
const COUNTER_MARGIN = 10;
/** Worth of an open three that is about to convert into a point (100). */
const CONVERT = 60;

/**
 * Empty cells that complete a line of three for `p`.
 * `afterMyMove`: the opponent moves only after our move ticks the timers, so a piece about to vanish does not count.
 */
function completingCells(s: GameState, p: Player, afterMyMove: boolean): number[] {
  const out = new Set<number>();
  for (const line of LINES) {
    const empty = line.filter((i) => s.board[i] === null);
    if (empty.length !== 1) continue;
    const pieces = line.filter((i) => s.board[i] !== null);
    if (pieces.every((i) => s.board[i]!.p === p && !(afterMyMove && s.board[i]!.frozen === 1))) out.add(empty[0]);
  }
  return [...out];
}

/** Position value from `me`'s view: points matter most, open 3-of-4 lines are threats. */
function evaluate(s: GameState, me: Player, style: Style): number {
  if (s.winner) return s.winner === me ? 10_000 : -10_000;
  let v = (s.score[me] - s.score[other(me)]) * 100;
  let myOpen = 0;
  let theirOpen = 0;
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const i of line) {
      const c = s.board[i];
      if (!c || c.frozen) continue; // a frozen piece vanishes soon: it neither builds nor blocks a line
      if (c.p === me) mine++;
      else theirs++;
    }
    if (theirs === 0) v += ([0, 1, 8, 30, 30][mine] ?? 0) * style.attack;
    else if (mine === 0) v -= ([0, 1, 8, 30, 30][theirs] ?? 0) * style.defence;
    if (mine === 3 && theirs === 0 && line.some((i) => s.board[i] === null)) myOpen++;
    if (theirs === 3 && mine === 0 && line.some((i) => s.board[i] === null)) theirOpen++;
  }
  // Open threes convert: the side to move scores one at once, the other side only if it has more than one block can stop.
  const [toMove, waiting] = s.turn === me ? [myOpen, theirOpen] : [theirOpen, myOpen];
  const edge = (toMove > 0 ? CONVERT : 0) - (waiting > 1 ? CONVERT : 0);
  return v + (s.turn === me ? edge : -edge);
}

function search(s: GameState, depth: number, me: Player, alpha: number, beta: number, style: Style): number {
  const moves = legalMoves(s);
  if (depth === 0 || moves.length === 0) return evaluate(s, me, style);
  const maximizing = s.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const i of moves) {
    const v = search(applyMove(s, i).state, depth - 1, me, alpha, beta, style);
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

/** Best of `moves` by search, with the equally good ones. */
function bestOf(s: GameState, moves: number[], depth: number, style: Style): { score: number; cells: number[] } {
  let score = -Infinity;
  let cells: number[] = [];
  for (const i of moves) {
    const v = search(applyMove(s, i).state, depth - 1, s.turn, -Infinity, Infinity, style);
    if (v > score) [score, cells] = [v, [i]];
    else if (v === score) cells.push(i);
  }
  return { score, cells };
}

const isNeighbour = (a: number, b: number): boolean =>
  a !== b && Math.abs((a >> 2) - (b >> 2)) <= 1 && Math.abs((a & 3) - (b & 3)) <= 1;

/** Next to an own piece, or on a line with an own piece and no opposing one. */
function looksSensible(s: GameState, i: number): boolean {
  const me = s.turn;
  return (
    s.board.some((c, j) => c?.p === me && isNeighbour(i, j)) ||
    LINES.some(
      (line) => line.includes(i) && line.some((j) => s.board[j]?.p === me) && !line.some((j) => s.board[j]?.p === other(me)),
    )
  );
}

/** A move without lookahead: builds own lines near own pieces. More `noise` means a vaguer idea of which one is best. */
function plausibleMove(s: GameState, moves: number[], rng: () => number, style: Style, noise: number): number {
  const sensible = moves.filter((i) => looksSensible(s, i));
  let best = moves[0];
  let bestScore = -Infinity;
  for (const i of sensible.length > 0 ? sensible : moves) {
    const v = evaluate(applyMove(s, i).state, s.turn, style) + rng() * noise;
    if (v > bestScore) [bestScore, best] = [v, i];
  }
  return best;
}

/**
 * Picks a move for `state.turn`. Throws if there is none (game over).
 * Reflexes come first: an own point, then a block, each only if the bot notices it. Anything it does not notice
 * is off its radar for this move, so it plays something else that looks reasonable.
 */
export function chooseMove(
  state: GameState,
  elo: number,
  rng: () => number = Math.random,
  style: Style = NEUTRAL_STYLE,
): number {
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('no legal move');
  const depth = elo < 1000 ? 3 : 4;
  const pick = (cells: number[]): number => cells[Math.floor(rng() * cells.length)];

  const points = completingCells(state, state.turn, false);
  const threats = completingCells(state, other(state.turn), true);
  const sawPoint = points.length > 0 && rng() < seesPoint(elo);
  const sawThreat = threats.length > 0 && rng() < seesThreat(elo);

  if (sawPoint || sawThreat) {
    const reflex = bestOf(state, sawPoint ? points : threats, depth, style);
    if (elo >= COUNTER_ELO) {
      // a counter-attack makes an own threat or removes theirs: merely ignoring a threat is no plan
      const me = state.turn;
      const counters = moves.filter((i) => {
        const next = applyMove(state, i).state;
        return completingCells(next, me, false).length > 0 || completingCells(next, other(me), false).length === 0;
      });
      const free = bestOf(state, counters, depth, style);
      if (free.score - reflex.score >= COUNTER_MARGIN) return pick(free.cells);
    }
    return pick(reflex.cells);
  }

  const overlooked = [...points, ...threats];
  if (overlooked.length > 0 || rng() < lapses(elo)) {
    const view = moves.filter((i) => !overlooked.includes(i));
    return plausibleMove(state, view.length > 0 ? view : moves, rng, style, vagueness(elo));
  }
  return pick(bestOf(state, moves, depth, style).cells);
}

/**
 * How long a human would pause before this move, in ms (300-2000). The client waits this long before asking for the
 * move. Quick for the first move, an obvious point or block and few cells; longer with many options and tension.
 */
export function thinkTimeMs(state: GameState, elo: number, rng: () => number = Math.random): number {
  const open = legalMoves(state).length;
  const me = state.turn;
  const obvious =
    state.moves === 0 ||
    open <= 3 ||
    completingCells(state, me, false).length > 0 ||
    completingCells(state, other(me), true).length > 0;
  let ms = 450;
  if (!obvious) {
    // lines with two or more pieces of one player and none of the other
    const tension = LINES.filter((line) => {
      const pieces = line.flatMap((i) => state.board[i]?.p ?? []);
      return pieces.length >= 2 && new Set(pieces).size === 1;
    }).length;
    const closeGame = state.score.X === WIN_SCORE - 1 || state.score.O === WIN_SCORE - 1;
    ms = (450 + 50 * open + 90 * tension + (closeGame ? 250 : 0)) * (1.1 - 0.2 * skill(elo));
  }
  return Math.round(Math.max(300, Math.min(2000, ms * (0.75 + 0.5 * rng()))));
}
