import type { GameState, Player } from '../shared/rules.ts';
import { WIN_SCORE } from '../shared/rules.ts';
import { pieceSvg } from './pieces.ts';

export interface Scoreboard {
  /** names: display names per player (e.g. online nicknames). Set via textContent, so untrusted input is safe. */
  render(state: GameState, names?: Partial<Record<Player, string>>): void;
}

export function createScoreboard(container: HTMLElement): Scoreboard {
  const el = document.createElement('div');
  el.className = 'scoreboard';
  const cards = (['X', 'O'] as const).map((p) => {
    const card = document.createElement('div');
    card.className = `player ${p.toLowerCase()}`;
    card.innerHTML = `<span class="player-icon">${pieceSvg(p)}</span>
      <span class="player-name"></span>
      <span class="pips" aria-hidden="true">${'<span class="pip"></span>'.repeat(WIN_SCORE)}</span>
      <span class="sr-only"></span>`;
    el.append(card);
    return { p, card };
  });
  container.append(el);

  return {
    render(state, names = {}) {
      for (const { p, card } of cards) {
        const name = names[p] ?? `Spieler ${p}`;
        card.querySelector('.player-name')!.textContent = name;
        card.querySelectorAll('.pip').forEach((pip, i) => pip.classList.toggle('on', i < state.score[p]));
        card.querySelector('.sr-only')!.textContent = `: ${state.score[p]} von ${WIN_SCORE} Punkten`;
        card.classList.toggle('is-turn', !state.winner && state.turn === p);
        card.classList.toggle('is-winner', state.winner === p);
      }
    },
  };
}
