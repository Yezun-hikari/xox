// XOX 4x4 rules engine. Pure TS, no imports: runs in the browser (Vite) and in Supabase Edge Functions (Deno).
// Copy of konto/supabase/functions/_shared/rules.ts (the Edge Functions live in the konto repo): keep both identical.
// The server is authoritative for online games; the client uses the same code for local games and previews.
//
// Rules:
// - 4x4 board, index = row * 4 + col. Lines = 4 rows, 4 cols, 2 diagonals (10 total).
// - Only lines through the just-placed cell are evaluated, all at once:
//   - 4 of one player  -> that player scores +1 per such line; the line is cleared (frozen cells included).
//   - 2:2              -> the line is cleared (frozen cells included).
//   - 3:1              -> the single minority piece freezes for FREEZE_MOVES moves (existing timer kept), rest stays.
//   Clears win over freezes: a cell cleared by any line is removed even if another line would freeze it.
// - After resolving, timers of cells frozen BEFORE this move tick down by 1; at 0 the cell vanishes.
//   ("3 moves total": any player's move counts.)
// - First to WIN_SCORE wins. If no empty cell remains, the turn passes automatically (timers still tick).

export type Player = 'X' | 'O';

export interface Cell {
  p: Player;
  /** Moves left until this piece vanishes. Absent = not frozen. */
  frozen?: number;
}

export interface GameState {
  board: (Cell | null)[]; // length 16
  turn: Player;
  score: Record<Player, number>;
  winner: Player | null;
  moves: number; // total moves played (incl. auto-passes)
}

export type GameEvent =
  | { kind: 'score'; player: Player; line: number[] }
  | { kind: 'clear'; line: number[] }
  | { kind: 'freeze'; cell: number }
  | { kind: 'thaw'; cell: number } // frozen piece vanished
  | { kind: 'pass'; player: Player }; // player had no empty cell

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
}

export const SIZE = 4;
export const WIN_SCORE = 3;
export const FREEZE_MOVES = 3;
export const LINES: readonly (readonly number[])[] = (() => {
  const r = [0, 1, 2, 3];
  return [
    ...r.map((row) => r.map((c) => row * SIZE + c)),
    ...r.map((col) => r.map((row) => row * SIZE + col)),
    r.map((i) => i * SIZE + i),
    r.map((i) => i * SIZE + (SIZE - 1 - i)),
  ];
})();

const other = (p: Player): Player => (p === 'X' ? 'O' : 'X');

export function newGame(starter: Player = 'X'): GameState {
  return { board: Array(SIZE * SIZE).fill(null), turn: starter, score: { X: 0, O: 0 }, winner: null, moves: 0 };
}

/** Empty cell indices; [] if game over. */
export function legalMoves(s: GameState): number[] {
  if (s.winner) return [];
  const out: number[] = [];
  s.board.forEach((c, i) => c === null && out.push(i));
  return out;
}

/** Ticks timers of the given (previously frozen) cells; removes those reaching 0. */
function tick(board: (Cell | null)[], cells: number[], events: GameEvent[]): void {
  for (const i of cells) {
    const c = board[i];
    if (!c?.frozen) continue;
    if (c.frozen <= 1) {
      board[i] = null;
      events.push({ kind: 'thaw', cell: i });
    } else board[i] = { p: c.p, frozen: c.frozen - 1 };
  }
}

const frozenCells = (board: (Cell | null)[]): number[] =>
  board.flatMap((c, i) => (c?.frozen ? [i] : []));

/** Returns a new state (input not mutated). Throws Error on illegal move (occupied, out of range, game over). */
export function applyMove(s: GameState, index: number): MoveResult {
  if (s.winner) throw new Error('game over');
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE) throw new Error('index out of range');
  if (s.board[index] !== null) throw new Error('cell occupied');

  const me = s.turn;
  const board = s.board.map((c) => (c ? { ...c } : null));
  const score = { ...s.score };
  const events: GameEvent[] = [];
  const frozenBefore = frozenCells(board);

  board[index] = { p: me };
  const cleared = new Set<number>();
  const toFreeze: number[] = [];
  for (const line of LINES) {
    if (!line.includes(index) || line.some((i) => board[i] === null)) continue;
    const mine = line.filter((i) => board[i]!.p === me);
    const theirs = line.filter((i) => board[i]!.p !== me);
    if (mine.length === SIZE) {
      // placed piece is `me`, so a 4-same line through it is always the mover's
      score[me]++;
      events.push({ kind: 'score', player: me, line: [...line] });
    }
    if (mine.length === SIZE || mine.length === 2) {
      line.forEach((i) => cleared.add(i));
      events.push({ kind: 'clear', line: [...line] });
    } else toFreeze.push(mine.length === 1 ? mine[0] : theirs[0]);
  }
  for (const i of toFreeze) {
    const c = board[i]!;
    if (cleared.has(i) || c.frozen) continue; // clears beat freezes; existing timer kept
    board[i] = { p: c.p, frozen: FREEZE_MOVES };
    events.push({ kind: 'freeze', cell: i });
  }
  cleared.forEach((i) => (board[i] = null));
  tick(board, frozenBefore, events);

  let turn = me;
  let moves = s.moves + 1;
  let winner: Player | null = null;
  if (score[me] >= WIN_SCORE) winner = me;
  else {
    turn = other(me);
    // auto-pass: a full board always holds a frozen cell (the placed cell's lines all resolved), so this ends within FREEZE_MOVES passes
    for (let guard = 0; !board.includes(null) && guard < SIZE * SIZE; guard++) {
      events.push({ kind: 'pass', player: turn });
      tick(board, frozenCells(board), events);
      turn = other(turn);
      moves++;
    }
  }
  return { state: { board, turn, score, winner, moves }, events };
}

const isNatInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isPlayer = (v: unknown): v is Player => v === 'X' || v === 'O';
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const hasOnlyKeys = (o: object, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

/** Structural validation for untrusted state JSON (server side). */
export function isValidState(x: unknown): x is GameState {
  if (!isObj(x) || !hasOnlyKeys(x, ['board', 'turn', 'score', 'winner', 'moves'])) return false;
  const { board, turn, score, winner, moves } = x;
  if (!Array.isArray(board) || board.length !== SIZE * SIZE) return false;
  for (let i = 0; i < board.length; i++) {
    const c: unknown = board[i];
    if (c === null) continue;
    if (!isObj(c) || !hasOnlyKeys(c, ['p', 'frozen']) || !isPlayer(c.p)) return false;
    if ('frozen' in c && !(isNatInt(c.frozen) && c.frozen >= 1 && c.frozen <= FREEZE_MOVES)) return false;
  }
  return (
    isPlayer(turn) &&
    isObj(score) &&
    hasOnlyKeys(score, ['X', 'O']) &&
    isNatInt(score.X) &&
    isNatInt(score.O) &&
    (winner === null || isPlayer(winner)) &&
    isNatInt(moves)
  );
}
