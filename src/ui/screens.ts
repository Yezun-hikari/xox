import type { Player } from '../../supabase/functions/_shared/rules.ts';
import { applyMove, newGame } from '../../supabase/functions/_shared/rules.ts';
import { announce, toast } from './announce.ts';
import { createBoard } from './board.ts';
import { cellName, describeEvents } from './events.ts';
import type { Screen } from './router.ts';
import { openRules } from './rules-dialog.ts';
import { createScoreboard } from './scoreboard.ts';
import { play } from './sound.ts';

const LOGO = `<svg class="logo" viewBox="0 0 120 40" aria-hidden="true">
  <path class="lx" d="M6 8l24 24M30 8L6 32"/><circle class="lo" cx="60" cy="20" r="12"/><path class="lx" d="M90 8l24 24M114 8L90 32"/></svg>`;

export const homeScreen: Screen = {
  title: 'Start',
  mount(root) {
    root.innerHTML = `
      <section class="home">
        <div class="hero">
          ${LOGO}
          <h1 tabindex="-1">XOX</h1>
          <p class="tagline">Tic-Tac-Toe auf 4×4 – mit Punkten, Räumen und Einfrieren.</p>
        </div>
        <nav class="menu" aria-label="Spielmodus">
          <a class="btn primary big" href="#/local">Lokal spielen<small>Zu zweit an einem Gerät</small></a>
          <a class="btn big" href="#/online">Online spielen<small>Gegen andere mit Elo-Wertung</small></a>
          <a class="btn big" href="#/account">Konto<small>Anmelden und Spitzname</small></a>
          <button class="btn ghost-btn" type="button" data-rules>Wie spielt man?</button>
        </nav>
      </section>`;
    root.querySelector('[data-rules]')!.addEventListener('click', openRules);
  },
};

/** Placeholder until src/online registers the real screen. */
export const placeholderScreen = (title: string): Screen => ({
  title,
  mount(root) {
    root.innerHTML = `
      <section class="placeholder">
        <a class="back" href="#/">← Menü</a>
        <h1 tabindex="-1"></h1>
        <p>Bald verfügbar.</p>
        <a class="btn primary" href="#/local">Lokal spielen</a>
      </section>`;
    root.querySelector('h1')!.textContent = title;
  },
});

// Alternates the starter per match for as long as the page is open.
let matchNo = 0;

export const localScreen: Screen = {
  title: 'Lokal',
  mount(root) {
    root.innerHTML = `
      <section class="game">
        <div class="game-head">
          <a class="back" href="#/">← Menü</a>
          <h1 tabindex="-1">Lokales Spiel</h1>
        </div>
        <div data-score></div>
        <p class="status" data-status></p>
        <div class="board-wrap" data-board></div>
        <div class="end" data-end hidden>
          <button class="btn primary" type="button" data-rematch>Revanche</button>
          <a class="btn" href="#/">Menü</a>
        </div>
      </section>`;
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const status = $('[data-status]');
    const end = $('[data-end]');
    const scoreboard = createScoreboard($('[data-score]'));
    let state = newGame();

    const board = createBoard($('[data-board]'), {
      onCellClick(i) {
        const mover = state.turn;
        let res;
        try {
          res = applyMove(state, i);
        } catch {
          return; // illegal move: ignore
        }
        state = res.state;
        board.render(state, res.events, { lastMove: i });
        update();
        const lines = [`${mover} auf ${cellName(i)}.`, ...describeEvents(res.events), statusText()];
        announce(lines.join(' '));
        const visible = describeEvents(res.events.filter((e) => e.kind === 'pass' || e.kind === 'score'));
        if (visible.length && !state.winner) toast(visible.join(' '));
        if (state.winner) {
          $('[data-rematch]').focus();
          setTimeout(() => play('win'), 450); // after the place and score sounds of the winning move
        }
      },
    });

    const statusText = () => (state.winner ? `${state.winner} gewinnt!` : `${state.turn} ist am Zug`);

    function update(): void {
      scoreboard.render(state);
      status.textContent = statusText();
      status.dataset.player = (state.winner ?? state.turn).toLowerCase();
      status.classList.toggle('won', !!state.winner);
      end.hidden = !state.winner;
    }

    function start(): void {
      const starter: Player = matchNo++ % 2 === 0 ? 'X' : 'O';
      state = newGame(starter);
      board.render(state);
      update();
      announce(`Neues Spiel. ${starter} beginnt.`);
    }

    $('[data-rematch]').addEventListener('click', () => {
      start();
      board.focus();
    });
    start();
  },
};
