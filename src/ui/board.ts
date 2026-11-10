import type { GameEvent, GameState, Player } from '../shared/rules.ts';
import { SIZE } from '../shared/rules.ts';
import { cellName, withoutScoredClears } from './events.ts';
import { pieceSvg } from './pieces.ts';
import { play, type SoundName } from './sound.ts';

export interface BoardOptions {
  /** Called for clicks / Enter on an empty cell while the board is interactive. */
  onCellClick(index: number): void;
}

export interface BoardRenderOptions {
  /** false = read-only (opponent's turn, game over). Default true. */
  interactive?: boolean;
  /** Online: the local player's piece (hover preview uses it instead of state.turn). */
  myPlayer?: Player;
  /** Index just played; otherwise inferred from the previous state. */
  lastMove?: number;
}

export interface Board {
  /** Render a state. Pass the move's events to animate them (relative to the previously rendered state). */
  render(state: GameState, events?: GameEvent[], opts?: BoardRenderOptions): void;
  focus(): void;
  destroy(): void;
}

const N = SIZE * SIZE;

export function createBoard(container: HTMLElement, { onCellClick }: BoardOptions): Board {
  const el = document.createElement('div');
  el.className = 'board';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Spielfeld, 4 mal 4. Pfeiltasten zum Bewegen, Enter zum Setzen.');

  const cells: HTMLButtonElement[] = [];
  const keys: string[] = []; // last rendered piece per cell, to skip needless DOM work
  let state: GameState | null = null;
  let interactive = false;
  let focusIdx = 0;

  for (let i = 0; i < N; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.tabIndex = i === 0 ? 0 : -1;
    b.innerHTML = '<span class="piece"></span><span class="badge" aria-hidden="true"></span>';
    b.addEventListener('click', () => {
      setFocus(i, false);
      if (interactive && state && !state.board[i]) onCellClick(i);
    });
    cells.push(b);
    keys.push('');
    el.append(b);
  }

  // Roving tabindex: one tab stop, arrows move within the grid.
  function setFocus(i: number, move = true): void {
    cells[focusIdx].tabIndex = -1;
    focusIdx = i;
    cells[i].tabIndex = 0;
    if (move) cells[i].focus();
  }

  el.addEventListener('keydown', (e) => {
    const r = Math.floor(focusIdx / SIZE);
    const c = focusIdx % SIZE;
    const next: Record<string, number> = {
      ArrowUp: ((r + SIZE - 1) % SIZE) * SIZE + c,
      ArrowDown: ((r + 1) % SIZE) * SIZE + c,
      ArrowLeft: r * SIZE + ((c + SIZE - 1) % SIZE),
      ArrowRight: r * SIZE + ((c + 1) % SIZE),
      Home: r * SIZE,
      End: r * SIZE + SIZE - 1,
    };
    if (e.key in next) {
      e.preventDefault();
      setFocus(next[e.key]);
    }
  });

  container.append(el);

  function ghost(i: number, p: Player, kind: string): void {
    const g = document.createElement('span');
    g.className = `ghost ${kind} ${p.toLowerCase()}`;
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML = pieceSvg(p);
    cells[i].append(g);
    const done = () => g.remove();
    g.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1500); // fallback if animations are disabled
  }

  function retrigger(i: number, cls: string): void {
    cells[i].classList.remove(cls);
    void cells[i].offsetWidth; // restart CSS animation
    cells[i].classList.add(cls);
  }

  function render(next: GameState, events: GameEvent[] = [], opts: BoardRenderOptions = {}): void {
    const prev = state;
    state = next;
    interactive = (opts.interactive ?? true) && !next.winner;
    el.classList.toggle('is-locked', !interactive);
    el.dataset.turn = (opts.myPlayer ?? next.turn).toLowerCase();

    const placed =
      opts.lastMove ?? (prev ? next.board.findIndex((c, i) => c && !prev.board[i]) : -1);

    for (let i = 0; i < N; i++) {
      const cell = next.board[i];
      const b = cells[i];
      const key = cell ? cell.p : '';
      if (keys[i] !== key) {
        const piece = b.querySelector('.piece')!;
        piece.className = cell ? `piece ${cell.p.toLowerCase()}` : 'piece';
        piece.innerHTML = cell ? pieceSvg(cell.p) : '';
        keys[i] = key;
      }
      const frozen = cell?.frozen;
      b.classList.toggle('filled', !!cell);
      b.classList.toggle('frozen', frozen !== undefined);
      b.querySelector('.badge')!.textContent = frozen !== undefined ? String(frozen) : '';
      b.setAttribute('aria-disabled', String(!interactive || !!cell));
      b.setAttribute(
        'aria-label',
        `${cellName(i)}: ${
          cell
            ? cell.p + (frozen !== undefined ? `, eingefroren, noch ${frozen} ${frozen === 1 ? 'Zug' : 'Züge'}` : '')
            : 'leer'
        }`,
      );
    }

    if (placed >= 0 && next.board[placed]) retrigger(placed, 'placed');
    if (!prev) return;

    const mover = prev.turn; // the player who just moved
    const sounds = new Set<SoundName>();
    // events.length: a clearing move leaves no new piece. prev.board check: online redraws may repeat lastMove.
    if (events.length || (placed >= 0 && next.board[placed] && !prev.board[placed])) {
      const p = next.board[placed]?.p ?? mover;
      sounds.add(!opts.myPlayer || p === opts.myPlayer ? 'place' : 'placeOpponent');
    }
    for (const e of withoutScoredClears(events)) {
      if (e.kind !== 'pass') sounds.add(e.kind);
      if (e.kind === 'score' || e.kind === 'clear') {
        for (const i of e.line) ghost(i, prev.board[i]?.p ?? mover, e.kind);
      } else if (e.kind === 'freeze') {
        retrigger(e.cell, 'just-frozen');
      } else if (e.kind === 'thaw') {
        const p = prev.board[e.cell]?.p;
        if (p) ghost(e.cell, p, 'thaw');
      }
    }
    // Slight stagger so one move's sounds stay distinct instead of smearing together.
    [...sounds].forEach((s, i) => setTimeout(() => play(s), i * 90));
  }

  return {
    render,
    focus: () => cells[focusIdx].focus(),
    destroy: () => el.remove(),
  };
}
