import type { Player } from '../shared/rules.ts';
import { applyMove, newGame } from '../shared/rules.ts';
import { announce, toast } from './announce.ts';
import { createBoard } from './board.ts';
import { cellName, describeEvents } from './events.ts';
import type { Screen } from './router.ts';
import { rulesList } from './rules-dialog.ts';
import { createScoreboard } from './scoreboard.ts';
import { play } from './sound.ts';

/** Decorative mini board for the menu (static markup). */
const MOTIF = `<svg class="home-motif" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <g class="m-grid"><path d="M25 3v94M50 3v94M75 3v94M3 25h94M3 50h94M3 75h94"/></g>
  <g class="m-x"><path d="M7.5 7.5l10 10M17.5 7.5l-10 10M82.5 32.5l10 10M92.5 32.5l-10 10M32.5 82.5l10 10M42.5 82.5l-10 10"/></g>
  <g class="m-o"><circle cx="37.5" cy="37.5" r="6"/><circle cx="62.5" cy="62.5" r="6"/><circle cx="87.5" cy="12.5" r="6"/></g>
</svg>`;

export const homeScreen: Screen = {
  title: 'Start',
  mount(root) {
    root.innerHTML = `
      <section class="home">
        <div class="home-intro">
          <div class="home-text">
            <h1 tabindex="-1">Tic-Tac-Toe auf 4×4</h1>
            <p class="lead">Mit Punkten, Räumen und Einfrieren. Zu zweit an einem Gerät oder online gegen andere mit Elo-Wertung.</p>
            <nav class="menu" aria-label="Spielmodus">
              <a class="btn primary" href="#/local">Lokal spielen</a>
              <a class="btn" href="#/online">Online spielen</a>
            </nav>
          </div>
          ${MOTIF}
        </div>
        <section class="home-rules" aria-labelledby="home-rules-title">
          <h2 id="home-rules-title">Regeln</h2>
          ${rulesList()}
          <p class="hint">Steuerung: Tippen oder Klicken – oder Pfeiltasten und Enter.</p>
        </section>
      </section>`;
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
          <h1 tabindex="-1">Lokales Spiel</h1>
          <a class="back" href="#/">← Menü</a>
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
