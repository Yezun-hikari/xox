import { describe, expect, it } from 'vitest';
import { BOT_ELO_MAX, BOT_ELO_MIN, NEUTRAL_STYLE, botEloFor, botName, chooseMove, styleOf, thinkTimeMs, type Style } from './bot.ts';
import { applyMove, legalMoves, newGame, type GameState, type Player } from './rules.ts';

/** Deterministic rng so the tests cannot flake. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function play(xElo: number, oElo: number, seed: number, xStyle?: Style, oStyle?: Style): Player | null {
  const rng = seeded(seed);
  let s: GameState = newGame('X');
  for (let n = 0; n < 200 && !s.winner; n++) {
    const x = s.turn === 'X';
    s = applyMove(s, chooseMove(s, x ? xElo : oElo, rng, x ? xStyle : oStyle)).state;
  }
  return s.winner;
}

/** Wins of a over b, half the games on each seat. */
function wins(aElo: number, bElo: number, games: number, aStyle?: Style, bStyle?: Style): number {
  let n = 0;
  for (let g = 0; g < games; g++) {
    const aIsX = g % 2 === 0;
    const w = aIsX ? play(aElo, bElo, g + 100, aStyle, bStyle) : play(bElo, aElo, g + 100, bStyle, aStyle);
    if (w === (aIsX ? 'X' : 'O')) n++;
  }
  return n;
}

/** State from a 16-char board ('.' empty). */
function pos(board: string, turn: Player): GameState {
  return {
    board: [...board].map((c) => (c === '.' ? null : { p: c as Player })),
    turn,
    score: { X: 0, O: 0 },
    winner: null,
    moves: board.replace(/\./g, '').length,
  };
}

// O to move, X would score on `block`; O has nothing better than blocking.
const THREATS: { board: string; block: number }[] = [
  { board: 'XXX.' + '..O.' + '....' + '.O..', block: 3 },
  { board: 'X...' + 'X.O.' + 'X...' + '...O', block: 12 },
  { board: 'X...' + '.XO.' + '..X.' + '.O..', block: 15 },
  { board: 'XX.X' + '....' + '.O..' + '...O', block: 2 },
  { board: '..O.' + '.XXX' + 'O...' + '....', block: 4 },
];

function blockRate(elo: number, trials: number, style?: Style): number {
  const rng = seeded(elo);
  let blocked = 0;
  for (const { board, block } of THREATS) {
    const s = pos(board, 'O');
    for (let n = 0; n < trials; n++) if (chooseMove(s, elo, rng, style) === block) blocked++;
  }
  return blocked / (trials * THREATS.length);
}

