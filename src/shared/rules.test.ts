import { describe, expect, it } from 'vitest';
import { applyMove, FREEZE_MOVES, isValidState, legalMoves, LINES, newGame, type GameState, type Player } from './rules';

/** Board from 16 chars ('X', 'O', '.'; spaces ignored). `frozen` maps index -> timer. */
function state(layout: string, frozen: Record<number, number> = {}, extra: Partial<GameState> = {}): GameState {
  const chars = layout.replace(/\s/g, '').split('');
  if (chars.length !== 16) throw new Error('bad layout');
  const board = chars.map((ch, i) => {
    if (ch === '.') return null;
    const p = ch as Player;
    return frozen[i] ? { p, frozen: frozen[i] } : { p };
  });
  return { board, turn: 'X', score: { X: 0, O: 0 }, winner: null, moves: 0, ...extra };
}

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

describe('basics', () => {
  it('has 10 lines of 4', () => {
    expect(LINES).toHaveLength(10);
    expect(LINES.every((l) => l.length === 4)).toBe(true);
    expect(LINES).toContainEqual([0, 5, 10, 15]);
    expect(LINES).toContainEqual([3, 6, 9, 12]);
  });

  it('newGame is empty and valid', () => {
    const g = newGame('O');
    expect(g.turn).toBe('O');
    expect(legalMoves(g)).toHaveLength(16);
    expect(isValidState(g)).toBe(true);
    expect(newGame().turn).toBe('X');
  });

  it('plain move switches turn and counts', () => {
    const { state: s, events } = applyMove(newGame(), 5);
    expect(s.board[5]).toEqual({ p: 'X' });
    expect(s.turn).toBe('O');
    expect(s.moves).toBe(1);
    expect(events).toEqual([]);
  });
});

describe('4 of one player scores and clears', () => {
  it.each([
    ['row', 'XXX. .... .... ....', 3, [0, 1, 2, 3]],
    ['col', 'X... X... X... ....', 12, [0, 4, 8, 12]],
    ['diag', 'X... .X.. ..X. ....', 15, [0, 5, 10, 15]],
    ['anti-diag', '...X ..X. .X.. ....', 12, [3, 6, 9, 12]],
  ])('%s', (_name, layout, move, line) => {
    const { state: s, events } = applyMove(state(layout as string), move as number);
    expect(s.score).toEqual({ X: 1, O: 0 });
    for (const i of line as number[]) expect(s.board[i]).toBeNull();
    expect(events).toEqual([
      { kind: 'score', player: 'X', line },
      { kind: 'clear', line },
    ]);
    expect(s.turn).toBe('O');
  });

  it('O scores on its own turn', () => {
    const { state: s } = applyMove(state('OOO. .... .... ....', {}, { turn: 'O' }), 3);
    expect(s.score).toEqual({ X: 0, O: 1 });
  });

  it('frozen cell in a 4-same line counts and is cleared', () => {
    const { state: s, events } = applyMove(state('XXX. .... .... ....', { 0: 2 }), 3);
    expect(s.score.X).toBe(1);
    expect(s.board.slice(0, 4)).toEqual([null, null, null, null]);
    expect(kinds(events)).toEqual(['score', 'clear']); // no thaw for a cleared frozen cell
  });

  it('does not evaluate full lines that do not pass through the placed cell', () => {
    const { state: s } = applyMove(state('XXXX .... .... ....'), 5);
    expect(s.board.slice(0, 4).every((c) => c?.p === 'X')).toBe(true);
    expect(s.score.X).toBe(0);
  });
});

describe('2:2 clears', () => {
  it('clears without score', () => {
    const { state: s, events } = applyMove(state('XOO. .... .... ....'), 3);
    expect(s.board.slice(0, 4)).toEqual([null, null, null, null]);
    expect(s.score).toEqual({ X: 0, O: 0 });
    expect(events).toEqual([{ kind: 'clear', line: [0, 1, 2, 3] }]);
  });

  it('clears a frozen cell too', () => {
    const { state: s, events } = applyMove(state('XOO. .... .... ....', { 1: 3 }), 3);
    expect(s.board.slice(0, 4)).toEqual([null, null, null, null]);
    expect(kinds(events)).toEqual(['clear']);
  });
});

