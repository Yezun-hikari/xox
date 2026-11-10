import type { RealtimeChannel } from '@supabase/supabase-js';
import type { GameEvent, GameState, Player } from '../shared/rules.ts';
import { applyMove } from '../shared/rules.ts';
import { thinkTimeMs } from '../shared/bot.ts';
import { ensureSession, getClient, isConfigured, NOT_CONFIGURED, type AuthUser } from '@yezun/konto';
import { announce, toast } from '../ui/announce.ts';
import { createBoard } from '../ui/board.ts';
import { cellName, describeEvents } from '../ui/events.ts';
import type { Screen } from '../ui/router.ts';
import { createScoreboard } from '../ui/scoreboard.ts';
import { play } from '../ui/sound.ts';
import { call, errorText, GAME, loadNickname, loadRating, nicknameForm, notConfigured, ratingText } from './api.ts';
import { createChat, type Chat } from './chat.ts';

const BOT_OFFER_MS = 5_000;
const HEARTBEAT_MS = 8_000; // server drops waiting players not seen for 20 s
const CHAT_OPEN_AFTER_FINISH_MS = 10 * 60_000; // same as chat-send, which has the last word
const RESULT_SOUND_DELAY_MS = 450; // the board plays place and score first
const TURN_SOUND_DELAY_MS = 250; // after the board's sound for the opponent's move

interface MatchRow {
  id: string;
  x_id: string;
  o_id: string;
  x_nick: string;
  o_nick: string;
  x_elo: number;
  o_elo: number;
  state: GameState;
  status: 'active' | 'finished';
  winner_id: string | null;
  elo_delta: number | null;
  x_delta: number | null;
  o_delta: number | null;
  turn_deadline: string;
  updated_at: string;
  is_bot: boolean;
}

type MatchResult = { status: 'waiting' } | { status: 'matched'; matchId: string } | { status: 'left' };

