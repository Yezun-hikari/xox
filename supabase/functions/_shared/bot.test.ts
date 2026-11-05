import { describe, expect, it } from 'vitest';
import { BOT_ELO_MAX, BOT_ELO_MIN, botEloFor, botName, chooseMove } from './bot.ts';
import { applyMove, legalMoves, newGame, type GameState, type Player } from './rules.ts';

/** Deterministic rng so the tests cannot flake. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function play(xElo: number, oElo: number, seed: number): Player | null {
  const rng = seeded(seed);
  let s: GameState = newGame('X');
  for (let n = 0; n < 200 && !s.winner; n++) s = applyMove(s, chooseMove(s, s.turn === 'X' ? xElo : oElo, rng)).state;
  return s.winner;
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