describe('3:1 freezes', () => {
  it('freezes the opponent minority piece', () => {
    const { state: s, events } = applyMove(state('XXO. .... .... ....'), 3);
    expect(s.board[2]).toEqual({ p: 'O', frozen: FREEZE_MOVES });
    expect(s.board[0]).toEqual({ p: 'X' });
    expect(s.board[3]).toEqual({ p: 'X' });
    expect(events).toEqual([{ kind: 'freeze', cell: 2 }]);
  });

  it("freezes the mover's own piece when it is the minority", () => {
    const { state: s } = applyMove(state('OOO. .... .... ....'), 3);
    expect(s.board[3]).toEqual({ p: 'X', frozen: FREEZE_MOVES });
  });

  it('thaws after exactly 3 subsequent moves', () => {
    let { state: s } = applyMove(state('XXO. .... .... ....'), 3);
    let r = applyMove(s, 4); // O
    expect(r.state.board[2]).toEqual({ p: 'O', frozen: 2 });
    r = applyMove(r.state, 5); // X
    expect(r.state.board[2]).toEqual({ p: 'O', frozen: 1 });
    expect(kinds(r.events)).toEqual([]);
    r = applyMove(r.state, 6); // O
    expect(r.state.board[2]).toBeNull();
    expect(r.events).toEqual([{ kind: 'thaw', cell: 2 }]);
    s = r.state;
    expect(legalMoves(s)).toContain(2);
  });

  it('keeps an existing timer (and still ticks it)', () => {
    const { state: s, events } = applyMove(state('XXO. .... .... ....', { 2: 2 }), 3);
    expect(s.board[2]).toEqual({ p: 'O', frozen: 1 });
    expect(kinds(events)).toEqual([]);
  });

  it('placed piece minority in two lines freezes once', () => {
    // row0 O O O + X, col3 X + O O O
    const { state: s, events } = applyMove(state('OOO. ...O ...O ...O'), 3);
    expect(s.board[3]).toEqual({ p: 'X', frozen: 3 });
    expect(events).toEqual([{ kind: 'freeze', cell: 3 }]);
  });
});

describe('simultaneous lines', () => {
  it('score in one line + freeze in another', () => {
    const { state: s, events } = applyMove(state('XXX. ...X ...X ...O'), 3);
    expect(s.score.X).toBe(1);
    expect(s.board.slice(0, 4)).toEqual([null, null, null, null]);
    expect(s.board[15]).toEqual({ p: 'O', frozen: 3 });
    expect(s.board[7]).toEqual({ p: 'X' });
    expect(kinds(events).sort()).toEqual(['clear', 'freeze', 'score']);
  });

  it('double score clears both lines', () => {
    const { state: s, events } = applyMove(state('XXX. ...X ...X ...X'), 3);
    expect(s.score.X).toBe(2);
    for (const i of [0, 1, 2, 3, 7, 11, 15]) expect(s.board[i]).toBeNull();
    expect(kinds(events).filter((k) => k === 'score')).toHaveLength(2);
  });

  it('clear beats freeze', () => {
    // row0 XXXX clears; col3 X O O O would freeze X at 3
    const { state: s, events } = applyMove(state('XXX. ...O ...O ...O'), 3);
    expect(s.board[3]).toBeNull();
    expect(s.score.X).toBe(1);
    expect(kinds(events)).not.toContain('freeze');
    expect(s.board[7]).toEqual({ p: 'O' });
  });

  it('2:2 clear beats freeze of a cell in another line', () => {
    // row0 X O O X clears (2:2); col0 O(0)? -> col0: 0 X,4 O,8 O,12 O: X at 0 minority, but 0 is cleared
    const { state: s, events } = applyMove(state('.OOX O... O... O...'), 0);
    expect(s.board[0]).toBeNull();
    expect(kinds(events)).toEqual(['clear']);
    expect(s.board[4]).toEqual({ p: 'O' });
  });
});

describe('illegal moves', () => {
  it.each([-1, 16, 1.5, NaN, Infinity])('rejects index %s', (i) => {
    expect(() => applyMove(newGame(), i)).toThrow(Error);
  });

  it('rejects occupied cell', () => {
    expect(() => applyMove(state('X... .... .... ....'), 0)).toThrow(/occupied/);
  });

  it('rejects moves after game over', () => {
    expect(() => applyMove(state('.... .... .... ....', {}, { winner: 'O' }), 0)).toThrow(/over/);
  });
});