export const onlineScreen: Screen = {
  title: 'Online',
  mount(root) {
    if (!isConfigured()) return notConfigured(root, 'Online spielen', NOT_CONFIGURED);
    root.innerHTML = `
      <section class="panel" data-view><p class="muted">Verbinde …</p></section>`;
    const view = root.querySelector<HTMLElement>('[data-view]')!;
    let stop: (() => void) | null = null; // cleanup of the current sub-view
    let alive = true;
    let user: AuthUser;

    /** Replaces the sub-view. `build` returns its own cleanup. */
    function show(build: () => void | (() => void)): void {
      if (!alive) return;
      stop?.();
      stop = null;
      view.replaceChildren();
      stop = build() ?? null;
      view.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }

    function head(title: string, back = true): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'panel';
      if (back) {
        const a = document.createElement('a');
        a.className = 'back';
        a.href = '#/';
        a.textContent = '← Menü';
        wrap.append(a);
      }
      const h = document.createElement('h1');
      h.tabIndex = -1;
      h.textContent = title;
      wrap.append(h);
      return wrap;
    }

    function failure(text: string): void {
      show(() => {
        const p = document.createElement('p');
        p.className = 'msg error';
        p.textContent = text;
        const retry = button('Erneut versuchen', 'primary', () => void start());
        view.append(head('Online spielen'), p, retry);
      });
    }

    async function start(): Promise<void> {
      try {
        user = await ensureSession();
        // resume a running match (reload, second tab, reconnect)
        const { data, error } = await getClient()
          .from('matches')
          .select('id')
          .eq('game', GAME)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (data) return game(data.id);
        const nick = await loadNickname(user.id);
        if (nick) lobby(nick);
        else nicknameView();
      } catch (e) {
        failure(errorText(e));
      }
    }

    function nicknameView(): void {
      show(() => {
        const p = document.createElement('p');
        p.textContent = 'Wähle zuerst einen Spitznamen. Nur dein Gegner sieht ihn.';
        view.append(head('Online spielen'), p, nicknameForm(null, (nick) => lobby(nick)));
        view.querySelector('input')?.focus();
      });
    }

    function lobby(nick: string): void {
      show(() => {
        const info = document.createElement('p');
        info.textContent = `Du spielst als ${nick}.`;
        const stats = document.createElement('p');
        stats.className = 'stats';
        loadRating(user.id)
          .then((r) => (stats.textContent = ratingText(r)))
          .catch(() => {});
        const go = button('Gegner suchen', 'primary big', () => void search());
        const change = document.createElement('a');
        change.className = 'btn ghost-btn';
        change.href = '#/account';
        change.textContent = 'Spitzname / Konto';
        view.append(head('Online spielen'), info, stats, go, change);
      });
    }

    async function search(): Promise<void> {
      show(() => {
        let done = false;
        const p = document.createElement('p');
        p.className = 'status';
        p.textContent = 'Suche Gegner …';
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const cancel = button('Abbrechen', '', async () => {
          cancel.disabled = true;
          finish();
          try {
            const r = await call<MatchResult>('matchmake', { action: 'leave', game: GAME });
            if (r.status === 'matched') {
              play('match');
              return game(r.matchId);
            }
          } catch {
            /* leaving is best effort: the server drops us after 20 s without heartbeat anyway */
          }
          start();
        });
        const botBtn = button('Gegen Bot spielen', 'primary', async () => {
          botBtn.disabled = true;
          try {
            const r = await call<{ matchId: string }>('bot-game', { game: GAME });
            if (!done) matched(r.matchId);
          } catch (e) {
            botBtn.disabled = false;
            toast(errorText(e));
          }
        });
        botBtn.hidden = true;
        // keep waiting for a human; offer the bot after 5 s
        const botTimer = setTimeout(() => {
          botBtn.hidden = false;
          announce('Kein Gegner gefunden. Du kannst gegen einen Bot spielen.');
        }, BOT_OFFER_MS);
        view.append(head('Online spielen', false), spinner, p, botBtn, cancel);
        announce('Suche Gegner.');

        const join = async () => {
          if (done) return;
          try {
            const r = await call<MatchResult>('matchmake', { action: 'join', game: GAME });
            if (r.status === 'matched' && !done) matched(r.matchId);
          } catch (e) {
            if (!done) {
              finish();
              failure(errorText(e));
            }
          }
        };
        const matched = (id: string) => {
          finish();
          play('match');
          game(id);
        };
        const channel: RealtimeChannel = getClient()
          .channel(`queue:${user.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'queue', filter: `user_id=eq.${user.id}` },
            (payload) => {
              const id = (payload.new as { match_id: string | null }).match_id;
              if (id && !done) matched(id);
            },
          )
          .subscribe((status) => status === 'SUBSCRIBED' && void join());
        const timer = setInterval(join, HEARTBEAT_MS);
        const onVisible = () => document.visibilityState === 'visible' && void join();
        document.addEventListener('visibilitychange', onVisible);

        function finish(): void {
          done = true;
          clearTimeout(botTimer);
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
          void getClient().removeChannel(channel);
        }
        return () => {
          if (done) return;
          finish();
          // navigating away while waiting: leave the queue
          call('matchmake', { action: 'leave', game: GAME }).catch(() => {});
        };
      });
    }

    function game(matchId: string): void {
      show(() => {
        view.className = 'game';
        view.innerHTML = `
          <div class="game-head"><a class="back" href="#/">← Menü</a><h1 tabindex="-1">Online-Partie</h1></div>
          <p class="opponent" data-opp></p>
          <div data-score></div>
          <p class="status" data-status></p>
          <p class="timer" data-timer></p>
          <div class="board-wrap" data-board></div>
          <div class="end" data-actions>
            <button class="btn" type="button" data-claim hidden>Sieg wegen Zeitüberschreitung</button>
            <button class="btn" type="button" data-resign>Aufgeben</button>
          </div>
          <div class="end" data-end hidden>
            <p class="result" data-result></p>
            <button class="btn primary" type="button" data-again>Neues Spiel</button>
            <a class="btn" href="#/">Menü</a>
          </div>`;
        const $ = <T extends HTMLElement>(s: string) => view.querySelector<T>(s)!;
        const status = $('[data-status]');
        const timerEl = $('[data-timer]');
        const claim = $<HTMLButtonElement>('[data-claim]');
        const resign = $<HTMLButtonElement>('[data-resign]');
        const scoreboard = createScoreboard($('[data-score]'));
        let m: MatchRow | null = null;
        let me: Player = 'X';
        let pending = false;
        let closed = false;
        let botBusy = false;
        let chat: Chat | null = null;
        let chatCloseTimer = 0;
        // Game events must not pull the cursor out of a message being typed.
        const typingInChat = () => !!document.activeElement?.closest('.chat');

        const board = createBoard($('[data-board]'), {
          async onCellClick(i) {
            if (!m || pending || m.status !== 'active' || m.state.turn !== me || m.state.winner) return;
            // Draw the move at once with the same rules as the server; the server stays authoritative.
            const before = m;
            const local = applyMove(m.state, i);
            pending = true;
            m = { ...m, state: local.state };
            draw(local.events, i);
            try {
              const r = await call<{ state: GameState; events: GameEvent[] }>('move', { matchId, index: i });
              pending = false;
              if (closed || !m) return;
              if (!sameState(m.state, r.state)) applyState({ ...m, state: r.state }, r.events, i);
              else draw();
              if (r.state.winner) void refetch(); // result and rating come from the server
            } catch (e) {
              pending = false;
              m = before;
              draw();
              toast(errorText(e));
              announce(errorText(e));
              void refetch();
            }
          },
        });

        const opp = () => (me === 'X' ? { nick: m!.o_nick, elo: m!.o_elo } : { nick: m!.x_nick, elo: m!.x_elo });

        function draw(events: GameEvent[] = [], lastMove?: number): void {
          if (!m) return;
          const myTurn = m.status === 'active' && m.state.turn === me && !pending;
          board.render(m.state, events, { interactive: myTurn, myPlayer: me, lastMove });
          const names = { X: m.x_nick, O: m.o_nick };
          names[me] += ' (Du)';
          scoreboard.render(m.state, names);
          const o = opp();
          $('[data-opp]').textContent = `Gegner: ${o.nick} · Elo ${o.elo}`;
          const finished = m.status === 'finished';
          status.textContent = finished ? resultText() : m.state.turn === me ? 'Du bist am Zug' : `${o.nick} ist am Zug`;
          status.dataset.player = (m.state.winner ?? m.state.turn).toLowerCase();
          status.classList.toggle('won', finished);
          $('[data-actions]').hidden = finished;
          $('[data-end]').hidden = !finished;
          if (finished) $('[data-result]').textContent = eloText();
          if (finished && chat && !chatCloseTimer) {
            const left = Date.parse(m.updated_at) + CHAT_OPEN_AFTER_FINISH_MS - Date.now();
            chatCloseTimer = window.setTimeout(() => chat?.setClosed(true), Math.max(0, left));
          }
          tick();
          botTurn();
        }

        /** Bot matches: after a short "thinking" pause ask the server for the bot's move, then resync. */
        function botTurn(): void {
          if (!m?.is_bot || m.status !== 'active' || m.state.turn === me || pending || botBusy || closed) return;
          botBusy = true;
          setTimeout(async () => {
            try {
              if (!closed) await call('bot-move', { matchId });
            } catch {
              /* e.g. not_bot_turn after a resync: the refetch below shows the real state */
            }
            await refetch();
            botBusy = false;
            botTurn(); // after an auto-pass the bot may move again
          }, thinkTimeMs(m.state, opp().elo));
        }

        function resultText(): string {
          if (!m) return '';
          if (!m.winner_id) return 'Partie abgebrochen';
          return m.winner_id === user.id ? 'Du gewinnst!' : `${opp().nick} gewinnt.`;
        }

        function eloText(): string {
          if (!m || m.elo_delta === null) return '';
          if (!m.winner_id) return 'Weniger als 2 Züge gespielt: nicht gewertet.';
          const mine = me === 'X' ? m.x_elo : m.o_elo;
          const d = (me === 'X' ? m.x_delta : m.o_delta) ?? 0;
          return `Elo: ${mine} → ${mine + d} (${d >= 0 ? '+' : ''}${d})`;
        }

        // shortcut: uses the local clock; the server re-checks the deadline on claim, so skew only delays the button
        function tick(): void {
          if (!m || m.status !== 'active') {
            timerEl.textContent = '';
            claim.hidden = true;
            return;
          }
          const left = Math.max(0, Math.ceil((Date.parse(m.turn_deadline) - Date.now()) / 1000));
          const mine = m.state.turn === me;
          timerEl.textContent = mine ? `Deine Zugzeit: ${left} s` : `Zugzeit des Gegners: ${left} s`;
          timerEl.classList.toggle('urgent', left <= 10);
          claim.hidden = mine || left > 0 || m.is_bot;
        }

        function applyState(next: MatchRow, events?: GameEvent[], lastMove?: number): void {
          const prev = m;
          m = next;
          if (prev && !events) {
            const inferred = inferMove(prev.state, next.state);
            if (inferred) [lastMove, events] = [inferred.index, inferred.events];
          }
          draw(events, lastMove);
          if (prev && prev.state.moves !== next.state.moves && lastMove !== undefined) {
            const mover = prev.state.turn;
            const lines = [`${mover === me ? 'Du' : opp().nick} auf ${cellName(lastMove)}.`, ...describeEvents(events ?? [])];
            announce(lines.join(' '));
            const visible = describeEvents((events ?? []).filter((e) => e.kind === 'pass' || e.kind === 'score'));
            if (visible.length && next.status === 'active') toast(visible.join(' '));
          }
          if (prev?.status === 'active' && next.status === 'finished') {
            announce(`${resultText()} ${eloText()}`);
            if (!typingInChat()) $('[data-again]').focus();
            if (next.winner_id) {
              const won = next.winner_id === user.id;
              setTimeout(() => !closed && play(won ? 'win' : 'lose'), RESULT_SOUND_DELAY_MS);
            }
          } else if (prev && prev.state.turn !== me && next.state.turn === me && next.status === 'active') {
            if (!typingInChat()) board.focus();
            setTimeout(() => !closed && play('turn'), TURN_SOUND_DELAY_MS);
          }
        }

        async function refetch(silent = false): Promise<void> {
          const { data, error } = await getClient().from('matches').select('*').eq('id', matchId).maybeSingle();
          if (closed || pending) return;
          if (error) return silent ? undefined : void toast('Keine Verbindung zum Server.');
          if (!data) return gone();
          const row = data as MatchRow;
          // an answer older than what we already show (it was sent before our last move)
          if (m && row.status === 'active' && row.state.moves < m.state.moves) return;
          me = row.x_id === user.id ? 'X' : 'O';
          if (!row.is_bot && !chat) {
            chat = createChat(view, { matchId, userId: user.id, opponentNick: me === 'X' ? row.o_nick : row.x_nick });
          }
          if (!m || !sameState(m.state, row.state) || m.status !== row.status || m.turn_deadline !== row.turn_deadline) {
            applyState(row);
          }
        }

        function gone(): void {
          closed = true;
          failure('Die Partie ist nicht mehr verfügbar (Konto des Gegners gelöscht).');
        }

        const channel = getClient()
          .channel(`match:${matchId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
            (payload) => {
              if (closed) return;
              if (payload.eventType === 'DELETE') return gone();
              const row = payload.new as MatchRow;
              if (pending && row.status === 'active') return; // our own move response will draw it
              if (m && sameState(m.state, row.state) && m.status === row.status) {
                m = row; // e.g. deadline only
                return draw();
              }
              applyState(row);
            },
          )
          // (re)subscribed: fetch, so nothing missed while disconnected
          .subscribe((s) => s === 'SUBSCRIBED' && void refetch());

        claim.addEventListener('click', async () => {
          claim.disabled = true;
          try {
            await call('claim-timeout', { matchId });
          } catch (e) {
            toast(errorText(e));
          }
          claim.disabled = false;
          void refetch();
        });
        resign.addEventListener('click', async () => {
          if (!confirm('Wirklich aufgeben? Die Partie zählt als Niederlage.')) return;
          resign.disabled = true;
          try {
            await call('resign', { matchId });
          } catch (e) {
            toast(errorText(e));
          }
          resign.disabled = false;
          void refetch();
        });
        $('[data-again]').addEventListener('click', () => void search());

        const timer = setInterval(tick, 1000);
        // Realtime is only a speed-up: load now and poll, so the game also works if the subscription never connects.
        void refetch();
        // Every second while waiting for the opponent, every 3 s on our own turn.
        let pollTick = 0;
        const poll = setInterval(() => {
          if (m?.status === 'finished' || botBusy) return;
          if (m?.state.turn === me && ++pollTick % 3) return;
          void refetch(true);
        }, 1000);
        const onVisible = () => document.visibilityState === 'visible' && void refetch();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          closed = true;
          clearTimeout(chatCloseTimer);
          chat?.destroy();
          clearInterval(timer);
          clearInterval(poll);
          document.removeEventListener('visibilitychange', onVisible);
          void getClient().removeChannel(channel);
          view.className = 'panel';
        };
      });
    }

    void start();
    return () => {
      stop?.();
      alive = false;
    };
  },
};

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** Field-wise compare (jsonb from the DB does not keep key order). */
function sameState(a: GameState, b: GameState): boolean {
  return (
    a.moves === b.moves &&
    a.turn === b.turn &&
    a.winner === b.winner &&
    a.score.X === b.score.X &&
    a.score.O === b.score.O &&
    a.board.every((c, i) => {
      const d = b.board[i];
      return c === null ? d === null : d !== null && c.p === d.p && c.frozen === d.frozen;
    })
  );
}

/** Reconstructs the opponent's move (for animation + announcement) by replaying every legal move. */
function inferMove(prev: GameState, next: GameState): { index: number; events: GameEvent[] } | null {
  if (next.moves <= prev.moves) return null;
  for (let i = 0; i < prev.board.length; i++) {
    if (prev.board[i]) continue;
    try {
      const r = applyMove(prev, i);
      if (sameState(r.state, next)) return { index: i, events: r.events };
    } catch {
      /* not legal */
    }
  }
  return null;
}