describe('bot', () => {
  it('always plays a legal move', () => {
    const rng = seeded(1);
    let s = newGame('X');
    for (let n = 0; n < 40 && !s.winner; n++) {
      const i = chooseMove(s, 900, rng);
      expect(legalMoves(s)).toContain(i);
      s = applyMove(s, i).state;
    }
  });

  it('takes an immediate point when strong', () => {
    // X has three in row 0 (O has no threat), cell 3 completes it
    let s = newGame('X');
    for (const i of [0, 4, 1, 9, 2, 14]) s = applyMove(s, i).state;
    s = { ...s, turn: 'X' };
    expect(chooseMove(s, 1400, () => 0.99)).toBe(3);
  });

  it('strong bot beats weak bot most of the time', () => {
    let strong = 0;
    for (let g = 0; g < 12; g++) {
      const w = g % 2 === 0 ? play(1400, 600, g + 10) : play(600, 1400, g + 10);
      if (w === (g % 2 === 0 ? 'X' : 'O')) strong++;
    }
    expect(strong).toBeGreaterThanOrEqual(9);
  });

  it('blocks an open three about 60% at Elo 100, rising above 90% at high Elo', { timeout: 60_000 }, () => {
    const rates = [100, 600, 1000, 1400].map((elo) => blockRate(elo, elo < 1000 ? 400 : 60));
    expect(rates[0]).toBeGreaterThan(0.5);
    expect(rates[0]).toBeLessThan(0.7);
    expect(rates[1]).toBeGreaterThan(rates[0]);
    expect(rates[2]).toBeGreaterThan(rates[1]);
    expect(rates[3]).toBeGreaterThan(0.9);
  });

  it('takes its own point at least as often as it blocks, also with a threat on the board', () => {
    const s = pos('XXX.' + 'OOO.' + '....' + '....', 'O');
    const rng = seeded(5);
    for (const elo of [100, 600]) {
      let points = 0;
      for (let n = 0; n < 400; n++) if (chooseMove(s, elo, rng) === 7) points++;
      expect(points / 400).toBeGreaterThanOrEqual(blockRate(elo, 400) - 0.03);
    }
    expect(chooseMove(s, 1400, rng)).toBe(7);
  });

  it('only a strong bot drops its point to stop a game-losing line', { timeout: 30_000 }, () => {
    const s = { ...pos('XXX.' + 'OOO.' + '....' + '....', 'O'), score: { X: 2, O: 0 } };
    expect(chooseMove(s, 1400, () => 0.5)).toBe(3);
    expect(chooseMove(s, 100, () => 0.5)).toBe(7);
  });

  it('mistakes stay near own pieces or on own lines', () => {
    const s = pos('O...' + '....' + '....' + '...X', 'O');
    const rng = seeded(9);
    const plausible = new Set([1, 2, 3, 4, 8, 12, 5]);
    let hits = 0;
    for (let n = 0; n < 400; n++) if (plausible.has(chooseMove(s, 100, rng))) hits++;
    expect(hits / 400).toBeGreaterThan(0.85);
  });

  it('styles are fixed per name, neutral for unknown names', () => {
    expect(styleOf('Turbo-Tim (Bot)')).toEqual(styleOf('Turbo-Tim'));
    expect(styleOf('Turbo-Tim (Bot)').attack).toBeGreaterThan(styleOf('Nano-Nora (Bot)').attack);
    expect(styleOf('Somebody')).toEqual(NEUTRAL_STYLE);
  });

  it('attacking style builds its own lines, defensive style spoils the opponent\'s', () => {
    // O can extend its own pair on row 3 or spoil X's pair on row 0
    const s = pos('XX..' + '....' + '....' + 'OO..', 'O');
    const spoils = (style: Style): number => {
      const rng = seeded(21);
      let n = 0;
      for (let t = 0; t < 300; t++) {
        const i = chooseMove(s, 900, rng, style);
        if (i === 2 || i === 3) n++;
      }
      return n;
    };
    expect(spoils(styleOf('Nano-Nora'))).toBeGreaterThan(spoils(styleOf('Turbo-Tim')));
  });

  it('style does not change strength much at the same Elo', { timeout: 60_000 }, () => {
    const a = wins(600, 600, 100, styleOf('Turbo-Tim'), styleOf('Nano-Nora'));
    expect(a).toBeGreaterThan(30);
    expect(a).toBeLessThan(70);
  });

  it('strength rises with Elo', { timeout: 120_000 }, () => {
    expect(wins(1400, 100, 100)).toBeGreaterThanOrEqual(65);
    expect(wins(700, 100, 60)).toBeGreaterThan(30);
  });

  it('think time is 300-2000 ms, shorter for obvious moves', () => {
    const rng = seeded(31);
    const avg = (s: GameState): number => {
      let sum = 0;
      for (let n = 0; n < 300; n++) {
        const t = thinkTimeMs(s, 600, rng);
        expect(t).toBeGreaterThanOrEqual(300);
        expect(t).toBeLessThanOrEqual(2000);
        sum += t;
      }
      return sum / 300;
    };
    const block = avg(pos('XXX.' + '..O.' + '....' + '.O..', 'O'));
    const open = avg(pos('XX..' + '..O.' + '.O..' + '...X', 'O'));
    expect(open).toBeGreaterThan(block + 200);
    expect(avg(newGame('X'))).toBeLessThan(open);
  });

  it('bot Elo stays near the player and inside the clamp', () => {
    const rng = seeded(7);
    for (let n = 0; n < 200; n++) {
      expect(Math.abs(botEloFor(1000, rng) - 1000)).toBeLessThanOrEqual(100);
      const e = botEloFor(3000, rng);
      expect(e).toBeLessThanOrEqual(BOT_ELO_MAX);
      expect(botEloFor(0, rng)).toBeGreaterThanOrEqual(BOT_ELO_MIN);
      expect(e).toBeGreaterThanOrEqual(BOT_ELO_MIN);
    }
    expect(botName(() => 0)).toMatch(/\(Bot\)$/);
  });
});