describe('win', () => {
  it('wins at 3 and blocks further moves', () => {
    const { state: s } = applyMove(state('XXX. .... .... ....', {}, { score: { X: 2, O: 1 } }), 3);
    expect(s.score.X).toBe(3);
    expect(s.winner).toBe('X');
    expect(s.turn).toBe('X');
    expect(legalMoves(s)).toEqual([]);
    expect(() => applyMove(s, 5)).toThrow();
  });

  it('no winner at 2', () => {
    const { state: s } = applyMove(state('XXX. .... .... ....', {}, { score: { X: 1, O: 0 } }), 3);
    expect(s.winner).toBeNull();
  });
});

describe('immutability', () => {
  it('does not mutate the input state', () => {
    const input = state('XXX. ..O. ...X ...O', { 6: 2 });
    const snapshot = structuredClone(input);
    const { state: s } = applyMove(input, 3);
    expect(input).toEqual(snapshot);
    expect(s.board).not.toBe(input.board);
    expect(s.score).not.toBe(input.score);
  });
});

describe('auto-pass', () => {
  it('passes until a frozen piece thaws', () => {
    // all three lines through 0 become 3:1 with O minority; rest of the board full
    const layout = '.XXO XXOX XOXO OXOO';
    const { state: s, events } = applyMove(state(layout), 0);
    expect(events.filter((e) => e.kind === 'freeze').map((e) => (e as { cell: number }).cell).sort((a, b) => a - b)).toEqual([3, 12, 15]);
    expect(events.filter((e) => e.kind === 'pass')).toEqual([
      { kind: 'pass', player: 'O' },
      { kind: 'pass', player: 'X' },
      { kind: 'pass', player: 'O' },
    ]);
    expect(events.filter((e) => e.kind === 'thaw')).toHaveLength(3);
    expect(legalMoves(s).sort((a, b) => a - b)).toEqual([3, 12, 15]);
    expect(s.turn).toBe('X');
    expect(s.moves).toBe(4);
    expect(isValidState(s)).toBe(true);
  });

  it('no pass when an old frozen piece thaws during the move', () => {
    const layout = '.XXO XXOX XOXO OXOO';
    const { state: s, events } = applyMove(state(layout, { 5: 1 }), 0);
    expect(s.board[5]).toBeNull();
    expect(kinds(events)).not.toContain('pass');
    expect(s.turn).toBe('O');
    expect(s.moves).toBe(1);
  });
});

describe('isValidState', () => {
  const ok = () => JSON.parse(JSON.stringify(state('XO.. .... .... ....', { 1: 2 }))) as Record<string, unknown>;

  it('accepts valid JSON state', () => {
    expect(isValidState(ok())).toBe(true);
  });

  const bad: [string, (s: any) => unknown][] = [
    ['null', () => null],
    ['array', () => []],
    ['string', () => 'x'],
    ['extra top-level key', (s) => ({ ...s, hack: 1 })],
    ['missing score', (s) => ({ ...s, score: undefined })],
    ['short board', (s) => ({ ...s, board: s.board.slice(1) })],
    ['sparse board', (s) => ({ ...s, board: new Array(16) })],
    ['bad player in cell', (s) => ((s.board[0] = { p: 'Z' }), s)],
    ['cell is string', (s) => ((s.board[0] = 'X'), s)],
    ['cell extra key', (s) => ((s.board[0] = { p: 'X', x: 1 }), s)],
    ['frozen 0', (s) => ((s.board[0] = { p: 'X', frozen: 0 }), s)],
    ['frozen too big', (s) => ((s.board[0] = { p: 'X', frozen: FREEZE_MOVES + 1 }), s)],
    ['frozen fraction', (s) => ((s.board[0] = { p: 'X', frozen: 1.5 }), s)],
    ['frozen null', (s) => ((s.board[0] = { p: 'X', frozen: null }), s)],
    ['bad turn', (s) => ({ ...s, turn: 'Z' })],
    ['negative score', (s) => ({ ...s, score: { X: -1, O: 0 } })],
    ['fractional score', (s) => ({ ...s, score: { X: 0.5, O: 0 } })],
    ['score extra key', (s) => ({ ...s, score: { X: 0, O: 0, Z: 1 } })],
    ['score missing key', (s) => ({ ...s, score: { X: 0 } })],
    ['bad winner', (s) => ({ ...s, winner: 'Q' })],
    ['undefined winner', (s) => ({ ...s, winner: undefined })],
    ['negative moves', (s) => ({ ...s, moves: -1 })],
    ['string moves', (s) => ({ ...s, moves: '1' })],
  ];
  it.each(bad)('rejects %s', (_name, mutate) => {
    expect(isValidState(mutate(ok()))).toBe(false);
  });
});
